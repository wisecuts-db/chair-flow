'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function Kiosk() {
  const { loc } = useParams();
  const [shop, setShop] = useState(null);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', service: '', barber: '' });
  const [position, setPosition] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const sb = getSupabase();
    (async () => {
      const l = await sb.from('locations').select('id, name').eq('id', loc).maybeSingle();
      if (!l.data) { setError('This kiosk link isn’t active.'); return; }
      setShop(l.data);
      const b = await sb.rpc('public_barbers', { loc });
      setBarbers(b.data || []);
      const s = await sb.from('services').select('id, name').eq('location_id', loc).eq('active', true).is('renter_id', null).order('name');
      setServices(s.data || []);
    })();
  }, [loc]);

  // Return to a blank form after showing the confirmation.
  useEffect(() => {
    if (position === null) return undefined;
    const t = setTimeout(() => setPosition(null), 10000);
    return () => clearTimeout(t);
  }, [position]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const sb = getSupabase();
    const { data: id, error: err } = await sb.rpc('join_walkin', {
      loc, p_name: form.name.trim(), p_phone: form.phone.trim(),
      p_service: form.service || null, p_barber: form.barber || null,
    });
    if (err) { setBusy(false); setError(err.message); return; }
    const pos = await sb.rpc('walkin_position', { w: id });
    setBusy(false);
    setPosition(pos.data || 1);
    setForm({ name: '', phone: '', service: '', barber: '' });
  }

  if (error && !shop) return <main className="page"><div className="error">{error}</div></main>;
  if (!shop) return <main className="page"><div className="muted">Loading…</div></main>;

  if (position !== null) {
    return (
      <main className="page" style={{ maxWidth: 640, paddingTop: 80, textAlign: 'center' }}>
        <div className="muted">{shop.name}</div>
        <h1 style={{ fontSize: 48 }}>You&apos;re #{position} in line</h1>
        <p className="muted" style={{ fontSize: 18 }}>Have a seat. Your barber will call your name.</p>
        <button className="btn" onClick={() => setPosition(null)} style={{ alignSelf: 'center' }}>Done</button>
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 640, paddingTop: 40 }}>
      <div className="muted">{shop.name}</div>
      <h1 style={{ fontSize: 40, lineHeight: 1.05 }}>Walk in? Add yourself to the line.</h1>
      <form className="stack" onSubmit={submit} style={{ gap: 16 }}>
        <label className="field" style={{ fontSize: 15 }}>First name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ minHeight: 60, fontSize: 20 }} />
        </label>
        <label className="field" style={{ fontSize: 15 }}>Mobile number
          <input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ minHeight: 60, fontSize: 20 }} />
        </label>
        {services.length > 0 && (
          <div className="stack">
            <div className="small muted">Service</div>
            <div className="row wrap">
              {services.map((s) => (
                <button type="button" key={s.id} className="chip" aria-pressed={form.service === s.id} onClick={() => setForm({ ...form, service: s.id })} style={{ minHeight: 60, fontSize: 17 }}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
        <label className="field" style={{ fontSize: 15 }}>Barber
          <select value={form.barber} onChange={(e) => setForm({ ...form, barber: e.target.value })} style={{ minHeight: 60, fontSize: 18 }}>
            <option value="">First available</option>
            {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <button className="btn brass block" disabled={busy} style={{ minHeight: 68, fontSize: 20 }}>{busy ? 'Adding…' : 'Join the line'}</button>
        {error && <div className="error">{error}</div>}
      </form>
    </main>
  );
}
