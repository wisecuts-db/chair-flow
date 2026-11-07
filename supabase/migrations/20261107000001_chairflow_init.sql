-- =====================================================================
-- Chair Flow: starter schema for Supabase (Postgres 15+)
-- Roles per location, owner-controlled permission toggles, and
-- row-level security so the database itself enforces who sees what.
--
-- Run in the Supabase SQL editor or as a migration:
--   supabase migration new chairflow_init  (paste this file)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------
create type member_role       as enum ('owner', 'manager', 'barber', 'renter');
create type member_status     as enum ('invited', 'active', 'inactive');
create type appt_status       as enum ('booked', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');
create type appt_source       as enum ('online', 'staff', 'walk_in');
create type walkin_status     as enum ('waiting', 'assigned', 'served', 'removed');
create type contract_status   as enum ('draft', 'sent', 'signed', 'countersigned', 'void');
create type rent_cadence      as enum ('weekly', 'biweekly', 'monthly');
create type rent_status       as enum ('due', 'partial', 'paid', 'overdue', 'waived');
create type sale_kind         as enum ('service', 'retail');

-- Every toggle the owner can flip. Add keys here as features grow.
create type permission_key as enum (
  'schedule.view_all',      -- see the location's full schedule
  'schedule.manage_others', -- book / move other barbers' appointments
  'clients.view_all',       -- see shop clients' contact info
  'revenue.view',           -- see shop revenue and sales reports
  'earnings.view_others',   -- see other barbers' earnings
  'services.manage',        -- add / edit shop services and prices
  'payouts.run',            -- approve commission payouts
  'staff.manage',           -- invite / remove staff, edit roster
  'roster.view',            -- see roster records (licenses, documents)
  'rent.view',              -- see the booth rent ledger
  'walkins.manage',         -- run the walk-in queue
  'messages.send'           -- send announcements and promotions
);

-- ---------------------------------------------------------------------
-- 2. Core tables
-- ---------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  email       text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

create table locations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  name            text not null,
  address         text,
  timezone        text not null default 'America/New_York',
  hours           jsonb not null default '{}'::jsonb,   -- {"mon":[["09:00","19:00"]], ...}
  public_booking  boolean not null default true,
  allow_guest_booking boolean not null default true,
  policies_text   text,                                 -- cancellation / late / deposit policy shown before booking
  created_at      timestamptz not null default now()
);

create table chairs (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  label       text not null,
  unique (location_id, label)
);

-- A person's role at ONE location. Same person can hold different roles at different shops.
create table memberships (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  role         member_role not null,
  status       member_status not null default 'invited',
  start_date   date,
  chair_id     uuid references chairs(id),
  manager_id   uuid references memberships(id),
  bookable     boolean not null default true,     -- shows on the booking page
  created_at   timestamptz not null default now(),
  unique (location_id, user_id)
);
create index on memberships (user_id);

-- Owner's toggles, per location and role. Owner role is always allowed everything.
create table role_permissions (
  location_id  uuid not null references locations(id) on delete cascade,
  role         member_role not null check (role <> 'owner'),
  permission   permission_key not null,
  allowed      boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (location_id, role, permission)
);

