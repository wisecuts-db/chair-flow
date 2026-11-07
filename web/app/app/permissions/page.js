'use client';

import { useEffect, useState } from 'react';
import { useShop } from '@/components/AppShell';

// Mirrors the permission_key enum. `fixed` = what that role gets no matter the toggle.
const DEFS = [
  { key: 'schedule.view_all', label: 'Full shop schedule', hint: "See every barber's bookings" },
  { key: 'schedule.manage_others', label: 'Book for other barbers', hint: "Move or add others' appointments (never renters')", fixed: { renter: 'Never' } },
  { key: 'clients.view_all', label: 'Shop client contact info', hint: 'Phone and email of all shop clients', fixed: { renter: 'Own clients only' } },
  { key: 'revenue.view', label: 'Shop revenue', hint: 'Sales reports for this location', fixed: { barber: 'Hidden', renter: 'Hidden' } },
  { key: 'earnings.view_others', label: "Other barbers' earnings", hint: 'Sales by barber', fixed: { barber: 'Own only', renter: 'Own only' } },
  { key: 'services.manage', label: 'Services and prices', hint: 'Edit the shop menu', fixed: { renter: 'Own menu' } },
  { key: 'payouts.run', label: 'Run payouts', hint: 'Approve commission each period', fixed: { barber: 'Hidden', renter: 'Hidden' } },
  { key: 'staff.manage', label: 'Invite or remove staff', hint: 'Edit the roster', fixed: { barber: 'Hidden', renter: 'Hidden' } },
  { key: 'roster.view', label: 'Licenses and documents', hint: 'Roster records; every view is logged', fixed: { barber: 'Own only', renter: 'Own only' } },
  { key: 'rent.view', label: 'Booth rent ledger', hint: 'Balances for every renter', fixed: { barber: 'Hidden', renter: 'Own only' } },
  { key: 'walkins.manage', label: 'Run walk-in queue', hint: 'Assign or remove walk-ins' },
  { key: 'messages.send', label: 'Announcements and promos', hint: 'Message staff or clients', fixed: { barber: 'Hidden', renter: 'Own clients' } },
];

const ROLES = [['manager', 'Manager'], ['barber', 'Barber'], ['renter', 'Booth renter']];

export default function Permissions() {
  const { sb, current } = useShop();
  const [role, setRole] = useState('manager');
  const [rows, setRows] = useState({});
  const [error, setError] = useState('');

  const loc = current ? current.location_id : null;
  const isOwner = current && current.role === 'owner';

  useEffect(() => {
    if (!loc || !isOwner) return;
    sb.from('role_permissions').select('role, permission, allowed').eq('location_id', loc).then(({ data, error: err }) => {
      if (err) { setError(err.message); return; }
      const map = {};
      (data || []).forEach((r) => { map[`${r.role}:${r.permission}`] = r.allowed; });
      setRows(map);
    });
  }, [sb, loc, isOwner]);

  if (!isOwner) {
    return <main className="page"><h1>Who sees what</h1><p className="muted">Only the owner can change these settings.</p></main>;
  }

  async function flip(key) {
    const id = `${role}:${key}`;
    const next = !rows[id];
    setRows((r) => ({ ...r, [id]: next }));
    const { error: err } = await sb.from('role_permissions')
      .upsert({ location_id: loc, role, permission: key, allowed: next, updated_at: new Date().toISOString() });
    if (err) {
      setError(err.message);
      setRows((r) => ({ ...r, [id]: !next }));
    }
  }

  return (
    <main className="page">
      <div>
        <h1>Who sees what</h1>
        <div className="small muted">{current.locations ? current.locations.name : ''} · changes apply instantly and are logged</div>
      </div>
      <div className="tabs" role="tablist" aria-label="Role">
        {ROLES.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={role === id} onClick={() => setRole(id)}>{label}</button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="list">
        {DEFS.map((d) => {
          const fixed = d.fixed && d.fixed[role];
          const on = !!rows[`${role}:${d.key}`];
          return (
            <div key={d.key} className="item">
              <div style={{ flex: 1 }}>
                <div className="strong">{d.label}</div>
                <div className="tiny muted">{d.hint}</div>
              </div>
              {fixed ? (
                <span className="badge plain">{fixed}</span>
              ) : (
                <button className="switch" role="switch" aria-checked={on} aria-label={d.label} onClick={() => flip(d.key)}><span /></button>
              )}
            </div>
          );
        })}
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Booth renters&apos; own sales and clients are never visible to the shop. The database enforces these settings, not just the app.
      </p>
    </main>
  );
}
