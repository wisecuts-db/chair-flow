'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useShop } from '@/components/AppShell';
import { dayBounds, money, ymd } from '@/lib/format';

export default function Home() {
  const shop = useShop();
  const router = useRouter();
  const cur = shop.current;
  const isStaffOnly = cur && (cur.role === 'barber' || cur.role === 'renter');

  useEffect(() => {
    if (isStaffOnly) router.replace('/app/day');
  }, [isStaffOnly, router]);

  if (!cur) return <Onboarding />;
  if (isStaffOnly) return null;
  return <Dashboard />;
}

function Onboarding() {
  const { sb, user, profile, reload } = useShop();
  const [name, setName] = useState(profile && profile.full_name ? profile.full_name : '');
  const [biz, setBiz] = useState('');
  const [loc, setLoc] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    if (name.trim()) await sb.from('profiles').update({ full_name: name.trim() }).eq('id', user.id);
    const { error: err } = await sb.rpc('create_shop', { p_business: biz.trim(), p_location: loc.trim(), p_address: addr.trim() || null });
    setBusy(false);
    if (err) setError(err.message);
    else reload();
  }

  return (
    <main className="page">
      <h1>Set up your shop</h1>
      <p className="muted" style={{ margin: 0 }}>
        You&apos;ll be the owner. You can add more locations, invite staff and set who sees what next.
      </p>
      <form className="stack" onSubmit={submit}>
        <label className="field">Your name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Business name<input required value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="e.g. Fresh Fades" /></label>
        <label className="field">First location name<input required value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="e.g. Main St" /></label>
        <label className="field">Address (optional)<input value={addr} onChange={(e) => setAddr(e.target.value)} /></label>
        <button className="btn dark block" disabled={busy}>{busy ? 'Creating…' : 'Create my shop'}</button>
        {error && <div className="error">{error}</div>}
      </form>
      <div className="notice">
        Working at someone else&apos;s shop? Ask the owner to invite <strong>{user.email}</strong>, then sign in again.
      </div>
    </main>
  );
}

