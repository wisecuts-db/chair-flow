-- =====================================================================
-- Weekly booth rent
--  * Owner sets each booth renter's weekly rent (rent_plans).
--  * A charge is created automatically for every week: due Saturday 5 PM
--    (shop time). Sunday is the grace period. From Monday 12 AM it's late.
--  * Payments are applied to the oldest unpaid week first.
--  * Push: renter reminded Saturday morning, told when the grace period
--    starts, and renter + owners told Monday morning when rent is late.
-- =====================================================================

-- ---------- Shop rent schedule (defaults: Saturday, 5 PM, 1 grace day) ----------
alter table locations add column if not exists rent_due_dow   integer not null default 6
  check (rent_due_dow between 0 and 6);          -- 0 = Sunday ... 6 = Saturday
alter table locations add column if not exists rent_due_time  time    not null default '17:00';
alter table locations add column if not exists rent_grace_days integer not null default 1
  check (rent_grace_days between 0 and 6);

-- ---------- Weekly rent per renter ----------
create table if not exists rent_plans (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id) on delete cascade,
  renter_id    uuid not null references memberships(id) on delete cascade,
  weekly_cents integer not null check (weekly_cents > 0),
  start_date   date not null default current_date,
  end_date     date,
  active       boolean not null default true,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create unique index if not exists rent_plans_one_active on rent_plans (renter_id) where active;
create index if not exists rent_plans_loc_idx on rent_plans (location_id);
alter table rent_plans enable row level security;
create policy rent_plans_owner on rent_plans for all
  using (is_owner(location_id)) with check (is_owner(location_id));
create policy rent_plans_read on rent_plans for select
  using (has_permission(location_id, 'rent.view') or is_my_membership(renter_id));

-- ---------- Charges: weekly (automatic) or extra (added by owner) ----------
alter table rent_charges alter column contract_id drop not null;
alter table rent_charges add column if not exists kind text not null default 'extra'
  check (kind in ('weekly', 'extra'));
alter table rent_charges add column if not exists plan_id uuid references rent_plans(id) on delete set null;
alter table rent_charges add column if not exists created_at timestamptz not null default now();
alter table rent_charges add column if not exists reminded_at timestamptz;
alter table rent_charges add column if not exists grace_notified_at timestamptz;
alter table rent_charges add column if not exists late_notified_at timestamptz;
create unique index if not exists rent_charges_one_per_week on rent_charges (renter_id, due_on) where kind = 'weekly';

-- ---------- Audit: include rent_plans, ignore notification bookkeeping ----------
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
    when 'rent_plans'   then (rec->>'renter_id')::uuid
    else (rec->>'membership_id')::uuid
  end;
  loc := coalesce((rec->>'location_id')::uuid, membership_location(subj));

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into diff
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value;
    if diff is null then return new; end if;
    if diff <@ array['barber_new_notified_at', 'barber_reminded_at',
                     'reminded_at', 'grace_notified_at', 'late_notified_at'] then return new; end if;
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
revoke execute on function audit_row() from public, anon, authenticated;

drop trigger if exists audit_rent_plans on rent_plans;
create trigger audit_rent_plans after insert or update or delete on rent_plans
  for each row execute function audit_row();

-- ---------- Status of every charge ----------
-- display_status: paid | waived | due | grace | late
create or replace view rent_status_view with (security_invoker = true) as
with t as (
  select c.id, c.location_id, c.renter_id, c.due_on, c.amount_cents, c.kind, c.status,
         coalesce(sum(p.amount_cents), 0) as paid_cents,
         max(p.paid_at) as last_paid_at,
         ((c.due_on + l.rent_due_time) at time zone l.timezone) as due_at,
         (((c.due_on + 1 + l.rent_grace_days)::timestamp) at time zone l.timezone) as late_at
  from rent_charges c
  join locations l on l.id = c.location_id
  left join rent_payments p on p.charge_id = c.id
  group by c.id, l.rent_due_time, l.timezone, l.rent_grace_days
)
select t.id as charge_id, t.location_id, t.renter_id, t.due_on, t.amount_cents, t.paid_cents,
       greatest(case when t.status = 'waived' then 0 else t.amount_cents - t.paid_cents end, 0) as balance_cents,
       case
         when t.status = 'waived' then 'waived'
         when t.amount_cents - t.paid_cents <= 0 then 'paid'
         when now() >= t.late_at then 'late'
         when now() >= t.due_at then 'grace'
         else 'due'
       end as display_status,
       (t.status <> 'waived' and t.paid_cents > 0 and t.amount_cents - t.paid_cents > 0) as is_partial,
       t.kind, t.due_at, t.late_at, t.last_paid_at,
       (t.status <> 'waived' and t.amount_cents - t.paid_cents <= 0 and t.last_paid_at > t.due_at) as paid_late
