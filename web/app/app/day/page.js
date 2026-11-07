'use client';

import { useCallback, useEffect, useState } from 'react';
import { useShop } from '@/components/AppShell';
import { dayBounds, minutesAgo, money, time } from '@/lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Day() {
  const { sb, current, can } = useShop();
  const loc = current ? current.location_id : null;
  const me = current ? current.id : null;
  const [mine, setMine] = useState([]);
  const [all, setAll] = useState([]);
  const [staff, setStaff] = useState([]);
  const [queue, setQueue] = useState([]);
  const [hours, setHours] = useState([]);
  const [earned, setEarned] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!loc) return;
    const [start, end] = dayBounds();
    const sel = 'id, starts_at, ends_at, status, client_notes, barber_id, client_id, clients(full_name, phone), services(name, price_cents, duration_min)';
    const a = await sb.from('appointments').select(sel).eq('barber_id', me).gte('starts_at', start).lt('starts_at', end).order('starts_at');
    setMine(a.data || []);
    const s = await sb.rpc('location_staff', { loc });
    setStaff(s.data || []);
    if (can('schedule.view_all')) {
      const b = await sb.from('appointments').select('id, starts_at, ends_at, status, barber_id, services(name)')
        .eq('location_id', loc).neq('barber_id', me).gte('starts_at', start).lt('starts_at', end).order('starts_at');
      setAll(b.data || []);
    }
    if (can('walkins.manage')) {
      const w = await sb.from('walkins').select('id, name, phone, status, joined_at, assigned_to, preferred_barber, services(name)')
        .eq('location_id', loc).in('status', ['waiting', 'assigned']).order('joined_at');
      setQueue(w.data || []);
    }
    const h = await sb.from('availability').select('id, weekday, starts, ends').eq('membership_id', me).order('weekday');
    setHours(h.data || []);
    if (current.role !== 'owner') {
      const since = new Date();
      since.setDate(since.getDate() - 14);
      const e = await sb.from('sales').select('gross_cents, discount_cents, refund_cents, tip_cents').eq('barber_id', me).gte('sold_at', since.toISOString());
      setEarned((e.data || []).reduce((t, r) => t + r.gross_cents - r.discount_cents - r.refund_cents + r.tip_cents, 0));
    }
  }, [sb, loc, me, can, current]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  async function run(promise) {
    setError('');
    const { error: err } = await promise;
    if (err) setError(err.message);
    await load();
  }

  async function complete(a) {
    setError('');
    const upd = await sb.from('appointments').update({ status: 'completed' }).eq('id', a.id);
    if (upd.error) { setError(upd.error.message); return; }
    if (a.services) {
      await sb.from('sales').insert({
        location_id: loc, barber_id: me, appointment_id: a.id, client_id: a.client_id,
        kind: 'service', description: a.services.name, gross_cents: a.services.price_cents,
        renter_owned: current.role === 'renter',
      });
    }
    await load();
  }

  if (!current) return null;
  const nameOf = (mid) => (staff.find((m) => m.membership_id === mid) || {}).name || '—';
  const next = mine.find((a) => ['booked', 'confirmed', 'checked_in'].includes(a.status));
  const isBarber = current.role !== 'owner' || hours.length > 0;

  return (
    <main className="page">
      <div>
        <div className="small muted">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        <h1>My day</h1>
      </div>
      {error && <div className="error">{error}</div>}

      {next && (
        <section className="card dark stack">
          <div className="row between">
            <span className="tiny strong" style={{ color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next · {time(next.starts_at)}</span>
            <span className="badge plain">{next.status.replace('_', ' ')}</span>
          </div>
          <div>
            <div className="display strong" style={{ fontSize: 22 }}>{next.clients ? next.clients.full_name : 'Client'}</div>
            <div className="small muted">{next.services ? `${next.services.name} · ${next.services.duration_min} min` : ''}{next.clients && next.clients.phone ? ` · ${next.clients.phone}` : ''}</div>
          </div>
          {next.client_notes && <div className="small" style={{ background: '#24262A', borderRadius: 10, padding: 10 }}>Client note: {next.client_notes}</div>}
          <div className="row">
            {next.status !== 'checked_in' && <button className="btn brass" style={{ flex: 1 }} onClick={() => run(sb.from('appointments').update({ status: 'checked_in' }).eq('id', next.id))}>Check in</button>}
            <button className="btn" style={{ flex: 1 }} onClick={() => complete(next)}>Complete</button>
          </div>
        </section>
      )}

      <section>
        <h2>My appointments today</h2>
        <div className="list">
          {mine.map((a) => (
            <div key={a.id} className="item">
              <div style={{ width: 70 }} className="small strong">{time(a.starts_at)}</div>
              <div style={{ flex: 1 }}>
                <div className="strong">{a.clients ? a.clients.full_name : 'Client'}</div>
                <div className="tiny muted">{a.services ? a.services.name : ''}</div>
              </div>
              {['booked', 'confirmed', 'checked_in'].includes(a.status) ? (
                <button className="btn sm" onClick={() => run(sb.from('appointments').update({ status: 'no_show' }).eq('id', a.id))}>No-show</button>
              ) : (
                <span className="badge plain">{a.status.replace('_', ' ')}</span>
              )}
            </div>
          ))}
          {mine.length === 0 && <div className="item small muted">No appointments today.</div>}
        </div>
      </section>

      {can('walkins.manage') && (
        <section>
          <h2>Walk-in line</h2>
          <div className="list">
            {queue.map((w, i) => (
              <div key={w.id} className="item" style={{ flexWrap: 'wrap' }}>
                <div className="display strong" style={{ width: 24, color: 'var(--brass-ink)' }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div className="strong">{w.name}</div>
                  <div className="tiny muted">
                    {w.services ? w.services.name : 'Any service'} · waiting {minutesAgo(w.joined_at)} min
                    {w.preferred_barber ? ` · wants ${nameOf(w.preferred_barber)}` : ''}
                    {w.assigned_to ? ` · with ${nameOf(w.assigned_to)}` : ''}
                  </div>
                </div>
                {w.status === 'waiting' && <button className="btn sm dark" onClick={() => run(sb.from('walkins').update({ status: 'assigned', assigned_to: me, notified_at: new Date().toISOString() }).eq('id', w.id))}>Take</button>}
                <button className="btn sm" onClick={() => run(sb.from('walkins').update({ status: 'served' }).eq('id', w.id))}>Served</button>
                <button className="btn sm" aria-label={`Remove ${w.name}`} onClick={() => run(sb.from('walkins').update({ status: 'removed' }).eq('id', w.id))}>Remove</button>
              </div>
            ))}
            {queue.length === 0 && <div className="item small muted">Nobody waiting.</div>}
          </div>
        </section>
      )}

      {can('schedule.view_all') && all.length > 0 && (
        <section>
          <h2>Rest of the shop</h2>
          <div className="list">
            {all.map((a) => (
              <div key={a.id} className="item">
                <div style={{ width: 70 }} className="small strong">{time(a.starts_at)}</div>
                <div style={{ flex: 1 }}><div className="strong">{nameOf(a.barber_id)}</div><div className="tiny muted">{a.services ? a.services.name : 'Busy'}</div></div>
                <span className="badge plain">{a.status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {earned !== null && (
        <section className="card row between">
          <div><div className="tiny muted">My sales + tips, last 14 days</div><div className="stat-num" style={{ fontSize: 22 }}>{money(earned)}</div></div>
        </section>
      )}

      {isBarber && (
        <section className="stack">
          <h2>My bookable hours</h2>
          <div className="list">
            {hours.map((h) => (
              <div key={h.id} className="item">
                <div style={{ flex: 1 }}>{DAYS[h.weekday]} · {h.starts.slice(0, 5)}–{h.ends.slice(0, 5)}</div>
                <button className="btn sm" onClick={() => run(sb.from('availability').delete().eq('id', h.id))}>Remove</button>
              </div>
            ))}
            {hours.length === 0 && <div className="item small muted">Clients can&apos;t book you until you add hours.</div>}
          </div>
          <HoursForm onAdd={(weekday, starts, ends) => run(sb.from('availability').insert({ membership_id: me, weekday, starts, ends }))} />
        </section>
      )}
    </main>
  );
}

function HoursForm({ onAdd }) {
  const [day, setDay] = useState('1');
  const [starts, setStarts] = useState('09:00');
  const [ends, setEnds] = useState('17:00');
  return (
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); onAdd(parseInt(day, 10), starts, ends); }}>
      <label className="field" style={{ flex: '1 1 90px' }}>Day
        <select value={day} onChange={(e) => setDay(e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
      </label>
      <label className="field" style={{ flex: '1 1 90px' }}>From<input type="time" value={starts} onChange={(e) => setStarts(e.target.value)} /></label>
      <label className="field" style={{ flex: '1 1 90px' }}>To<input type="time" value={ends} onChange={(e) => setEnds(e.target.value)} /></label>
      <button className="btn dark" style={{ alignSelf: 'flex-end' }}>Add hours</button>
    </form>
  );
}