function Dashboard() {
  const { sb, current, can } = useShop();
  const loc = current.location_id;
  const [d, setD] = useState(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    let alive = true;
    (async () => {
      const [start, end] = dayBounds();
      const out = {};
      const appts = await sb.from('appointments').select('id', { count: 'exact', head: true })
        .eq('location_id', loc).gte('starts_at', start).lt('starts_at', end)
        .not('status', 'in', '(cancelled,no_show)');
      out.appts = appts.count || 0;

      if (can('walkins.manage')) {
        const w = await sb.from('walkins').select('id', { count: 'exact', head: true }).eq('location_id', loc).eq('status', 'waiting');
        out.waiting = w.count || 0;
      }
      if (can('revenue.view')) {
        const s = await sb.from('sales_daily').select('net_cents').eq('location_id', loc).eq('day', ymd(new Date()));
        out.sales = (s.data || []).reduce((a, r) => a + (r.net_cents || 0), 0);
      }
      const staff = await sb.rpc('location_staff', { loc });
      const chairs = await sb.from('chairs').select('id', { count: 'exact', head: true }).eq('location_id', loc);
      out.staff = (staff.data || []).filter((m) => m.role !== 'owner' && m.status === 'active').length;
      out.chairsUsed = (staff.data || []).filter((m) => m.chair).length;
      out.chairs = chairs.count || 0;

      if (current.role === 'owner' || can('rent.view')) {
        const r = await sb.from('rent_status_view').select('display_status, balance_cents').eq('location_id', loc);
        const rows = r.data || [];
        out.rent = {
          overdue: rows.filter((x) => x.display_status === 'overdue').length,
          dueSoon: rows.filter((x) => x.display_status === 'due_soon').length,
          owed: rows.filter((x) => x.display_status !== 'paid').reduce((a, x) => a + x.balance_cents, 0),
        };
      }

      const alerts = [];
      if (current.role === 'owner') {
        const c = await sb.from('contracts').select('id, renter_id').eq('location_id', loc).eq('status', 'sent');
        (c.data || []).forEach(() => alerts.push({ kind: 'warn', text: 'Contract waiting for the renter to sign', href: '/app/rent' }));
        const s = await sb.from('contracts').select('id').eq('location_id', loc).eq('status', 'signed');
        (s.data || []).forEach(() => alerts.push({ kind: 'warn', text: 'Signed contract ready for your countersignature', href: '/app/rent' }));
      }
      if (can('roster.view')) {
        const soon = new Date();
        soon.setDate(soon.getDate() + 30);
        const ids = (staff.data || []).map((m) => m.membership_id);
        if (ids.length) {
          const recs = await sb.from('staff_records').select('membership_id, license_expires')
            .in('membership_id', ids).lte('license_expires', ymd(soon));
          (recs.data || []).forEach((r) => {
            const who = (staff.data || []).find((m) => m.membership_id === r.membership_id);
            alerts.push({ kind: 'bad', text: `License expires ${r.license_expires}: ${who ? who.name : 'staff member'}`, href: '/app/staff' });
          });
        }
      }
      out.alerts = alerts;
      if (alive) setD(out);
    })();
    return () => { alive = false; };
  }, [sb, loc, current.role, can]);

  return (
    <main className="page">
      <div>
        <div className="small muted">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>{current.locations ? current.locations.name : 'Today'}</h1>
      </div>

      <section>
        <h2>Today</h2>
        <div className="grid2">
          <Stat label="Appointments" value={d ? d.appts : '…'} />
          {d && d.waiting !== undefined && <Stat label="Walk-ins waiting" value={d.waiting} />}
          {d && d.sales !== undefined && <Stat label="Shop sales (net)" value={money(d.sales)} />}
          <Stat label="Chairs assigned" value={d ? `${d.chairsUsed} / ${d.chairs}` : '…'} />
        </div>
      </section>

      {d && d.rent && (
        <section className="card dark stack">
          <div className="row between">
            <div className="display strong" style={{ fontSize: 16 }}>Booth rent</div>
            <Link href="/app/rent" style={{ color: 'var(--brass)', fontWeight: 600, fontSize: 13 }}>View all</Link>
          </div>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <div><div className="stat-num" style={{ fontSize: 22 }}>{money(d.rent.owed)}</div><div className="tiny muted">Outstanding</div></div>
            <div><div className="stat-num" style={{ fontSize: 22 }}>{d.rent.dueSoon}</div><div className="tiny muted">Due soon</div></div>
            <div><div className="stat-num" style={{ fontSize: 22, color: '#F2A07B' }}>{d.rent.overdue}</div><div className="tiny muted">Overdue</div></div>
          </div>
        </section>
      )}

      {d && d.alerts.length > 0 && (
        <section>
          <h2>Needs attention</h2>
          <div className="list">
            {d.alerts.map((a, i) => (
              <Link key={i} href={a.href} className="item" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className={`badge ${a.kind}`}>{a.kind === 'bad' ? 'Urgent' : 'To do'}</span>
                <span>{a.text}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {d && d.staff === 0 && (
        <div className="notice">Next step: add your services and invite your barbers and booth renters on the Staff tab.</div>
      )}

      <section>
        <h2>Share with clients</h2>
        <div className="list">
          <div className="item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="strong">Online booking link</div>
              <div className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{origin}/book/{loc}</div>
            </div>
            <CopyButton text={`${origin}/book/${loc}`} />
          </div>
          <div className="item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="strong">Walk-in kiosk (open on the shop tablet)</div>
              <div className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{origin}/kiosk/{loc}</div>
            </div>
            <a className="btn sm" href={`/kiosk/${loc}`} target="_blank" rel="noreferrer">Open</a>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card">
      <div className="tiny muted">{label}</div>
      <div className="stat-num">{value}</div>
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch (e) { /* ignore */ }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}