-- ---------------------------------------------------------------------
-- 3. Permission helpers (security definer = can read memberships
--    without tripping their own RLS policies)
-- ---------------------------------------------------------------------
create or replace function my_role(loc uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select role from memberships
  where location_id = loc and user_id = auth.uid() and status = 'active'
$$;

create or replace function my_membership(loc uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from memberships
  where location_id = loc and user_id = auth.uid() and status = 'active'
$$;

create or replace function is_member(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select my_role(loc) is not null
$$;

create or replace function is_owner(loc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role(loc) = 'owner', false)
$$;

create or replace function has_permission(loc uuid, perm permission_key)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when my_role(loc) is null    then false
    when my_role(loc) = 'owner'  then true
    else coalesce((select allowed from role_permissions rp
                   where rp.location_id = loc and rp.role = my_role(loc) and rp.permission = perm), false)
  end
$$;

create or replace function membership_location(mid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select location_id from memberships where id = mid
$$;

create or replace function is_my_membership(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where id = mid and user_id = auth.uid())
$$;

create or replace function is_business_owner(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses where id = bid and owner_id = auth.uid())
$$;

create or replace function is_business_member(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from locations l where l.business_id = bid and is_member(l.id))
$$;

-- Default toggles for a new location (matches the product plan's table).
create or replace function seed_default_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into role_permissions (location_id, role, permission, allowed)
  select new.id, d.role::member_role, d.perm::permission_key, d.allowed
  from (values
    ('manager','schedule.view_all',true),  ('manager','schedule.manage_others',true),
    ('manager','clients.view_all',true),   ('manager','revenue.view',false),
    ('manager','earnings.view_others',false), ('manager','services.manage',true),
    ('manager','payouts.run',false),       ('manager','staff.manage',true),
    ('manager','roster.view',true),        ('manager','rent.view',false),
    ('manager','walkins.manage',true),     ('manager','messages.send',true),
    ('barber','schedule.view_all',true),   ('barber','schedule.manage_others',false),
    ('barber','clients.view_all',false),   ('barber','revenue.view',false),
    ('barber','earnings.view_others',false), ('barber','services.manage',false),
    ('barber','payouts.run',false),        ('barber','staff.manage',false),
    ('barber','roster.view',false),        ('barber','rent.view',false),
    ('barber','walkins.manage',true),      ('barber','messages.send',false),
    ('renter','schedule.view_all',false),  ('renter','schedule.manage_others',false),
    ('renter','clients.view_all',false),   ('renter','revenue.view',false),
    ('renter','earnings.view_others',false), ('renter','services.manage',false),
    ('renter','payouts.run',false),        ('renter','staff.manage',false),
    ('renter','roster.view',false),        ('renter','rent.view',false),
    ('renter','walkins.manage',true),      ('renter','messages.send',false)
  ) as d(role, perm, allowed);
  return new;
end $$;

create trigger locations_seed_permissions
after insert on locations for each row execute function seed_default_permissions();

-- The business owner automatically becomes 'owner' member of each new location.
create or replace function add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into memberships (location_id, user_id, role, status, bookable)
  select new.id, b.owner_id, 'owner', 'active', false
  from businesses b where b.id = new.business_id
  on conflict (location_id, user_id) do nothing;
  return new;
end $$;

create trigger locations_add_owner
after insert on locations for each row execute function add_owner_membership();

-- ---------------------------------------------------------------------
-- 4. Services, availability, clients, appointments, walk-ins
-- ---------------------------------------------------------------------
create table services (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references locations(id) on delete cascade,
  renter_id       uuid references memberships(id) on delete cascade,  -- null = shop service; set = a renter's own service
  name            text not null,
  price_cents     integer not null check (price_cents >= 0),
  duration_min    integer not null check (duration_min > 0),
  deposit_cents   integer not null default 0,
  active          boolean not null default true
);

create table availability (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references memberships(id) on delete cascade,
  weekday        smallint not null check (weekday between 0 and 6),
  starts         time not null,
  ends           time not null check (ends > starts)
);

create table time_off (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references memberships(id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null check (ends_at > starts_at),
  reason         text
);

-- Shop clients belong to the business; a renter's clients belong to the renter.
create table clients (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  renter_id         uuid references memberships(id) on delete cascade,  -- set = this renter's own client
  user_id           uuid references profiles(id),                       -- null = guest
  full_name         text not null,
  phone             text,
  email             text,
  birthday          date,
  preferred_location uuid references locations(id),
  preferred_barber  uuid references memberships(id),
  marketing_opt_in  boolean not null default false,
  notes             text,             -- notes the client chose to share
  created_at        timestamptz not null default now()
);
create index on clients (business_id);
create index on clients (user_id);

create table appointments (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references locations(id) on delete cascade,
  barber_id      uuid not null references memberships(id),
  client_id      uuid references clients(id),
  service_id     uuid references services(id),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null check (ends_at > starts_at),
  status         appt_status not null default 'booked',
  source         appt_source not null default 'online',
  client_notes   text,
  deposit_cents  integer not null default 0,
  created_at     timestamptz not null default now()
);
create index on appointments (location_id, starts_at);
create index on appointments (barber_id, starts_at);

create table walkins (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references locations(id) on delete cascade,
  name             text not null,
  phone            text,
  service_id       uuid references services(id),
  preferred_barber uuid references memberships(id),   -- null = first available
  status           walkin_status not null default 'waiting',
  assigned_to      uuid references memberships(id),
  joined_at        timestamptz not null default now(),
  notified_at      timestamptz
);
create index on walkins (location_id, status, joined_at);

-- ---------------------------------------------------------------------
-- 5. Roster records (sensitive), contracts, rent
-- ---------------------------------------------------------------------
create table staff_records (
  membership_id        uuid primary key references memberships(id) on delete cascade,
  license_number       text,
  license_state        text,
  license_expires      date,
  emergency_contact    text,
  job_title            text,           -- employees
  pay_type             text,           -- employees: 'commission' | 'hourly' | 'salary'
  commission_pct       numeric(5,2),
  insurance_expires    date,           -- renters, if the shop requires it
  updated_at           timestamptz not null default now()
);

create table staff_documents (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references memberships(id) on delete cascade,
  kind           text not null,         -- 'license' | 'insurance' | 'w9' | 'policy_ack' | ...
  storage_path   text not null,         -- private bucket: staff-docs/<location>/<membership>/<file>
  expires_on     date,
  uploaded_at    timestamptz not null default now()
);

create table contract_templates (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  body         text not null,           -- with {{rent_amount}}, {{chair}}, {{start_date}} placeholders
  version      integer not null default 1,
  created_at   timestamptz not null default now()
);

create table contracts (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references locations(id) on delete cascade,
  renter_id          uuid not null references memberships(id),
  template_id        uuid references contract_templates(id),
  version            integer not null default 1,
  supersedes         uuid references contracts(id),     -- earlier version kept for records
  rent_cents         integer not null check (rent_cents >= 0),
  cadence            rent_cadence not null default 'weekly',
  chair_id           uuid references chairs(id),
  start_date         date not null,
  end_date           date,
  status             contract_status not null default 'draft',
  sent_at            timestamptz,
  signed_at          timestamptz,
  countersigned_at   timestamptz,
  signed_pdf_path    text,                                -- private bucket: contracts/...
  created_at         timestamptz not null default now()
);

create table rent_charges (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts(id),
  location_id   uuid not null references locations(id),
  renter_id     uuid not null references memberships(id),
  period_start  date not null,
  due_on        date not null,
  amount_cents  integer not null,
  status        rent_status not null default 'due',
  note          text
);
create index on rent_charges (location_id, due_on);

-- Payments, credits and adjustments. Credits are negative amounts.
create table rent_payments (
  id            uuid primary key default gen_random_uuid(),
  charge_id     uuid not null references rent_charges(id),
  amount_cents  integer not null,
  paid_at       timestamptz not null default now(),
  method        text,                 -- 'cash' | 'card' | 'ach' | 'credit' | ...
  reference     text,                 -- processor transaction id
  note          text
);

-- ---------------------------------------------------------------------
-- 6. Sales and audit
-- ---------------------------------------------------------------------
create table sales (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references locations(id),
  barber_id       uuid references memberships(id),
  appointment_id  uuid references appointments(id),
  client_id       uuid references clients(id),
  kind            sale_kind not null default 'service',
  description     text,
  gross_cents     integer not null,
  discount_cents  integer not null default 0,
  refund_cents    integer not null default 0,
  tip_cents       integer not null default 0,
  renter_owned    boolean not null default false,   -- a renter's own sale: hidden from the shop
  is_walk_in      boolean not null default false,
  external_source text,                             -- 'square' | 'stripe' | ...
  external_id     text,                             -- POS transaction id
  sold_at         timestamptz not null default now(),
  unique (external_source, external_id)             -- prevents double-counting imports
);
create index on sales (location_id, sold_at);

create table audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid default auth.uid(),
  location_id uuid,
  action      text not null,          -- 'insert' | 'update' | 'delete' | 'view_document'
  table_name  text not null,
  row_id      text,
  old_data    jsonb,
  new_data    jsonb
);
create index on audit_log (location_id, at desc);

create or replace function audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  loc uuid;
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  loc := coalesce((rec->>'location_id')::uuid,
                  membership_location((rec->>'membership_id')::uuid));
  insert into audit_log (location_id, action, table_name, row_id, old_data, new_data)
  values (loc, lower(tg_op), tg_table_name,
          coalesce(rec->>'id', rec->>'membership_id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_contracts     after insert or update or delete on contracts      for each row execute function audit_row();
create trigger audit_rent_charges  after insert or update or delete on rent_charges   for each row execute function audit_row();
create trigger audit_staff_records after insert or update or delete on staff_records  for each row execute function audit_row();
create trigger audit_role_perms    after insert or update or delete on role_permissions for each row execute function audit_row();

-- Payments have no location_id column; log them against their charge's location.
create or replace function audit_rent_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r rent_payments := coalesce(new, old);
begin
  insert into audit_log (location_id, action, table_name, row_id, old_data, new_data)
  select c.location_id, lower(tg_op), 'rent_payments', r.id::text,
         case when tg_op <> 'INSERT' then to_jsonb(old) end,
         case when tg_op <> 'DELETE' then to_jsonb(new) end
  from rent_charges c where c.id = r.charge_id;
  return r;
end $$;
create trigger audit_rent_payments after insert or update or delete on rent_payments for each row execute function audit_rent_payment();

-- Used by the appointments policy (kept out of policy subqueries to avoid RLS loops).
create or replace function is_my_client_record(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients where id = cid and user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 7. Row-level security
-- ---------------------------------------------------------------------
alter table profiles          enable row level security;
alter table businesses        enable row level security;
alter table locations         enable row level security;
alter table chairs            enable row level security;
alter table memberships       enable row level security;
alter table role_permissions  enable row level security;
alter table services          enable row level security;
alter table availability      enable row level security;
alter table time_off          enable row level security;
alter table clients           enable row level security;
alter table appointments      enable row level security;
alter table walkins           enable row level security;
alter table staff_records     enable row level security;
alter table staff_documents   enable row level security;
alter table contract_templates enable row level security;
alter table contracts         enable row level security;
alter table rent_charges      enable row level security;
alter table rent_payments     enable row level security;
alter table sales             enable row level security;
alter table audit_log         enable row level security;

-- Profiles: yourself, plus anyone you share a location with.
create policy profiles_self on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_coworkers on profiles for select
  using (exists (select 1 from memberships m
                 where m.user_id = profiles.id and is_member(m.location_id)));

-- Businesses
create policy businesses_owner on businesses for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy businesses_members on businesses for select
  using (is_business_member(id));

-- Locations: public ones are visible for booking; owners manage.
create policy locations_public on locations for select using (public_booking or is_member(id));
create policy locations_owner_write on locations for all
  using (is_business_owner(business_id)) with check (is_business_owner(business_id));

create policy chairs_read  on chairs for select using (is_member(location_id));
create policy chairs_write on chairs for all using (has_permission(location_id, 'staff.manage'))
  with check (has_permission(location_id, 'staff.manage'));

-- Memberships: everyone at a location sees who works there (names on the schedule).
-- Bookable staff at public locations are visible to clients choosing a barber.
create policy memberships_read on memberships for select
  using (user_id = auth.uid() or is_member(location_id)
         or (bookable and status = 'active' and role <> 'owner'
             and exists (select 1 from locations l where l.id = location_id and l.public_booking)));
create policy memberships_manage on memberships for all
  using (has_permission(location_id, 'staff.manage') and (role <> 'owner' or is_owner(location_id)))
  with check (has_permission(location_id, 'staff.manage') and (role <> 'owner' or is_owner(location_id)));

-- Permission toggles: members can read their location's; only the owner changes them.
create policy role_permissions_read  on role_permissions for select using (is_member(location_id));
create policy role_permissions_owner on role_permissions for all
  using (is_owner(location_id)) with check (is_owner(location_id));

-- Services: public read of active services; shop services need services.manage;
-- a renter manages only their own.
create policy services_read on services for select using (active or is_member(location_id));
create policy services_shop_write on services for all
  using (renter_id is null and has_permission(location_id, 'services.manage'))
  with check (renter_id is null and has_permission(location_id, 'services.manage'));
create policy services_renter_write on services for all
  using (renter_id is not null and is_my_membership(renter_id))
  with check (renter_id is not null and is_my_membership(renter_id));

-- Availability and time off: public read (to compute open slots); self or managers write.
create policy availability_read  on availability for select using (true);
create policy availability_write on availability for all
  using (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'staff.manage'))
  with check (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'staff.manage'));
create policy time_off_read on time_off for select using (is_member(membership_location(membership_id)));
create policy time_off_write on time_off for all
  using (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'staff.manage'))
  with check (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'staff.manage'));

-- Clients:
--   * a client sees and edits their own profile
--   * a renter's clients are visible only to that renter
--   * shop clients: owner, staff with clients.view_all, or a barber who has served / is booked with them
create policy clients_self on clients for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy clients_renter_own on clients for all
  using (renter_id is not null and is_my_membership(renter_id))
  with check (renter_id is not null and is_my_membership(renter_id));
create policy clients_shop on clients for select
  using (renter_id is null and exists (
    select 1 from locations l
    where l.business_id = clients.business_id
      and (has_permission(l.id, 'clients.view_all')
           or exists (select 1 from appointments a
                      where a.client_id = clients.id and a.location_id = l.id
                        and a.barber_id = my_membership(l.id)))));
create policy clients_shop_write on clients for insert
  with check (renter_id is null and exists (
    select 1 from locations l where l.business_id = clients.business_id and is_member(l.id)));

-- Appointments:
--   * the barber/renter on the appointment
--   * the client who booked it
--   * staff with schedule.view_all (renters' slots show as busy; client details stay fenced in clients)
create policy appointments_own on appointments for all
  using (is_my_membership(barber_id)) with check (is_my_membership(barber_id));
create policy appointments_client on appointments for select
  using (is_my_client_record(client_id));
create policy appointments_view_all on appointments for select
  using (has_permission(location_id, 'schedule.view_all'));
create policy appointments_manage_others on appointments for all
  using (has_permission(location_id, 'schedule.manage_others')
         and (select role from memberships where id = barber_id) <> 'renter')
  with check (has_permission(location_id, 'schedule.manage_others')
         and (select role from memberships where id = barber_id) <> 'renter');

-- Walk-ins: staff with walkins.manage. The kiosk inserts through join_walkin() below.
create policy walkins_staff on walkins for all
  using (has_permission(location_id, 'walkins.manage'))
  with check (has_permission(location_id, 'walkins.manage'));

-- Roster records: owner / roster.view, plus your own record.
create policy staff_records_read on staff_records for select
  using (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'roster.view'));
create policy staff_records_write on staff_records for all
  using (has_permission(membership_location(membership_id), 'staff.manage'))
  with check (has_permission(membership_location(membership_id), 'staff.manage'));
create policy staff_documents_read on staff_documents for select
  using (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'roster.view'));
create policy staff_documents_write on staff_documents for all
  using (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'staff.manage'))
  with check (is_my_membership(membership_id) or has_permission(membership_location(membership_id), 'staff.manage'));

-- Contracts: owner manages; the renter reads their own and signs via sign_contract().
create policy contract_templates_owner on contract_templates for all
  using (is_business_owner(business_id)) with check (is_business_owner(business_id));
create policy contracts_owner on contracts for all
  using (is_owner(location_id)) with check (is_owner(location_id));
create policy contracts_renter on contracts for select
  using (is_my_membership(renter_id) and status <> 'draft');

-- Rent: owner manages; rent.view can read; renter reads own.
create policy rent_charges_owner on rent_charges for all
  using (is_owner(location_id)) with check (is_owner(location_id));
create policy rent_charges_read on rent_charges for select
  using (has_permission(location_id, 'rent.view') or is_my_membership(renter_id));
create policy rent_payments_owner on rent_payments for all
  using (exists (select 1 from rent_charges c where c.id = charge_id and is_owner(c.location_id)))
  with check (exists (select 1 from rent_charges c where c.id = charge_id and is_owner(c.location_id)));
create policy rent_payments_read on rent_payments for select
  using (exists (select 1 from rent_charges c where c.id = charge_id
                 and (has_permission(c.location_id, 'rent.view') or is_my_membership(c.renter_id))));

-- Sales:
--   * renter-owned sales: only that renter
--   * shop sales: owner / revenue.view see all; earnings.view_others too; barbers see their own
create policy sales_renter on sales for all
  using (renter_owned and is_my_membership(barber_id))
  with check (renter_owned and is_my_membership(barber_id));
create policy sales_shop_read on sales for select
  using (not renter_owned and (
    has_permission(location_id, 'revenue.view')
    or has_permission(location_id, 'earnings.view_others')
    or is_my_membership(barber_id)));
create policy sales_shop_write on sales for insert
  with check (not renter_owned and is_member(location_id)
              and my_role(location_id) <> 'renter');

-- Audit log: owner reads; nobody writes directly (triggers and functions only).
create policy audit_owner_read on audit_log for select using (is_owner(location_id));

-- ---------------------------------------------------------------------
-- 8. Functions for public / kiosk actions and audited access
-- ---------------------------------------------------------------------

-- Kiosk or remote walk-in: anyone can add themselves to a location's queue, nothing more.
create or replace function join_walkin(loc uuid, p_name text, p_phone text,
                                       p_service uuid default null, p_barber uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not exists (select 1 from locations where id = loc and public_booking) then
    raise exception 'location not accepting walk-ins';
  end if;
  if length(coalesce(p_name, '')) = 0 then raise exception 'name required'; end if;
  insert into walkins (location_id, name, phone, service_id, preferred_barber)
  values (loc, left(p_name, 80), left(p_phone, 20), p_service, p_barber)
  returning id into new_id;
  return new_id;
end $$;

-- Queue position for a walk-in (what the client sees after signing in).
create or replace function walkin_position(w uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from walkins o, walkins me
  where me.id = w and o.location_id = me.location_id
    and o.status = 'waiting' and o.joined_at <= me.joined_at
$$;

-- Renter signs their own contract.
create or replace function sign_contract(c uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update contracts set status = 'signed', signed_at = now()
  where id = c and status = 'sent' and is_my_membership(renter_id);
  if not found then raise exception 'contract not found or not awaiting your signature'; end if;
end $$;

-- Every time the app opens a sensitive document, call this to get the path and log the view.
create or replace function open_staff_document(doc uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d staff_documents;
begin
  select * into d from staff_documents where id = doc;
  if d.id is null or not (is_my_membership(d.membership_id)
                          or has_permission(membership_location(d.membership_id), 'roster.view')) then
    raise exception 'not allowed';
  end if;
  insert into audit_log (location_id, action, table_name, row_id)
  values (membership_location(d.membership_id), 'view_document', 'staff_documents', d.id::text);
  return d.storage_path;   -- app then requests a short-lived signed URL from Storage
end $$;

revoke all on function join_walkin(uuid, text, text, uuid, uuid) from public;
grant execute on function join_walkin(uuid, text, text, uuid, uuid) to anon, authenticated;
grant execute on function walkin_position(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Handy views
-- ---------------------------------------------------------------------
-- Rent status for the owner dashboard (security_invoker = RLS of the caller applies).
create view rent_status_view with (security_invoker = true) as
select c.id as charge_id, c.location_id, c.renter_id, c.due_on, c.amount_cents,
       coalesce(sum(p.amount_cents), 0) as paid_cents,
       c.amount_cents - coalesce(sum(p.amount_cents), 0) as balance_cents,
       case
         when c.amount_cents - coalesce(sum(p.amount_cents), 0) <= 0 then 'paid'
         when c.due_on < current_date then 'overdue'
         when c.due_on <= current_date + 3 then 'due_soon'
         else 'upcoming'
       end as display_status
from rent_charges c
left join rent_payments p on p.charge_id = c.id
group by c.id;

-- Net sales clearly labeled (gross, discounts, refunds, tips, net).
create view sales_daily with (security_invoker = true) as
select location_id, barber_id, date_trunc('day', sold_at)::date as day,
       sum(gross_cents)    as gross_cents,
       sum(discount_cents) as discount_cents,
       sum(refund_cents)   as refund_cents,
       sum(tip_cents)      as tip_cents,
       sum(gross_cents - discount_cents - refund_cents) as net_cents,
       count(*) filter (where is_walk_in)     as walk_in_count,
       count(*) filter (where not is_walk_in) as appointment_count
from sales
group by 1, 2, 3;
