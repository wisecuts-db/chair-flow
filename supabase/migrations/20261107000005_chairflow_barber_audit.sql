-- =====================================================================
-- Per-barber audit trail
--  * every change to appointments, sales, walk-ins, services, schedules,
--    roster records, contracts, rent and memberships is logged
--  * each log row says WHO did it (actor) and WHICH barber it's about (subject)
--  * the log is append-only: nobody can edit or delete it through the API
--  * barber_activity() and barber_summary() give the owner a one-call report
-- =====================================================================

alter table audit_log
  add column if not exists subject_membership_id uuid,
  add column if not exists actor_membership_id uuid,
  add column if not exists changed text[];

create index if not exists audit_log_subject_idx on audit_log (subject_membership_id, at desc);
create index if not exists audit_log_actor_idx on audit_log (actor_membership_id, at desc);
create index if not exists audit_log_table_idx on audit_log (table_name, row_id);

-- One trigger function for every audited table.
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

create or replace function audit_rent_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r rent_payments := coalesce(new, old);
begin
  insert into audit_log (location_id, action, table_name, row_id, old_data, new_data,
                         subject_membership_id, actor_membership_id)
  select c.location_id, lower(tg_op), 'rent_payments', r.id::text,
         case when tg_op <> 'INSERT' then to_jsonb(old) end,
         case when tg_op <> 'DELETE' then to_jsonb(new) end,
         c.renter_id, my_membership(c.location_id)
  from rent_charges c where c.id = r.charge_id;
  return r;
end $$;

-- Add triggers to the tables that weren't audited yet.
create trigger audit_memberships     after insert or update or delete on memberships     for each row execute function audit_row();
create trigger audit_appointments    after insert or update or delete on appointments    for each row execute function audit_row();
create trigger audit_sales           after insert or update or delete on sales           for each row execute function audit_row();
create trigger audit_walkins         after update or delete on walkins                   for each row execute function audit_row();
create trigger audit_services        after insert or update or delete on services        for each row execute function audit_row();
create trigger audit_availability    after insert or update or delete on availability    for each row execute function audit_row();
create trigger audit_time_off        after insert or update or delete on time_off        for each row execute function audit_row();
create trigger audit_staff_documents after insert or update or delete on staff_documents for each row execute function audit_row();
create trigger audit_clients         after update or delete on clients                   for each row execute function audit_row();

revoke execute on function audit_row()          from public, anon, authenticated;
revoke execute on function audit_rent_payment() from public, anon, authenticated;

-- Append-only: the log can't be changed or removed, even by the owner.
create or replace function audit_log_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_immutable();
revoke insert, update, delete, truncate on audit_log from anon, authenticated;
revoke execute on function audit_log_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------

