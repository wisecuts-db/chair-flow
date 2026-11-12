-- =====================================================================
-- ShopBoss roles update
--  Owner           full access
--  Managing partner  everything on by default (owner can switch items off)
--  Manager         schedule, staff, docs, walk-ins, clients, texts on;
--                  analytics, booth rent, revenue off by default
--  Barber / Booth renter  own profile, docs, appointments, rent, walk-in list,
--                  personal analytics
-- Plus: staff document storage, license status, booth-rent "partial",
-- shop analytics, client texting log, per-location review link.
-- =====================================================================

-- ---------- Default switches per role ----------
create or replace function role_default(p_role member_role, p_perm permission_key)
returns boolean language sql immutable as $$
  select case p_role::text
    when 'partner' then true
    when 'manager' then p_perm::text in ('schedule.view_all','schedule.manage_others','clients.view_all',
                                         'services.manage','staff.manage','roster.view','walkins.manage',
                                         'messages.send','clients.message')
    when 'barber'  then p_perm::text in ('walkins.manage')
    when 'renter'  then p_perm::text in ('walkins.manage')
    else false end
$$;

create or replace function seed_default_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into role_permissions (location_id, role, permission, allowed)
  select new.id, r.role, p.perm, role_default(r.role, p.perm)
  from unnest(array['partner','manager','barber','renter']::member_role[]) as r(role)
  cross join unnest(enum_range(null::permission_key)) as p(perm)
  on conflict do nothing;
  return new;
end $$;