from t;

-- Analytics counted 'overdue'; the status is now 'late'.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
  where p.proname = 'shop_analytics' and p.pronamespace = 'public'::regnamespace;
  if def is not null and position('''overdue''' in def) > 0 then
    execute replace(def, '''overdue''', '''late''');
  end if;
end $$;

-- ---------- Create the weekly charges ----------
-- One charge per due day from the plan's start through this week's due day.
create or replace function generate_rent_charges(p_plan uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with p as (
    select rp.*, l.rent_due_dow as dow, (now() at time zone l.timezone)::date as today
    from rent_plans rp
    join locations l on l.id = rp.location_id
    join memberships m on m.id = rp.renter_id
    where rp.active and m.status = 'active' and (p_plan is null or rp.id = p_plan)
  ), d as (
    select p.*, gs::date as due_on
    from p, generate_series(
      p.start_date + ((p.dow - extract(dow from p.start_date)::int + 7) % 7),
      least(p.today + ((p.dow - extract(dow from p.today)::int + 7) % 7), coalesce(p.end_date, 'infinity'::date)),
      interval '7 days') gs
  ), ins as (
    insert into rent_charges (location_id, renter_id, plan_id, kind, period_start, due_on, amount_cents)
    select d.location_id, d.renter_id, d.id, 'weekly', d.due_on - 6, d.due_on, d.weekly_cents from d
    on conflict (renter_id, due_on) where kind = 'weekly' do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;
revoke execute on function generate_rent_charges(uuid) from public, anon, authenticated;

create or replace function rent_plan_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active then perform generate_rent_charges(new.id); end if;
  return new;
end $$;
revoke execute on function rent_plan_changed() from public, anon, authenticated;
drop trigger if exists rent_plan_generate on rent_plans;
create trigger rent_plan_generate after insert or update of weekly_cents, start_date, end_date, active on rent_plans
  for each row execute function rent_plan_changed();

-- ---------- Owner actions ----------
-- Set (or change) a renter's weekly rent. Unpaid future weeks pick up the new amount.
create or replace function set_weekly_rent(p_renter uuid, p_weekly_cents integer, p_start date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare loc uuid; pid uuid;
begin
  select location_id into loc from memberships where id = p_renter and role = 'renter';
  if loc is null then raise exception 'That person isn''t a booth renter'; end if;
  if not is_owner(loc) then raise exception 'Only the owner can set booth rent'; end if;
  if p_weekly_cents is null or p_weekly_cents <= 0 then raise exception 'Enter the weekly rent'; end if;

  select id into pid from rent_plans where renter_id = p_renter and active;
  if pid is null then
    insert into rent_plans (location_id, renter_id, weekly_cents, start_date)
    values (loc, p_renter, p_weekly_cents, coalesce(p_start, (now() at time zone (select timezone from locations where id = loc))::date))
    returning id into pid;
  else
    update rent_plans set weekly_cents = p_weekly_cents, start_date = coalesce(p_start, start_date) where id = pid;
    -- weeks not yet due and not paid at all take the new amount
    update rent_charges c set amount_cents = p_weekly_cents
    where c.plan_id = pid and c.kind = 'weekly' and c.status <> 'waived'
      and c.amount_cents <> p_weekly_cents
      and not exists (select 1 from rent_payments p where p.charge_id = c.id)
      and exists (select 1 from rent_status_view v where v.charge_id = c.id and v.display_status = 'due');
    perform generate_rent_charges(pid);
  end if;
  return pid;
end $$;
grant execute on function set_weekly_rent(uuid, integer, date) to authenticated;

create or replace function stop_weekly_rent(p_renter uuid)
returns void language plpgsql security definer set search_path = public as $$
declare loc uuid;
begin
  select location_id into loc from memberships where id = p_renter;
  if not is_owner(loc) then raise exception 'Only the owner can change booth rent'; end if;
  update rent_plans set active = false, end_date = current_date where renter_id = p_renter and active;
end $$;
grant execute on function stop_weekly_rent(uuid) to authenticated;

-- Record money received. It pays the oldest unpaid week first.
create or replace function record_rent_payment(p_renter uuid, p_amount_cents integer, p_method text default 'cash',
                                               p_paid_at timestamptz default now(), p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare loc uuid; left_cents integer := p_amount_cents; owed integer; r record; take integer; weeks jsonb := '[]'::jsonb;
begin
  select location_id into loc from memberships where id = p_renter;
  if loc is null or not is_owner(loc) then raise exception 'Only the owner can record rent payments'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter the amount paid'; end if;
  if p_paid_at > now() + interval '5 minutes' then raise exception 'The payment date can''t be in the future'; end if;

  select coalesce(sum(balance_cents), 0) into owed from rent_status_view
  where renter_id = p_renter and display_status in ('due', 'grace', 'late');
  if p_amount_cents > owed then
    raise exception 'That''s more than they owe right now (%). Record up to that amount.',
      to_char(owed / 100.0, 'FM$999,990.00');
  end if;

  for r in
    select v.charge_id, v.balance_cents, v.due_on from rent_status_view v
    where v.renter_id = p_renter and v.display_status in ('due', 'grace', 'late')
    order by v.due_on, v.charge_id
  loop
    exit when left_cents <= 0;
    take := least(left_cents, r.balance_cents);
    insert into rent_payments (charge_id, amount_cents, paid_at, method, note)
    values (r.charge_id, take, coalesce(p_paid_at, now()), p_method, p_note);
    weeks := weeks || jsonb_build_object('due_on', r.due_on, 'amount_cents', take);
    left_cents := left_cents - take;
  end loop;

  return jsonb_build_object('applied', weeks,
    'still_owed_cents', owed - p_amount_cents);
end $$;
grant execute on function record_rent_payment(uuid, integer, text, timestamptz, text) to authenticated;

-- Waive (or un-waive) one week.
create or replace function waive_rent_charge(p_charge uuid, p_waive boolean default true, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare loc uuid;
begin
  select location_id into loc from rent_charges where id = p_charge;
  if loc is null or not is_owner(loc) then raise exception 'Only the owner can waive rent'; end if;
  update rent_charges set status = case when p_waive then 'waived'::rent_status else 'due'::rent_status end,
                          note = coalesce(p_note, note)
  where id = p_charge;
end $$;
grant execute on function waive_rent_charge(uuid, boolean, text) to authenticated;

-- ---------- Rent board: who's paid, who's in grace, who's late, who's behind ----------
-- Runs with the caller's access: owners/managers with rent access see everyone,
-- a booth renter sees only themselves.
create or replace function rent_board(loc uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with l as (
    select id, timezone, rent_due_dow, rent_due_time, rent_grace_days,
           (now() at time zone timezone)::date as today from locations where id = loc
  ), cyc as (
    -- the due day people are working toward right now: last due day while it's still in grace, else the next one
    select l.*,
           case when now() < (((l.today - ((extract(dow from l.today)::int - l.rent_due_dow + 7) % 7)) + 1 + l.rent_grace_days)::timestamp at time zone l.timezone)
                then l.today - ((extract(dow from l.today)::int - l.rent_due_dow + 7) % 7)
                else l.today + ((l.rent_due_dow - extract(dow from l.today)::int + 7) % 7)
           end as cycle_due
    from l
  ), people as (
    select renter_id from rent_plans where location_id = loc
    union select renter_id from rent_charges where location_id = loc
  ), per as (
    select pp.renter_id,
      (select weekly_cents from rent_plans rp where rp.renter_id = pp.renter_id and rp.active) as weekly_cents,
      (select to_jsonb(v) from rent_status_view v, cyc
         where v.renter_id = pp.renter_id and v.kind = 'weekly' and v.due_on = cyc.cycle_due) as this_week,
      (select coalesce(sum(balance_cents), 0) from rent_status_view v
         where v.renter_id = pp.renter_id and v.display_status in ('due', 'grace', 'late')) as owed_cents,
      (select coalesce(sum(balance_cents), 0) from rent_status_view v
         where v.renter_id = pp.renter_id and v.display_status = 'late') as late_cents,
      (select count(*) from rent_status_view v
         where v.renter_id = pp.renter_id and v.display_status = 'late') as weeks_late,
      (select count(*) from rent_status_view v
         where v.renter_id = pp.renter_id and v.kind = 'weekly' and v.display_status = 'paid' and not v.paid_late
           and v.due_on > current_date - 84) as on_time_12w,
      (select count(*) from rent_status_view v
         where v.renter_id = pp.renter_id and v.kind = 'weekly' and (v.paid_late or v.display_status = 'late')
           and v.due_on > current_date - 84) as late_12w,
      (select max(p.paid_at) from rent_payments p join rent_charges c on c.id = p.charge_id
         where c.renter_id = pp.renter_id) as last_paid_at
    from people pp
    where exists (select 1 from memberships m where m.id = pp.renter_id)
  )
  select jsonb_build_object(
    'timezone', (select timezone from cyc),
    'due_on', (select cycle_due from cyc),
    'due_at', (select (cycle_due + rent_due_time) at time zone timezone from cyc),
    'late_at', (select ((cycle_due + 1 + rent_grace_days)::timestamp) at time zone timezone from cyc),
    'renters', coalesce((select jsonb_agg(to_jsonb(per) || jsonb_build_object('status',
        case when per.weeks_late > 0 then 'late'
             else coalesce(per.this_week->>'display_status', 'none') end)
        order by per.weeks_late desc, per.owed_cents desc) from per), '[]'::jsonb))
$$;
grant execute on function rent_board(uuid) to authenticated;

-- ---------- Push notifications ----------
create or replace function process_rent_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; amt text; owners uuid[]; total integer;
begin
  perform generate_rent_charges();

  -- Saturday morning reminder (from 10 AM until 5 PM, once)
  for r in
    select v.charge_id, v.balance_cents, v.due_at, m.user_id, l.timezone, l.id as loc
    from rent_status_view v
    join rent_charges c on c.id = v.charge_id
    join memberships m on m.id = v.renter_id
    join locations l on l.id = v.location_id
    where v.kind = 'weekly' and v.display_status = 'due' and c.reminded_at is null
      and now() >= ((v.due_on + time '10:00') at time zone l.timezone) and now() < v.due_at
  loop
    n := n + send_push(array[r.user_id], 'Booth rent due today',
      to_char(r.balance_cents / 100.0, 'FM$999,990.00') || ' is due by ' ||
      trim(to_char(r.due_at at time zone r.timezone, 'FMHH12:MI AM')) || ' today.',
      jsonb_build_object('type', 'rent', 'location_id', r.loc));
    update rent_charges set reminded_at = now() where id = r.charge_id;
  end loop;

  -- Missed the deadline: grace period
  for r in
    select v.charge_id, v.balance_cents, v.late_at, m.user_id, l.timezone, l.id as loc
    from rent_status_view v
    join rent_charges c on c.id = v.charge_id
    join memberships m on m.id = v.renter_id
    join locations l on l.id = v.location_id
    where v.kind = 'weekly' and v.display_status = 'grace' and c.grace_notified_at is null
  loop
    n := n + send_push(array[r.user_id], 'Booth rent: grace period',
      'We haven''t received your ' || to_char(r.balance_cents / 100.0, 'FM$999,990.00') ||
      ' booth rent. Pay by end of ' || trim(to_char((r.late_at - interval '1 minute') at time zone r.timezone, 'FMDay')) ||
      ' to avoid being marked late.',
      jsonb_build_object('type', 'rent', 'location_id', r.loc));
    update rent_charges set grace_notified_at = now() where id = r.charge_id;
  end loop;

  -- Late: tell the renter and the owners, from 9 AM on the late day, within a week
  for r in
    select v.charge_id, v.renter_id, v.balance_cents, m.user_id, l.id as loc,
           coalesce(nullif(pr.full_name, ''), pr.email, 'A booth renter') as name
    from rent_status_view v
    join rent_charges c on c.id = v.charge_id
    join memberships m on m.id = v.renter_id
    join locations l on l.id = v.location_id
    left join profiles pr on pr.id = m.user_id
    where v.kind = 'weekly' and v.display_status = 'late' and c.late_notified_at is null
      and now() >= v.late_at + interval '9 hours' and now() < v.late_at + interval '7 days'
  loop
    select coalesce(sum(balance_cents), 0) into total from rent_status_view
    where renter_id = r.renter_id and display_status = 'late';
    amt := to_char(total / 100.0, 'FM$999,990.00');
    n := n + send_push(array[r.user_id], 'Booth rent is late',
      'Your booth rent is late. You''re behind ' || amt || '.',
      jsonb_build_object('type', 'rent', 'location_id', r.loc));
    select array_agg(distinct user_id) into owners from memberships
    where location_id = r.loc and role = 'owner' and status = 'active';
    if owners is not null then
      n := n + send_push(owners, 'Late booth rent', r.name || ' is late on booth rent: ' || amt || ' behind.',
        jsonb_build_object('type', 'rent', 'location_id', r.loc));
    end if;
    update rent_charges set late_notified_at = now() where id = r.charge_id;
  end loop;

  return n;
end $$;
revoke execute on function process_rent_notifications() from public, anon, authenticated;

-- Scheduled separately (run once with execute_sql):
-- select cron.schedule('booth-rent', '*/5 * * * *', 'select public.process_rent_notifications()');
