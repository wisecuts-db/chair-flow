-- Trigger-only functions: nobody calls these through the API.
revoke execute on function handle_new_user()          from public, anon, authenticated;
revoke execute on function add_owner_membership()     from public, anon, authenticated;
revoke execute on function seed_default_permissions() from public, anon, authenticated;
revoke execute on function audit_row()                from public, anon, authenticated;
revoke execute on function audit_rent_payment()       from public, anon, authenticated;

-- Signed-in only.
revoke execute on function sign_contract(uuid)        from public, anon;
revoke execute on function open_staff_document(uuid)  from public, anon;
revoke execute on function create_shop(text, text, text) from anon;
revoke execute on function accept_invites()           from anon;
grant execute on function sign_contract(uuid), open_staff_document(uuid) to authenticated;

-- Make sure future functions are not public by default.
alter default privileges in schema public revoke execute on functions from public, anon;
