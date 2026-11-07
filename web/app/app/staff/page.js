'use client';

import { useCallback, useEffect, useState } from 'react';
import { useShop } from '@/components/AppShell';
import { money, toCents, ROLE_LABEL } from '@/lib/format';

export default function Staff() {
  const { sb, current, can } = useShop();
  const loc = current ? current.location_id : null;
  const manage = can('staff.manage');
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [chairs, setChairs] = useState([]);
  const [services, setServices] = useState([]);
  const [records, setRecords] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!loc) return;
    const s = await sb.rpc('location_staff', { loc });
    setStaff(s.data || []);
    const c = await sb.from('chairs').select('id, label').eq('location_id', loc).order('label');
    setChairs(c.data || []);
    const sv = await sb.from('services').select('id, name, price_cents, duration_min, renter_id, active').eq('location_id', loc).order('name');
    setServices(sv.data || []);
    if (manage) {
      const i = await sb.from('invites').select('id, email, role, accepted_at').eq('location_id', loc).is('accepted_at', null);
      setInvites(i.data || []);
    }
    if (can('roster.view') && (s.data || []).length) {
      const r = await sb.from('staff_records').select('membership_id, license_number, license_expires')
        .in('membership_id', s.data.map((m) => m.membership_id));
      const map = {};
      (r.data || []).forEach((x) => { map[x.membership_id] = x; });
      setRecords(map);
    }
  }, [sb, loc, manage, can]);

  useEffect(() => { load(); }, [load]);

  async function run(promise) {
    setError('');
    const { error: err } = await promise;
    if (err) setError(err.message);
    await load();
  }

  if (!current) return null;

  return (
    <main className="page">
      <h1>Staff &amp; services</h1>
      {error && <div className="error">{error}</div>}

      <section>
        <h2>Team</h2>
        <div className="list">
          {staff.map((m) => (
            <div key={m.membership_id} className="item" style={{ flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div className="strong">{m.name}</div>
                <div className="tiny muted">
                  {ROLE_LABEL[m.role]}{m.email ? ` · ${m.email}` : ''}
                  {records[m.membership_id] && records[m.membership_id].license_expires ? ` · license exp. ${records[m.membership_id].license_expires}` : ''}
                </div>
              </div>
              {manage && m.role !== 'owner' ? (
                <>
                  <select
                    aria-label={`Chair for ${m.name}`}
                    value={chairs.find((c) => c.label === m.chair) ? chairs.find((c) => c.label === m.chair).id : ''}
                    onChange={(e) => run(sb.from('memberships').update({ chair_id: e.target.value || null }).eq('id', m.membership_id))}
                    style={{ minHeight: 36, borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}
                  >
                    <option value="">No chair</option>
                    {chairs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <LicenseEditor
                    record={records[m.membership_id]}
                    onSave={(num, exp) => run(sb.from('staff_records').upsert({ membership_id: m.membership_id, license_number: num || null, license_expires: exp || null, updated_at: new Date().toISOString() }))}
                  />
                  <button
                    className="btn sm"
                    onClick={() => { if (window.confirm(`Remove ${m.name} from this location?`)) run(sb.from('memberships').update({ status: 'inactive' }).eq('id', m.membership_id)); }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                m.chair && <span className="badge plain">{m.chair}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {manage && (
        <section className="stack">
          <h2>Invite someone</h2>
          <InviteForm
            canInviteManager={current.role === 'owner'}
            onInvite={(email, role) => run(sb.from('invites').upsert({ location_id: loc, email: email.toLowerCase(), role }, { onConflict: 'location_id,email' }))}
          />
          {invites.length > 0 && (
            <div className="list">
              {invites.map((i) => (
                <div key={i.id} className="item">
                  <div style={{ flex: 1 }}><div className="strong">{i.email}</div><div className="tiny muted">{ROLE_LABEL[i.role]} · waiting for them to sign in</div></div>
                  <button className="btn sm" onClick={() => run(sb.from('invites').delete().eq('id', i.id))}>Cancel</button>
                </div>
              ))}
            </div>
          )}
          <p className="tiny muted" style={{ margin: 0 }}>They sign in at this site with that email and join automatically.</p>
        </section>
      )}

      {manage && (
        <section className="stack">
          <h2>Chairs</h2>
          <div className="row wrap">
            {chairs.map((c) => <span key={c.id} className="badge plain">{c.label}</span>)}
            {chairs.length === 0 && <span className="small muted">No chairs yet.</span>}
          </div>
          <OneField label="New chair" placeholder="e.g. Chair 1" button="Add chair" onSubmit={(v) => run(sb.from('chairs').insert({ location_id: loc, label: v }))} />
        </section>
      )}

      <section className="stack">
        <h2>Services</h2>
        <div className="list">
          {services.map((s) => (
            <div key={s.id} className="item">
              <div style={{ flex: 1 }}>
                <div className="strong">{s.name}{!s.active ? ' (hidden)' : ''}</div>
                <div className="tiny muted">{s.duration_min} min{s.renter_id ? ' · renter service' : ''}</div>
              </div>
              <div className="strong">{money(s.price_cents)}</div>
              {(s.renter_id ? s.renter_id === current.id : can('services.manage')) && (
                <button className="btn sm" onClick={() => run(sb.from('services').update({ active: !s.active }).eq('id', s.id))}>{s.active ? 'Hide' : 'Show'}</button>
              )}
            </div>
          ))}
          {services.length === 0 && <div className="item muted small">No services yet.</div>}
        </div>
        {(can('services.manage') || current.role === 'renter') && (
          <ServiceForm
            renter={current.role === 'renter'}
            onAdd={(name, price, minutes) => run(sb.from('services').insert({
              location_id: loc, name, price_cents: toCents(price), duration_min: parseInt(minutes, 10) || 30,
              renter_id: current.role === 'renter' ? current.id : null,
            }))}
          />
        )}
      </section>
    </main>
  );
}

function InviteForm({ onInvite, canInviteManager }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('barber');
  return (
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); if (email) { onInvite(email.trim(), role); setEmail(''); } }}>
      <label className="field" style={{ flex: '2 1 200px' }}>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field" style={{ flex: '1 1 120px' }}>Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="barber">Barber (employee)</option>
          <option value="renter">Booth renter</option>
          {canInviteManager && <option value="manager">Manager</option>}
        </select>
      </label>
      <button className="btn dark" style={{ alignSelf: 'flex-end' }}>Invite</button>
    </form>
  );
}

function OneField({ label, placeholder, button, onSubmit }) {
  const [v, setV] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV(''); } }}>
      <label className="field" style={{ flex: 1 }}>{label}<input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} /></label>
      <button className="btn" style={{ alignSelf: 'flex-end' }}>{button}</button>
    </form>
  );
}

function ServiceForm({ onAdd, renter }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState('30');
  return (
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); if (name && price) { onAdd(name.trim(), price, minutes); setName(''); setPrice(''); } }}>
      <label className="field" style={{ flex: '2 1 160px' }}>{renter ? 'Your service' : 'Service'}<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Haircut" /></label>
      <label className="field" style={{ flex: '1 1 80px' }}>Price ($)<input required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="field" style={{ flex: '1 1 80px' }}>Minutes<input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      <button className="btn dark" style={{ alignSelf: 'flex-end' }}>Add</button>
    </form>
  );
}

function LicenseEditor({ record, onSave }) {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState(record ? record.license_number || '' : '');
  const [exp, setExp] = useState(record ? record.license_expires || '' : '');
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>License</button>;
  return (
    <form className="row wrap" style={{ width: '100%' }} onSubmit={(e) => { e.preventDefault(); onSave(num, exp); setOpen(false); }}>
      <label className="field" style={{ flex: 1 }}>License #<input value={num} onChange={(e) => setNum(e.target.value)} /></label>
      <label className="field" style={{ flex: 1 }}>Expires<input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
      <button className="btn sm dark" style={{ alignSelf: 'flex-end' }}>Save</button>
    </form>
  );
}
