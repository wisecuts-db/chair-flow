-- Super admin is tied to a specific account (user_id). A pre-authorized email is claimed
-- once, by the first account created with it; after that it belongs to that account only.
alter table platform_admins add column if not exists user_id uuid unique references auth.users(id);
alter table platform_admins add column if not exists active boolean not null default false;

create or replace function is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins pa where pa.user_id = uid and pa.active)
$$;

create or replace function grant_super_admins(loc uuid)
returns void language sql security definer set search_path = public as $$
  insert into memberships (location_id, user_id, role, status, bookable)
  select loc, pa.user_id, 'owner', 'active', false
  from platform_admins pa join profiles p on p.id = pa.user_id
  where pa.active
  on conflict (location_id, user_id) do update set role = 'owner', status = 'active'
$$;

create or replace function make_super_admin(p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare em text;
begin
  select lower(email) into em from auth.users where id = p_user;
  if em is null then raise exception 'no such account'; end if;
  insert into platform_admins (email, user_id, active, note) values (em, p_user, true, p_note)
  on conflict (email) do update set user_id = excluded.user_id, active = true, note = coalesce(excluded.note, platform_admins.note);
  insert into memberships (location_id, user_id, role, status, bookable)
  select l.id, p_user, 'owner', 'active', false from locations l
  on conflict (location_id, user_id) do update set role = 'owner', status = 'active';
end $$;

create or replace function retire_account(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update memberships set status = 'inactive' where user_id = p_user;
  update profiles set email = null where id = p_user;
  update auth.identities set identity_data = jsonb_build_object('sub', provider_id, 'retired', true),
         provider_id = 'retired-' || provider_id where user_id = p_user;
  update auth.users set email = 'retired+' || p_user || '@deleted.invalid',
         encrypted_password = null, banned_until = 'infinity' where id = p_user;
end $$;

create or replace function claim_super_admin(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare em text; claimed int;
begin
  select lower(email) into em from auth.users where id = p_user;
  if em is null then return false; end if;
  update platform_admins set user_id = p_user where email = em and active and user_id is null;
  get diagnostics claimed = row_count;
  if claimed > 0 or is_super_admin(p_user) then
    insert into memberships (location_id, user_id, role, status, bookable)
    select l.id, p_user, 'owner', 'active', false from locations l
    on conflict (location_id, user_id) do update set role = 'owner', status = 'active';
    return true;
  end if;
  return false;
end $$;

create or replace function profile_add_super_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform claim_super_admin(new.id);
  return new;
end $$;

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
  perform claim_super_admin(auth.uid());
  return n;
end $$;

create or replace function preauthorize_super_admin(p_email text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into platform_admins (email, user_id, active, note) values (lower(p_email), null, true, p_note)
  on conflict (email) do update set user_id = null, active = true, note = coalesce(excluded.note, platform_admins.note)
$$;

revoke execute on function grant_super_admins(uuid), make_super_admin(uuid, text), retire_account(uuid),
  claim_super_admin(uuid), preauthorize_super_admin(text, text) from public, anon, authenticated;
revoke execute on function accept_invites() from public, anon;
grant execute on function accept_invites() to authenticated;

-- Applied by hand on 2026-11-10 (data, not schema):
--   select retire_account('e4145567-e722-4088-96f6-8974616c7c34');   -- old unused wisecutsceo login
--   select preauthorize_super_admin('wisecutsceo@gmail.com', 'ShopBoss CEO (Jimmy)');
