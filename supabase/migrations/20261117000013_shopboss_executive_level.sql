-- "Executive" = platform super admin (above owner, every shop).
-- Executives also see booth renters' private client lists (renters' sales were already visible).
create policy clients_executive_read on clients for select using (is_super_admin());

create or replace function list_executives()
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from platform_admins where active and user_id is not null
$$;
revoke execute on function list_executives() from public, anon;
grant execute on function list_executives() to authenticated;

-- Three visible levels: Owner, Manager, Barber. Managing partners become managers.
create or replace function fold_partners_into_managers()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update memberships set role = 'manager' where role = 'partner';
  get diagnostics n = row_count;
  update invites set role = 'manager' where role = 'partner' and accepted_at is null;
  return n;
end $$;
revoke execute on function fold_partners_into_managers() from public, anon, authenticated;

-- Applied by hand on 2026-11-17:
--   select make_super_admin('02527675-8738-4732-9fa1-5ffd419f38a4', 'Executive (account owner)');  -- admin@wisecuts.com
--   select fold_partners_into_managers();
