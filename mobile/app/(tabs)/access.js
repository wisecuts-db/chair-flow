import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useShop } from '../../lib/shop';
import { Badge, C, ErrorText, Item, List, Screen, T, Title } from '../../components/ui';

// Mirrors the permission_key enum. `fixed` = what that role gets no matter the toggle.
const DEFS = [
  { key: 'roster.view', label: "Each barber's profile & documents", hint: 'Licenses, contracts, 1099s, W-9s; every view is logged', fixed: { barber: 'Own only', renter: 'Own only' } },
  { key: 'schedule.view_all', label: 'Appointments, whole shop', hint: "See every barber's bookings" },
  { key: 'schedule.manage_others', label: 'Book for other barbers', hint: "Move or add others' appointments (never renters')", fixed: { barber: 'Never', renter: 'Never' } },
  { key: 'rent.view', label: 'Booth rent status, all barbers', hint: 'Paid, late and partial payments', fixed: { barber: 'Hidden', renter: 'Own only' } },
  { key: 'walkins.manage', label: 'Walk-in list', hint: 'See and run the walk-in line' },
  { key: 'clients.view_all', label: 'Client contact list', hint: 'Phone and email of all shop clients', fixed: { renter: 'Own clients only' } },
  { key: 'analytics.view', label: 'Shop analytics', hint: 'Sales, no-shows, walk-ins, rent, by barber', fixed: { barber: 'Personal only', renter: 'Personal only' } },
  { key: 'clients.message', label: 'Send receipts, reminders and review requests', hint: 'One-tap texts to clients' },
  { key: 'revenue.view', label: 'Shop revenue on the home screen', hint: "Today's sales total", fixed: { barber: 'Hidden', renter: 'Hidden' } },
  { key: 'earnings.view_others', label: "Other barbers' earnings", hint: 'Sales by barber in their profiles', fixed: { barber: 'Own only', renter: 'Own only' } },
  { key: 'services.manage', label: 'Services and prices', hint: 'Edit the shop menu', fixed: { renter: 'Own menu' } },
  { key: 'staff.manage', label: 'Invite or remove staff', hint: 'Edit the team, chairs and licenses', fixed: { barber: 'Hidden', renter: 'Hidden' } },
  { key: 'payouts.run', label: 'Run payouts', hint: 'Approve commission each period', fixed: { barber: 'Hidden', renter: 'Hidden' } },
  { key: 'messages.send', label: 'Announcements and promos', hint: 'Message staff or clients', fixed: { barber: 'Hidden', renter: 'Own clients' } },
];

const ROLES = [['partner', 'Partner'], ['manager', 'Manager'], ['barber', 'Barber'], ['renter', 'Renter']];

export default function Access() {
  const { sb, current } = useShop();
  const [role, setRole] = useState('partner');
  const [rows, setRows] = useState({});
  const [error, setError] = useState('');
  const loc = current ? current.location_id : null;
  const isOwner = current && current.role === 'owner';

  const load = useCallback(async () => {
    if (!loc || !isOwner) return;
    const { data, error: err } = await sb.from('role_permissions').select('role, permission, allowed').eq('location_id', loc);
    if (err) { setError(err.message); return; }
    const map = {};
    (data || []).forEach((r) => { map[`${r.role}:${r.permission}`] = r.allowed; });
    setRows(map);
  }, [sb, loc, isOwner]);

  useEffect(() => { load(); }, [load]);

  if (!isOwner) {
    return <Screen><Title>Who sees what</Title><T muted>Only the owner can change these settings.</T></Screen>;
  }

  async function flip(key, next) {
    const id = `${role}:${key}`;
    setRows((r) => ({ ...r, [id]: next }));
    const { error: err } = await sb.from('role_permissions')
      .upsert({ location_id: loc, role, permission: key, allowed: next, updated_at: new Date().toISOString() });
    if (err) {
      setError(err.message);
      setRows((r) => ({ ...r, [id]: !next }));
    }
  }

  return (
    <Screen onRefresh={load}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: C.brassInk, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Title sub={`${current.locations ? current.locations.name : ''} · changes apply instantly and are logged`}>Who sees what</Title>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: '#E9E5DB', padding: 4, borderRadius: 12, gap: 4 }}>
        {ROLES.map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: role === id }}
            onPress={() => setRole(id)}
            style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: role === id ? C.card : 'transparent' }}
          >
            <Text style={{ fontWeight: '600', color: C.ink }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
      <List>
        {DEFS.map((d, i) => {
          const fixed = d.fixed && d.fixed[role];
          const on = !!rows[`${role}:${d.key}`];
          return (
            <Item key={d.key} last={i === DEFS.length - 1}>
              <View style={{ flex: 1 }}>
                <T strong>{d.label}</T>
                <T tiny muted>{d.hint}</T>
              </View>
              {fixed ? (
                <Badge>{fixed}</Badge>
              ) : (
                <Switch
                  accessibilityLabel={d.label}
                  value={on}
                  onValueChange={(v) => flip(d.key, v)}
                  trackColor={{ false: '#C9C4B8', true: C.ink }}
                  thumbColor={on ? C.brass : '#FFFFFF'}
                  ios_backgroundColor="#C9C4B8"
                />
              )}
            </Item>
          );
        })}
      </List>
      <T tiny muted>Managing partners start with everything on; managers start without analytics, booth rent and revenue. Booth renters&apos; own sales and clients stay private from the shop. The database enforces these settings, not just the app.</T>
    </Screen>
  );
}
