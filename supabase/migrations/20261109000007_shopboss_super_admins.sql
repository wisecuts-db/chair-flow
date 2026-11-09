-- =====================================================================
-- Platform super admins: owner-level access to every business and location.
--  * listed in platform_admins (by email, so they can be added before signing up)
--  * get an active 'owner' membership at every location, existing and future
--  * count as business owner everywhere (edit locations, contract templates)
-- Renter privacy still applies: a renter's own sales and clients stay private.
-- =====================================================================

create table platform_admins (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now(),
  note       text
);
alter table platform_admins enable row level security;
-- No API policies: only the database owner (SQL / migrations) manages this list.

create or replace function is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from platform_admins pa
    join auth.users u on lower(u.email) = pa.email
    where u.id = uid)
$$;

create or replace function is_business_owner(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses where id = bid and owner_id = auth.uid())
      or is_super_admin()
$$;

-- Give every super admin an owner membership at a location.
create or replace function grant_super_admins(loc uuid)
returns void language sql security definer set search_path = public as $$
  insert into memberships (location_id, user_id, role, status, bookable)
  select loc, u.id, 'owner', 'active', false
  from platform_admins pa
  join auth.users u on lower(u.email) = pa.email
  join profiles p on p.id = u.id
  on conflict (location_id, user_id) do update set role = 'owner', status = 'active'
$$;

-- New locations: add super admins automatically.
create or replace function locations_add_super_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform grant_super_admins(new.id);
  return new;
end $$;
create trigger locations_super_admins
after insert on locations for each row execute function locations_add_super_admins();

-- A super admin signing up later: add them to every existing location.
create or replace function profile_add_super_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_super_admin(new.id) then
    insert into memberships (location_id, user_id, role, status, bookable)
    select l.id, new.id, 'owner', 'active', false from locations l
    on conflict (location_id, user_id) do update set role = 'owner', status = 'active';
  end if;
  return new;
end $$;
create trigger profiles_super_admin
after insert on profiles for each row execute function profile_add_super_admin();

-- Also catch up on sign-in (covers admins added after their profile existed).
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
  if is_super_admin() then
    insert into memberships (location_id, user_id, role, status, bookable)
    select l.id, auth.uid(), 'owner', 'active', false from locations l
    on conflict (location_id, user_id) do update set role = 'owner', status = 'active';
  end if;
  return n;
end $$;

revoke execute on function grant_super_admins(uuid)        from public, anon, authenticated;
revoke execute on function locations_add_super_admins()    from public, anon, authenticated;
revoke execute on function profile_add_super_admin()       from public, anon, authenticated;
revoke execute on function is_super_admin(uuid)            from public, anon;
grant  execute on function is_super_admin(uuid)            to authenticated;
revoke execute on function accept_invites()                from public, anon;
grant  execute on function accept_invites()                to authenticated;

insert into platform_admins (email, note) values ('wisecutsceo@gmail.com', 'ShopBoss CEO');