-- Who may see a barber's report: the owner, someone allowed to see others'
-- earnings at that location, or the barber themself.
create or replace function can_view_barber(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_owner(membership_location(mid))
      or has_permission(membership_location(mid), 'earnings.view_others')
      or is_my_membership(mid)
$$;

-- Timeline of everything that happened to or was done by one barber.
-- Owner only: it includes full before/after records.
create or replace function barber_activity(
  p_membership uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now(),
  p_limit integer default 200)
returns table (
  at timestamptz, action text, table_name text, row_id text, changed text[],
  role_in_change text, actor_name text, old_data jsonb, new_data jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner(membership_location(p_membership)) then
    raise exception 'only the owner can view the audit trail';
  end if;
  return query
  select a.at, a.action, a.table_name, a.row_id, a.changed,
         case when a.subject_membership_id = p_membership and a.actor_membership_id = p_membership then 'self'
              when a.subject_membership_id = p_membership then 'about'
              else 'by' end,
         coalesce(nullif(p.full_name, ''), p.email, 'system'),
         a.old_data, a.new_data
  from audit_log a
  left join profiles p on p.id = a.actor
  where (a.subject_membership_id = p_membership or a.actor_membership_id = p_membership)
    and a.at >= p_from and a.at <= p_to
  order by a.at desc
  limit least(greatest(p_limit, 1), 1000);
end $$;
revoke execute on function barber_activity(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function barber_activity(uuid, timestamptz, timestamptz, integer) to authenticated;

-- One-call scorecard for a barber over a date range.
-- Renters' own sales are only counted when the renter is the one asking.
create or replace function barber_summary(
  p_membership uuid,
  p_from date default (current_date - 30),
  p_to   date default current_date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m        memberships;
  tz       text;
  t0       timestamptz;
  t1       timestamptz;
  show_money boolean;
  result   jsonb;
begin
  select * into m from memberships where id = p_membership;
  if m.id is null or not can_view_barber(p_membership) then
    raise exception 'not allowed';
  end if;
  select timezone into tz from locations where id = m.location_id;
  t0 := (p_from::timestamp) at time zone tz;
  t1 := ((p_to + 1)::timestamp) at time zone tz;
  show_money := m.role <> 'renter' or is_my_membership(p_membership);

  select jsonb_build_object(
    'membership_id', m.id,
    'role', m.role,
    'from', p_from,
    'to', p_to,
    'appointments', (
      select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'no_show', count(*) filter (where status = 'no_show'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'upcoming', count(*) filter (where status in ('booked', 'confirmed', 'checked_in')),
        'online', count(*) filter (where source = 'online'),
        'booked_minutes', coalesce(sum(extract(epoch from ends_at - starts_at) / 60) filter (where status = 'completed'), 0)::int,
        'unique_clients', count(distinct client_id))
      from appointments
      where barber_id = m.id and starts_at >= t0 and starts_at < t1),
    'walk_ins_served', (
      select count(*) from walkins
      where assigned_to = m.id and status = 'served' and joined_at >= t0 and joined_at < t1),
    'sales', case when show_money then (
      select jsonb_build_object(
        'count', count(*),
        'gross_cents', coalesce(sum(gross_cents), 0),
        'discount_cents', coalesce(sum(discount_cents), 0),
        'refund_cents', coalesce(sum(refund_cents), 0),
        'tip_cents', coalesce(sum(tip_cents), 0),
        'net_cents', coalesce(sum(gross_cents - discount_cents - refund_cents), 0),
        'avg_ticket_cents', coalesce(round(avg(gross_cents - discount_cents - refund_cents)), 0))
      from sales
      where barber_id = m.id and sold_at >= t0 and sold_at < t1
        and (not renter_owned or is_my_membership(m.id))) else null end,
    'rent', case when m.role = 'renter' then (
      select jsonb_build_object(
        'charged_cents', coalesce(sum(c.amount_cents), 0),
        'paid_cents', coalesce(sum(p.paid), 0),
        'balance_cents', coalesce(sum(c.amount_cents), 0) - coalesce(sum(p.paid), 0),
        'late_charges', count(*) filter (where c.due_on < current_date and c.amount_cents > coalesce(p.paid, 0)))
      from rent_charges c
      left join lateral (select sum(amount_cents) as paid from rent_payments where charge_id = c.id) p on true
      where c.renter_id = m.id and c.due_on between p_from and p_to) else null end,
    'changes', (
      select jsonb_build_object(
        'made_by_them', count(*) filter (where actor_membership_id = m.id),
        'made_by_others_about_them', count(*) filter (where subject_membership_id = m.id and actor_membership_id is distinct from m.id),
        'appointment_deletes', count(*) filter (where table_name = 'appointments' and action = 'delete'),
        'sale_edits', count(*) filter (where table_name = 'sales' and action in ('update', 'delete')))
      from audit_log
      where (subject_membership_id = m.id or actor_membership_id = m.id) and at >= t0 and at < t1)
  ) into result;
  return result;
end $$;
revoke execute on function barber_summary(uuid, date, date) from public, anon;
grant execute on function barber_summary(uuid, date, date) to authenticated;
revoke execute on function can_view_barber(uuid) from anon;
