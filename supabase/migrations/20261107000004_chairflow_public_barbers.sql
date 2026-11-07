-- Names of bookable barbers for the public booking page and kiosk (no contact info).
create or replace function public_barbers(loc uuid)
returns table (id uuid, name text, role member_role)
language sql stable security definer set search_path = public as $$
  select m.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), m.role
  from memberships m
  join profiles p on p.id = m.user_id
  join locations l on l.id = m.location_id
  where m.location_id = loc and l.public_booking
    and m.status = 'active' and m.bookable and m.role <> 'owner'
  order by 2
$$;
grant execute on function public_barbers(uuid) to anon, authenticated;

-- Staff list with names for signed-in members of a location.
create or replace function location_staff(loc uuid)
returns table (membership_id uuid, user_id uuid, name text, email text, role member_role,
               status member_status, chair text, bookable boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.user_id, coalesce(nullif(p.full_name, ''), p.email),
         case when has_permission(loc, 'staff.manage') or m.user_id = auth.uid() then p.email end,
         m.role, m.status, c.label, m.bookable
  from memberships m
  join profiles p on p.id = m.user_id
  left join chairs c on c.id = m.chair_id
  where m.location_id = loc and is_member(loc)
  order by m.role, 3
$$;
grant execute on function location_staff(uuid) to authenticated;
