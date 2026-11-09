-- 1. Super admins can see booth renters' own sales (platform metrics).
--    Shop owners still can't; renters' client lists stay private.
create policy sales_super_admin_read on sales for select using (is_super_admin());

-- Split renter-owned sales out in the daily rollup so dashboards don't mix them
-- into shop revenue.
create or replace view sales_daily with (security_invoker = true) as
select location_id, barber_id, date_trunc('day', sold_at)::date as day,
       sum(gross_cents)    as gross_cents,
       sum(discount_cents) as discount_cents,
       sum(refund_cents)   as refund_cents,
       sum(tip_cents)      as tip_cents,
       sum(gross_cents - discount_cents - refund_cents) as net_cents,
       count(*) filter (where is_walk_in)     as walk_in_count,
       count(*) filter (where not is_walk_in) as appointment_count,
       renter_owned
from sales
group by location_id, barber_id, date_trunc('day', sold_at)::date, renter_owned;

-- Barber report: super admins see renters' sales too.
create or replace function can_view_barber(mid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_owner(membership_location(mid))
      or has_permission(membership_location(mid), 'earnings.view_others')
      or is_my_membership(mid)
      or is_super_admin()
$$;

do $$
declare src text;
begin
  select pg_get_functiondef('barber_summary(uuid,date,date)'::regprocedure) into src;
  src := replace(src, 'show_money := m.role <> ''renter'' or is_my_membership(p_membership);',
                      'show_money := m.role <> ''renter'' or is_my_membership(p_membership) or is_super_admin();');
  src := replace(src, 'and (not renter_owned or is_my_membership(m.id))',
                      'and (not renter_owned or is_my_membership(m.id) or is_super_admin())');
  execute src;
end $$;

-- 2. Delete my account (required by Apple for apps with sign-up).
-- Removes personal data and blocks sign-in, but keeps the shop's business records
-- (appointments, sales, audit trail) intact with the person shown as "Deleted user".
create or replace function delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if exists (select 1 from businesses b where b.owner_id = me
             and exists (select 1 from memberships m join locations l on l.id = m.location_id
                         where l.business_id = b.id and m.user_id <> me and m.status = 'active'
                           and not is_super_admin(m.user_id))) then
    raise exception 'You own a shop that still has staff. Remove your staff or contact support before deleting your account.';
  end if;
  update memberships set status = 'inactive' where user_id = me;
  update profiles set full_name = 'Deleted user', email = null, phone = null, avatar_url = null where id = me;
  update clients set full_name = 'Deleted user', email = null, phone = null, birthday = null, notes = null where user_id = me;
  delete from auth.identities where user_id = me;
  delete from auth.sessions where user_id = me;
  update auth.users
     set email = 'deleted+' || me || '@deleted.invalid', phone = null, encrypted_password = null,
         raw_user_meta_data = '{}'::jsonb, banned_until = 'infinity'
   where id = me;
end $$;
revoke execute on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
