'use client';

import { useCallback, useEffect, useState } from 'react';
import { useShop } from '@/components/AppShell';
import { money, toCents, ymd } from '@/lib/format';

const STATUS = {
  paid: ['good', 'Paid'],
  overdue: ['bad', 'Overdue'],
  due_soon: ['warn', 'Due soon'],
  upcoming: ['plain', 'Upcoming'],
};

export default function Rent() {
  const { sb, current, can } = useShop();
  const loc = current ? current.location_id : null;
  const isOwner = current && current.role === 'owner';
  const isRenter = current && current.role === 'renter';
  const [ledger, setLedger] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [chairs, setChairs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!loc) return;
    const s = await sb.rpc('location_staff', { loc });
    setStaff(s.data || []);
    const l = await sb.from('rent_status_view').select('*').eq('location_id', loc).order('due_on', { ascending: false });
    setLedger(l.data || []);
    const c = await sb.from('contracts').select('*').eq('location_id', loc).order('created_at', { ascending: false });
    setContracts(c.data || []);
    if (isOwner) {
      const ch = await sb.from('chairs').select('id, label').eq('location_id', loc).order('label');
      setChairs(ch.data || []);
    }
  }, [sb, loc, isOwner]);

  useEffect(() => { load(); }, [load]);

  async function run(promise) {
    setError('');
    const { error: err } = await promise;
    if (err) setError(err.message);
    await load();
  }

  if (!current) return null;
  if (!isOwner && !isRenter && !can('rent.view')) {
    return <main className="page"><h1>Booth rent</h1><p className="muted">You don&apos;t have access to the rent ledger.</p></main>;
  }

  const nameOf = (mid) => {
    const m = staff.find((x) => x.membership_id === mid);
    return m ? m.name : 'Renter';
  };
  const renters = staff.filter((m) => m.role === 'renter' && m.status === 'active');
  const collectedMonth = ledger.filter((r) => r.due_on.slice(0, 7) === ymd(new Date()).slice(0, 7)).reduce((a, r) => a + r.paid_cents, 0);
  const outstanding = ledger.filter((r) => r.display_status !== 'paid').reduce((a, r) => a + r.balance_cents, 0);
  const shown = ledger.filter((r) => filter === 'all' || r.display_status === filter);

  function exportCsv() {
    const head = ['renter', 'due_on', 'amount', 'paid', 'balance', 'status'];
    const lines = ledger.map((r) => [nameOf(r.renter_id), r.due_on, r.amount_cents / 100, r.paid_cents / 100, r.balance_cents / 100, r.display_status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rent-ledger-${ymd(new Date())}.csv`;
    a.click();
  }

  return (
    <main className="page">
      <div className="row between">
        <h1>{isRenter ? 'My booth rent' : 'Booth rent'}</h1>
        {!isRenter && <button className="btn sm" onClick={exportCsv}>Export ledger</button>}
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card dark grid2">
        <div><div className="tiny muted">{isRenter ? 'Paid this month' : 'Collected this month'}</div><div className="stat-num" style={{ fontSize: 24 }}>{money(collectedMonth)}</div></div>
        <div><div className="tiny muted">{isRenter ? 'I owe' : 'Outstanding'}</div><div className="stat-num" style={{ fontSize: 24, color: '#F2A07B' }}>{money(outstanding)}</div></div>
      </div>

      {(isRenter || isOwner) && contracts.length > 0 && (
        <section>
          <h2>Contracts</h2>
          <div className="list">
            {contracts.map((c) => (
              <div key={c.id} className="item" style={{ flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="strong">{isRenter ? 'Booth rental agreement' : nameOf(c.renter_id)} · v{c.version}</div>
                  <div className="tiny muted">{money(c.rent_cents)} {c.cadence} · starts {c.start_date}{c.chair_id && chairs.length ? ` · ${(chairs.find((x) => x.id === c.chair_id) || {}).label || ''}` : ''}</div>
                </div>
                <span className={`badge ${c.status === 'countersigned' ? 'good' : c.status === 'void' ? 'plain' : 'warn'}`}>{c.status}</span>
                {isRenter && c.status === 'sent' && (
                  <button className="btn sm dark" onClick={() => { if (window.confirm('Sign this booth rental agreement?')) run(sb.rpc('sign_contract', { c: c.id })); }}>Sign</button>
                )}
                {isOwner && c.status === 'signed' && (
                  <button className="btn sm dark" onClick={() => run(sb.from('contracts').update({ status: 'countersigned', countersigned_at: new Date().toISOString() }).eq('id', c.id))}>Countersign</button>
                )}
                {isOwner && (c.status === 'signed' || c.status === 'countersigned') && (
                  <ChargeForm contract={c} onAdd={(due, amount) => run(sb.from('rent_charges').insert({
                    contract_id: c.id, location_id: loc, renter_id: c.renter_id, period_start: due, due_on: due, amount_cents: toCents(amount),
                  }))} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {isOwner && (
        <section className="stack">
          <h2>New booth rental contract</h2>
          {renters.length === 0 ? (
            <div className="small muted">Invite a booth renter on the Staff tab first.</div>
          ) : (
            <ContractForm renters={renters} chairs={chairs} onCreate={(v) => run(sb.from('contracts').insert({
              location_id: loc, renter_id: v.renter, rent_cents: toCents(v.rent), cadence: v.cadence,
              start_date: v.start, chair_id: v.chair || null, status: 'sent', sent_at: new Date().toISOString(),
            }))} />
          )}
          <p className="tiny muted" style={{ margin: 0 }}>The renter signs in Chair Flow; you countersign. Every change is kept in the audit history.</p>
        </section>
      )}

      <section className="stack">
        <h2>Ledger</h2>
        <div className="row wrap">
          {[['all', 'All'], ['overdue', 'Overdue'], ['due_soon', 'Due soon'], ['paid', 'Paid']].map(([id, label]) => (
            <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)} style={{ minHeight: 36 }}>{label}</button>
          ))}
        </div>
        <div className="stack">
          {shown.map((r) => (
            <div key={r.charge_id} className="card stack">
              <div className="row between">
                <div className="strong">{isRenter ? `Due ${r.due_on}` : nameOf(r.renter_id)}</div>
                <span className={`badge ${STATUS[r.display_status][0]}`}>{STATUS[r.display_status][1]}</span>
              </div>
              <div className="row between small muted">
                <span>{isRenter ? '' : `Due ${r.due_on} · `}{money(r.amount_cents)}</span>
                <span>Paid {money(r.paid_cents)} · <strong style={{ color: 'var(--ink)' }}>Balance {money(r.balance_cents)}</strong></span>
              </div>
              {isOwner && r.display_status !== 'paid' && (
                <PaymentForm balance={r.balance_cents} onPay={(amount, method) => run(sb.from('rent_payments').insert({ charge_id: r.charge_id, amount_cents: toCents(amount), method }))} />
              )}
            </div>
          ))}
          {shown.length === 0 && <div className="small muted">Nothing here.</div>}
        </div>
      </section>
    </main>
  );
}

function ContractForm({ renters, chairs, onCreate }) {
  const [v, setV] = useState({ renter: renters[0].membership_id, rent: '', cadence: 'weekly', start: ymd(new Date()), chair: '' });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onCreate(v); }}>
      <div className="grid2">
        <label className="field">Renter<select value={v.renter} onChange={set('renter')}>{renters.map((r) => <option key={r.membership_id} value={r.membership_id}>{r.name}</option>)}</select></label>
        <label className="field">Chair<select value={v.chair} onChange={set('chair')}><option value="">None</option>{chairs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label className="field">Rent ($)<input required inputMode="decimal" value={v.rent} onChange={set('rent')} /></label>
        <label className="field">How often<select value={v.cadence} onChange={set('cadence')}><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></label>
        <label className="field">Start date<input type="date" required value={v.start} onChange={set('start')} /></label>
      </div>
      <button className="btn dark">Send for signature</button>
    </form>
  );
}

function ChargeForm({ contract, onAdd }) {
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(ymd(new Date()));
  const [amount, setAmount] = useState(String(contract.rent_cents / 100));
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Add charge</button>;
  return (
    <form className="row wrap" style={{ width: '100%' }} onSubmit={(e) => { e.preventDefault(); onAdd(due, amount); setOpen(false); }}>
      <label className="field" style={{ flex: 1 }}>Due<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label className="field" style={{ flex: 1 }}>Amount ($)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <button className="btn sm dark" style={{ alignSelf: 'flex-end' }}>Add</button>
    </form>
  );
}

function PaymentForm({ balance, onPay }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balance / 100));
  const [method, setMethod] = useState('cash');
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>Record payment</button>;
  return (
    <form className="row wrap" onSubmit={(e) => { e.preventDefault(); onPay(amount, method); setOpen(false); }}>
      <label className="field" style={{ flex: 1 }}>Amount ($)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field" style={{ flex: 1 }}>Method
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Cash</option><option value="card">Card</option><option value="ach">Bank transfer</option><option value="app">Cash app / Zelle</option><option value="credit">Credit / adjustment</option>
        </select>
      </label>
      <button className="btn sm dark" style={{ alignSelf: 'flex-end' }}>Save</button>
    </form>
  );
}
