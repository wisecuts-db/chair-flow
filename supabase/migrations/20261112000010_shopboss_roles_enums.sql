-- New role and permissions (enum values must be committed before use).
alter type member_role add value if not exists 'partner' after 'owner';
alter type permission_key add value if not exists 'analytics.view';
alter type permission_key add value if not exists 'clients.message';
