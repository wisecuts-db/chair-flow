-- Create a profile row for every new auth user.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, phone, full_name)
  values (new.id, new.email, new.phone, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function handle_new_user();

-- Onboarding: an owner creates their business and first location in one step.
create or replace function create_shop(p_business text, p_location text, p_address text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid; l uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into profiles (id) values (auth.uid()) on conflict do nothing;
  insert into businesses (name, owner_id) values (p_business, auth.uid()) returning id into b;
  insert into locations (business_id, name, address) values (b, p_location, p_address) returning id into l;
  return l;
end $$;
revoke all on function create_shop(text, text, text) from public, anon;
grant execute on function create_shop(text, text, text) to authenticated;

-- Busy times for public booking (no client details leak).
create or replace function busy_times(loc uuid, day date)
returns table (barber_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.barber_id, a.starts_at, a.ends_at from appointments a
  join locations l on l.id = a.location_id
  where a.location_id = loc and l.public_booking
    and a.status not in ('cancelled', 'no_show')
    and (a.starts_at at time zone l.timezone)::date = day
  union all
  select t.membership_id, t.starts_at, t.ends_at from time_off t
  join memberships m on m.id = t.membership_id
  join locations l on l.id = m.location_id
  where m.location_id = loc and l.public_booking
    and (t.starts_at at time zone l.timezone)::date <= day
    and (t.ends_at at time zone l.timezone)::date >= day
$$;
grant execute on function busy_times(uuid, date) to anon, authenticated;

-- Public booking: works for guests and signed-in clients. Puts the client in the
-- shop's book, or in the renter's own book when the barber is a booth renter.
create or replace function book_appointment(
  p_location uuid, p_barber uuid, p_service uuid, p_starts timestamptz,
  p_name text, p_phone text, p_email text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  loc locations; svc services; bar memberships; cid uuid; aid uuid; p_ends timestamptz;
begin
  select * into loc from locations where id = p_location and public_booking;
  if loc.id is null then raise exception 'location not taking online bookings'; end if;
  if auth.uid() is null and not loc.allow_guest_booking then raise exception 'please sign in to book'; end if;
  select * into svc from services where id = p_service and location_id = p_location and active;
  if svc.id is null then raise exception 'service not available'; end if;
  select * into bar from memberships where id = p_barber and location_id = p_location
    and status = 'active' and bookable and role <> 'owner';
  if bar.id is null then raise exception 'barber not available'; end if;
  if svc.renter_id is not null and svc.renter_id <> bar.id then raise exception 'service not offered by this barber'; end if;
  if length(coalesce(p_name, '')) = 0 or length(coalesce(p_phone, '')) < 7 then raise exception 'name and phone required'; end if;
  if p_starts < now() then raise exception 'time is in the past'; end if;

  p_ends := p_starts + make_interval(mins => svc.duration_min);
  if exists (select 1 from appointments a where a.barber_id = bar.id
             and a.status not in ('cancelled', 'no_show')
             and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_starts, p_ends)) then
    raise exception 'that time was just taken';
  end if;

  select c.id into cid from clients c
  where c.business_id = loc.business_id
    and c.renter_id is not distinct from (case when bar.role = 'renter' then bar.id end)
    and ((auth.uid() is not null and c.user_id = auth.uid()) or c.phone = p_phone)
  limit 1;
  if cid is null then
    insert into clients (business_id, renter_id, user_id, full_name, phone, email, preferred_location, preferred_barber)
    values (loc.business_id, case when bar.role = 'renter' then bar.id end, auth.uid(),
            left(p_name, 80), left(p_phone, 20), left(p_email, 120), loc.id, bar.id)
    returning id into cid;
  end if;

  insert into appointments (location_id, barber_id, client_id, service_id, starts_at, ends_at, source, client_notes)
  values (loc.id, bar.id, cid, svc.id, p_starts, p_ends, 'online', left(p_notes, 500))
  returning id into aid;
  return aid;
end $$;
revoke all on function book_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function book_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- Staff invite: owner/manager adds someone by email; they become active when they sign in.
create table invites (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id) on delete cascade,
  email        text not null,
  role         member_role not null check (role <> 'owner'),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  unique (location_id, email)
);
alter table invites enable row level security;
create policy invites_manage on invites for all
  using (has_permission(location_id, 'staff.manage'))
  with check (has_permission(location_id, 'staff.manage'));

create or replace function accept_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; me text;
begin
  select email into me from auth.users where id = auth.uid();
  if me is null then return 0; end if;
  insert into profiles (id, email) values (auth.uid(), me) on conflict do nothing;
  insert into memberships (location_id, user_id, role, status)
  select i.location_id, auth.uid(), i.role, 'active' from invites i
  where lower(i.email) = lower(me) and i.accepted_at is null
  on conflict (location_id, user_id) do update set status = 'active', role = excluded.role;
  get diagnostics n = row_count;
  update invites set accepted_at = now() where lower(email) = lower(me) and accepted_at is null;
  return n;
end $$;
revoke all on function accept_invites() from public, anon;
grant execute on function accept_invites() to authenticated;