-- Bring an existing location up to date (adds missing switches; optionally resets to defaults).
create or replace function apply_role_defaults(p_loc uuid, p_reset boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into role_permissions (location_id, role, permission, allowed)
  select p_loc, r.role, p.perm, role_default(r.role, p.perm)
  from unnest(array['partner','manager','barber','renter']::member_role[]) as r(role)
  cross join unnest(enum_range(null::permission_key)) as p(perm)
  on conflict (location_id, role, permission) do update
    set allowed = case when p_reset then excluded.allowed else role_permissions.allowed end,
        updated_at = now();
end $$;
revoke execute on function apply_role_defaults(uuid, boolean) from public, anon, authenticated;

-- ---------- Location settings ----------
alter table locations add column if not exists review_url text;

-- ---------- License status ----------
alter table staff_records add column if not exists license_status text
  check (license_status in ('active', 'pending', 'expired', 'suspended'));

-- Barber profile in one call (contact info only for people allowed to see it).
create or replace function staff_profile(mid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_member(m.location_id) then jsonb_build_object(
    'membership_id', m.id, 'user_id', m.user_id, 'location_id', m.location_id,
    'name', coalesce(nullif(p.full_name, ''), p.email),
    'role', m.role, 'status', m.status, 'start_date', m.start_date, 'chair', c.label, 'bookable', m.bookable,
    'email', case when is_my_membership(m.id) or has_permission(m.location_id, 'roster.view') then p.email end,
    'phone', case when is_my_membership(m.id) or has_permission(m.location_id, 'roster.view') then p.phone end,
    'license', case when is_my_membership(m.id) or has_permission(m.location_id, 'roster.view') then jsonb_build_object(
        'number', r.license_number, 'state', r.license_state, 'expires', r.license_expires,
        'status', coalesce(r.license_status,
                    case when r.license_expires is null then null
                         when r.license_expires < current_date then 'expired'
                         else 'active' end),
        'insurance_expires', r.insurance_expires) end
  ) end
  from memberships m
  join profiles p on p.id = m.user_id
  left join chairs c on c.id = m.chair_id
  left join staff_records r on r.membership_id = m.id
  where m.id = mid
$$;
grant execute on function staff_profile(uuid) to authenticated;

-- ---------- Staff document storage (private bucket) ----------
-- Files live at staff-docs/<location_id>/<membership_id>/<file>
insert into storage.buckets (id, name, public) values ('staff-docs', 'staff-docs', false)
on conflict (id) do nothing;

create or replace function staff_doc_allowed(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/'); loc uuid; mid uuid;
begin
  if array_length(parts, 1) < 3 then return false; end if;
  begin
    loc := parts[1]::uuid; mid := parts[2]::uuid;
  exception when others then return false;
  end;
  if membership_location(mid) is distinct from loc then return false; end if;
  return is_my_membership(mid)
      or (p_write and has_permission(loc, 'staff.manage'))
      or (not p_write and has_permission(loc, 'roster.view'));
end $$;
grant execute on function staff_doc_allowed(text, boolean) to authenticated;

create policy staff_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'staff-docs' and staff_doc_allowed(name, false));
create policy staff_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-docs' and staff_doc_allowed(name, true));
create policy staff_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'staff-docs' and staff_doc_allowed(name, true));

-- ---------- Booth rent: paid / late / partial ----------
create or replace view rent_status_view with (security_invoker = true) as
select c.id as charge_id, c.location_id, c.renter_id, c.due_on, c.amount_cents,
       coalesce(sum(p.amount_cents), 0) as paid_cents,
       c.amount_cents - coalesce(sum(p.amount_cents), 0) as balance_cents,
       case
         when c.amount_cents - coalesce(sum(p.amount_cents), 0) <= 0 then 'paid'
         when c.due_on < current_date then 'overdue'
         when coalesce(sum(p.amount_cents), 0) > 0 then 'partial'
         when c.due_on <= current_date + 3 then 'due_soon'
         else 'upcoming'
       end as display_status,
       (coalesce(sum(p.amount_cents), 0) > 0 and c.amount_cents - coalesce(sum(p.amount_cents), 0) > 0) as is_partial
from rent_charges c
left join rent_payments p on p.charge_id = c.id
group by c.id;

-- ---------- Client texting log ----------
create table if not exists message_log (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references locations(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  client_id      uuid references clients(id) on delete set null,
  kind           text not null check (kind in ('receipt', 'reminder', 'review')),
  channel        text not null default 'phone',
  sent_by        uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists message_log_appt_idx on message_log (appointment_id);
create index if not exists message_log_loc_idx on message_log (location_id, created_at desc);
alter table message_log enable row level security;
create policy message_log_rw on message_log for all
  using (has_permission(location_id, 'clients.message'))
  with check (has_permission(location_id, 'clients.message'));

-- ---------- Shop analytics ----------
create or replace function shop_analytics(loc uuid, p_from date default current_date - 30, p_to date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text; t0 timestamptz; t1 timestamptz; see_renters boolean; see_rent boolean; result jsonb;
begin
  if not has_permission(loc, 'analytics.view') then raise exception 'not allowed'; end if;
  select timezone into tz from locations where id = loc;
  t0 := (p_from::timestamp) at time zone tz;
  t1 := ((p_to + 1)::timestamp) at time zone tz;
  see_renters := is_super_admin();
  see_rent := has_permission(loc, 'rent.view');

  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'appointments', (select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'no_show', count(*) filter (where status = 'no_show'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'online', count(*) filter (where source = 'online'),
        'unique_clients', count(distinct client_id))
      from appointments where location_id = loc and starts_at >= t0 and starts_at < t1),
    'new_clients', (select count(*) from clients c
        where c.preferred_location = loc and c.created_at >= t0 and c.created_at < t1),
    'walk_ins', (select jsonb_build_object(
        'joined', count(*), 'served', count(*) filter (where status = 'served'),
        'left', count(*) filter (where status = 'removed'))
      from walkins where location_id = loc and joined_at >= t0 and joined_at < t1),
    'shop_sales', (select jsonb_build_object(
        'count', count(*),
        'net_cents', coalesce(sum(gross_cents - discount_cents - refund_cents), 0),
        'tip_cents', coalesce(sum(tip_cents), 0),
        'discount_cents', coalesce(sum(discount_cents), 0),
        'refund_cents', coalesce(sum(refund_cents), 0),
        'avg_ticket_cents', coalesce(round(avg(gross_cents - discount_cents - refund_cents)), 0))
      from sales where location_id = loc and not renter_owned and sold_at >= t0 and sold_at < t1),
    'renter_sales', case when see_renters then (select jsonb_build_object(
        'count', count(*), 'net_cents', coalesce(sum(gross_cents - discount_cents - refund_cents), 0),
        'tip_cents', coalesce(sum(tip_cents), 0))
      from sales where location_id = loc and renter_owned and sold_at >= t0 and sold_at < t1) end,
    'rent', case when see_rent then jsonb_build_object(
        'collected_cents', (select coalesce(sum(p.amount_cents), 0) from rent_payments p
                             join rent_charges c on c.id = p.charge_id
                            where c.location_id = loc and p.paid_at >= t0 and p.paid_at < t1),
        'outstanding_cents', (select coalesce(sum(balance_cents), 0) from rent_status_view
                               where location_id = loc and display_status <> 'paid'),
        'late', (select count(*) from rent_status_view where location_id = loc and display_status = 'overdue'),
        'partial', (select count(*) from rent_status_view where location_id = loc and is_partial)) end,
    'messages', (select jsonb_build_object(
        'reminders', count(*) filter (where kind = 'reminder'),
        'receipts', count(*) filter (where kind = 'receipt'),
        'reviews', count(*) filter (where kind = 'review'))
      from message_log where location_id = loc and created_at >= t0 and created_at < t1),
    'by_barber', coalesce((select jsonb_agg(row_to_json(b) order by b.net_cents desc, b.completed desc) from (
        select m.id as membership_id, coalesce(nullif(p.full_name, ''), p.email) as name, m.role,
          (select count(*) from appointments a where a.barber_id = m.id and a.status = 'completed'
             and a.starts_at >= t0 and a.starts_at < t1) as completed,
          (select count(*) from appointments a where a.barber_id = m.id and a.status = 'no_show'
             and a.starts_at >= t0 and a.starts_at < t1) as no_show,
          (select count(*) from walkins w where w.assigned_to = m.id and w.status = 'served'
             and w.joined_at >= t0 and w.joined_at < t1) as walk_ins,
          (select coalesce(sum(s.gross_cents - s.discount_cents - s.refund_cents), 0) from sales s
            where s.barber_id = m.id and s.sold_at >= t0 and s.sold_at < t1
              and (not s.renter_owned or see_renters)) as net_cents,
          (select coalesce(sum(s.tip_cents), 0) from sales s
            where s.barber_id = m.id and s.sold_at >= t0 and s.sold_at < t1
              and (not s.renter_owned or see_renters)) as tip_cents,
          (m.role = 'renter' and not see_renters) as sales_private
        from memberships m join profiles p on p.id = m.user_id
        where m.location_id = loc and m.status = 'active' and m.role in ('barber', 'renter', 'manager', 'partner')
      ) b), '[]'::jsonb)
  ) into result;
  return result;
end $$;
grant execute on function shop_analytics(uuid, date, date) to authenticated;

-- Audit the new tables too.
create trigger audit_message_log after insert on message_log for each row execute function audit_row();

-- Staff-only: run after this migration for existing locations:
--   select apply_role_defaults(id, true) from locations;
