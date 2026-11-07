'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { money, shortDate, time, ymd } from '@/lib/format';

const STEP_MIN = 15;

export default function Book() {
  const { loc } = useParams();
  const [shop, setShop] = useState(null);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [avail, setAvail] = useState([]);
  const [busy, setBusy] = useState([]);
  const [barber, setBarber] = useState('any');
  const [serviceId, setServiceId] = useState(null);
  const [day, setDay] = useState(() => ymd(new Date()));
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const sb = getSupabase();
    (async () => {
      const l = await sb.from('locations').select('id, name, address, policies_text, allow_guest_booking').eq('id', loc).maybeSingle();
      if (!l.data) { setError('This booking page isn’t available.'); return; }
      setShop(l.data);
      const b = await sb.rpc('public_barbers', { loc });
      setBarbers(b.data || []);
      const s = await sb.from('services').select('id, name, price_cents, duration_min, deposit_cents, renter_id').eq('location_id', loc).eq('active', true).order('name');
      setServices(s.data || []);
      const ids = (b.data || []).map((x) => x.id);
      if (ids.length) {
        const a = await sb.from('availability').select('membership_id, weekday, starts, ends').in('membership_id', ids);
        setAvail(a.data || []);
      }
    })();
  }, [loc]);

  useEffect(() => {
    setSlot(null);
    getSupabase().rpc('busy_times', { loc, day }).then(({ data }) => setBusy(data || []));
  }, [loc, day]);

  const service = services.find((s) => s.id === serviceId) || null;

  // Who can do this service: a renter's own service -> that renter; a shop service -> employees.
  const eligible = useMemo(() => {
    const ok = (b, s) => (s.renter_id ? s.renter_id === b.id : b.role !== 'renter');
    return barbers.filter((b) => (barber === 'any' || b.id === barber) && (!service || ok(b, service)));
  }, [barbers, barber, service]);

  const visibleServices = services.filter((s) => {
    if (barber === 'any') return !s.renter_id || barbers.some((b) => b.id === s.renter_id);
    const b = barbers.find((x) => x.id === barber);
    return b && (s.renter_id ? s.renter_id === b.id : b.role !== 'renter');
  });

  const slots = useMemo(() => {
    if (!service) return [];
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const minStart = Date.now() + 15 * 60000;
    const found = new Map();
    eligible.forEach((b) => {
      avail.filter((a) => a.membership_id === b.id && a.weekday === date.getDay()).forEach((a) => {
        const [sh, sm] = a.starts.split(':').map(Number);
        const [eh, em] = a.ends.split(':').map(Number);
        const winEnd = new Date(y, m - 1, d, eh, em).getTime();
        for (let t = new Date(y, m - 1, d, sh, sm).getTime(); t + service.duration_min * 60000 <= winEnd; t += STEP_MIN * 60000) {
          if (t < minStart) continue;
          const end = t + service.duration_min * 60000;
          const clash = busy.some((x) => x.barber_id === b.id && new Date(x.starts_at).getTime() < end && new Date(x.ends_at).getTime() > t);
          if (!clash && !found.has(t)) found.set(t, b.id);
        }
      });
    });
    return [...found.entries()].sort((p, q) => p[0] - q[0]).map(([t, bid]) => ({ t, bid }));
  }, [service, eligible, avail, busy, day]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const x = new Date();
    x.setDate(x.getDate() + i);
    return ymd(x);
  }), []);

  async function submit(e) {
    e.preventDefault();
    if (!slot || !service) return;
    setSending(true);
    setError('');
    const { error: err } = await getSupabase().rpc('book_appointment', {
      p_location: loc, p_barber: slot.bid, p_service: service.id, p_starts: new Date(slot.t).toISOString(),
      p_name: form.name.trim(), p_phone: form.phone.trim(), p_email: form.email.trim() || null, p_notes: form.notes.trim() || null,
    });
    setSending(false);
    if (err) {
      setError(err.message);
      getSupabase().rpc('busy_times', { loc, day }).then(({ data }) => setBusy(data || []));
    } else {
      setDone({ when: slot.t, with: (barbers.find((b) => b.id === slot.bid) || {}).name, service: service.name });
    }
  }

  if (error && !shop) return <main className="page"><div className="error">{error}</div></main>;
  if (!shop) return <main className="page"><div className="muted">Loading…</div></main>;

  if (done) {
    return (
      <main className="page" style={{ maxWidth: 480 }}>
        <div className="small muted">{shop.name}</div>
        <h1>You&apos;re booked</h1>
        <div className="card stack">
          <div className="display strong" style={{ fontSize: 20 }}>{shortDate(done.when)} at {time(done.when)}</div>
          <div className="muted">{done.service} with {done.with}</div>
          {shop.address && <div className="small muted">{shop.address}</div>}
        </div>
        <button className="btn" onClick={() => { setDone(null); setSlot(null); }}>Book another</button>
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 520 }}>
      <div>
        <div className="small muted">{shop.name}{shop.address ? ` · ${shop.address}` : ''}</div>
        <h1>Book a cut</h1>
      </div>

      <section>
        <h2>Barber</h2>
        <div className="row wrap">
          <button className="chip" aria-pressed={barber === 'any'} onClick={() => { setBarber('any'); setSlot(null); }}>Any available</button>
          {barbers.map((b) => (
            <button key={b.id} className="chip" aria-pressed={barber === b.id} onClick={() => { setBarber(b.id); setServiceId(null); setSlot(null); }}>{b.name}</button>
          ))}
        </div>
      </section>

      <section>
        <h2>Service</h2>
        <div className="stack">
          {visibleServices.map((s) => (
            <button
              key={s.id}
              className="card row between"
              aria-pressed={serviceId === s.id}
              onClick={() => { setServiceId(s.id); setSlot(null); }}
              style={{ border: serviceId === s.id ? '2px solid var(--ink)' : '1px solid var(--line)', cursor: 'pointer', textAlign: 'left' }}
            >
              <span><span className="strong">{s.name}</span><br /><span className="tiny muted">{s.duration_min} min{s.renter_id ? ` · with ${(barbers.find((b) => b.id === s.renter_id) || {}).name || ''}` : ''}</span></span>
              <span className="strong">{money(s.price_cents)}</span>
            </button>
          ))}
          {visibleServices.length === 0 && <div className="small muted">No services to book yet.</div>}
        </div>
      </section>

      {service && (
        <section className="stack">
          <h2>Day</h2>
          <div className="row" style={{ overflowX: 'auto', paddingBottom: 4 }}>
            {days.map((dd) => (
              <button key={dd} className="chip" aria-pressed={day === dd} onClick={() => setDay(dd)} style={{ flex: 'none' }}>
                {shortDate(new Date(`${dd}T12:00:00`))}
              </button>
            ))}
          </div>
          <h2 style={{ marginTop: 8 }}>Time</h2>
          <div className="grid4">
            {slots.map((s) => (
              <button key={s.t} className="chip" aria-pressed={slot && slot.t === s.t} onClick={() => setSlot(s)} style={{ padding: 0 }}>{time(s.t)}</button>
            ))}
          </div>
          {slots.length === 0 && <div className="small muted">No open times this day. Try another day or barber.</div>}
        </section>
      )}

      {slot && (
        <form className="stack" onSubmit={submit}>
          <h2>Your details</h2>
          <label className="field">Name<input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">Mobile number<input required type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field">Email (optional)<input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field">Notes for your barber<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. keep length on top" /></label>
          {shop.policies_text && <p className="tiny muted" style={{ margin: 0 }}>{shop.policies_text}</p>}
          <div className="small muted">{service.name} · {shortDate(slot.t)} {time(slot.t)} · {(barbers.find((b) => b.id === slot.bid) || {}).name} · pay at the shop</div>
          <button className="btn dark block" disabled={sending}>{sending ? 'Booking…' : 'Confirm booking'}</button>
          {error && <div className="error">{error}</div>}
        </form>
      )}
    </main>
  );
}
