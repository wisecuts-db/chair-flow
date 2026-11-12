-- =====================================================================
-- Push notifications to barbers
--  * the app registers each signed-in phone's Expo push token
--  * every minute the database sends, through Expo's push service:
--      - "New booking" when a client books with a barber
--      - "Coming up" N minutes before each appointment (per-location setting, default 60)
-- =====================================================================
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens (user_id) where enabled;
alter table push_tokens enable row level security;
create policy push_tokens_own on push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table locations add column if not exists barber_reminder_minutes integer not null default 60
  check (barber_reminder_minutes between 0 and 1440);   -- 0 = off
alter table appointments add column if not exists barber_new_notified_at timestamptz;
alter table appointments add column if not exists barber_reminded_at timestamptz;

-- Send one notification to every active phone of the given users.
create or replace function send_push(p_users uuid[], p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', t.token, 'title', p_title, 'body', p_body,
                                      'sound', 'default', 'data', p_data, 'priority', 'high'))
    into msgs
  from push_tokens t where t.user_id = any(p_users) and t.enabled;
  if msgs is null then return 0; end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := msgs);
  return jsonb_array_length(msgs);
end $$;
revoke execute on function send_push(uuid[], text, text, jsonb) from public, anon, authenticated;

create or replace function process_barber_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare a record; n integer := 0; whenx text;
begin
  -- New bookings (only for appointments still in the future)
  for a in
    select ap.id, ap.starts_at, m.user_id, l.timezone, l.id as loc,
           coalesce(c.full_name, 'A client') as client, coalesce(s.name, 'an appointment') as service
    from appointments ap
    join memberships m on m.id = ap.barber_id
    join locations l on l.id = ap.location_id
    left join clients c on c.id = ap.client_id
    left join services s on s.id = ap.service_id
    where ap.barber_new_notified_at is null
      and ap.created_at > now() - interval '1 day'
      and ap.starts_at > now()
      and ap.status in ('booked', 'confirmed')
      and ap.source <> 'staff'
    for update of ap skip locked
  loop
    whenx := trim(to_char(a.starts_at at time zone a.timezone, 'Dy Mon FMDD "at" FMHH12:MI AM'));
    n := n + send_push(array[a.user_id], 'New booking',
                       a.client || ' booked ' || a.service || ' for ' || whenx || '.',
                       jsonb_build_object('type', 'new_booking', 'appointment_id', a.id, 'location_id', a.loc));
    update appointments set barber_new_notified_at = now() where id = a.id;
  end loop;

  -- Mark staff-made bookings as handled (the barber already knows about those).
  update appointments set barber_new_notified_at = now()
   where barber_new_notified_at is null and source = 'staff' and created_at > now() - interval '1 day';

  -- Coming up
  for a in
    select ap.id, ap.starts_at, m.user_id, l.timezone, l.id as loc, l.barber_reminder_minutes as mins,
           coalesce(c.full_name, 'Your client') as client, coalesce(s.name, 'appointment') as service
    from appointments ap
    join memberships m on m.id = ap.barber_id
    join locations l on l.id = ap.location_id
    left join clients c on c.id = ap.client_id
    left join services s on s.id = ap.service_id
    where ap.barber_reminded_at is null
      and l.barber_reminder_minutes > 0
      and ap.status in ('booked', 'confirmed')
      and ap.starts_at > now()
      and ap.starts_at <= now() + make_interval(mins => l.barber_reminder_minutes)
    for update of ap skip locked
  loop
    whenx := trim(to_char(a.starts_at at time zone a.timezone, 'FMHH12:MI AM'));
    n := n + send_push(array[a.user_id], 'Coming up at ' || whenx,
                       a.client || ' · ' || a.service || ' in ' ||
                       greatest(1, round(extract(epoch from a.starts_at - now()) / 60))::int || ' min.',
                       jsonb_build_object('type', 'reminder', 'appointment_id', a.id, 'location_id', a.loc));
    update appointments set barber_reminded_at = now() where id = a.id;
  end loop;
  return n;
end $$;
revoke execute on function process_barber_notifications() from public, anon, authenticated;

-- A rescheduled appointment gets a fresh "coming up" reminder.
create or replace function reset_barber_reminder()
returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at then new.barber_reminded_at := null; end if;
  return new;
end $$;
create trigger appointments_reset_reminder before update of starts_at on appointments
  for each row execute function reset_barber_reminder();

-- Keep the audit trail free of notification bookkeeping.
create or replace function audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec      jsonb := to_jsonb(coalesce(new, old));
  subj     uuid;
  loc      uuid;
  diff     text[];
begin
  subj := case tg_table_name
    when 'memberships'  then (rec->>'id')::uuid
    when 'appointments' then (rec->>'barber_id')::uuid
    when 'sales'        then (rec->>'barber_id')::uuid
    when 'walkins'      then coalesce((rec->>'assigned_to')::uuid, (rec->>'preferred_barber')::uuid)
    when 'services'     then (rec->>'renter_id')::uuid
    when 'clients'      then (rec->>'renter_id')::uuid
    when 'contracts'    then (rec->>'renter_id')::uuid
    when 'rent_charges' then (rec->>'renter_id')::uuid
    else (rec->>'membership_id')::uuid
  end;
  loc := coalesce((rec->>'location_id')::uuid, membership_location(subj));

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into diff
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value;
    if diff is null then return new; end if;   -- no real change, nothing to log
    -- notification bookkeeping isn't a business change
    if diff <@ array['barber_new_notified_at', 'barber_reminded_at'] then return new; end if;
  end if;

  insert into audit_log (location_id, action, table_name, row_id, old_data, new_data,
                         subject_membership_id, actor_membership_id, changed)
  values (loc, lower(tg_op), tg_table_name,
          coalesce(rec->>'id', rec->>'membership_id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          subj,
          case when loc is not null then my_membership(loc) end,
          diff);
  return coalesce(new, old);
end $$;

-- Run every minute.
select cron.schedule('barber-push-notifications', '* * * * *', 'select public.process_barber_notifications()');
