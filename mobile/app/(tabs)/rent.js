import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { useShop } from '../../lib/shop';
import { money, toCents, ymd } from '../../lib/format';
import { Badge, Button, C, Card, Chip, ErrorText, Field, H2, Item, List, Picker, Row, Screen, T, Title } from '../../components/ui';

const STATUS = {
  paid: ['good', 'Paid'],
  overdue: ['bad', 'Overdue'],
  due_soon: ['warn', 'Due soon'],
  upcoming: ['plain', 'Upcoming'],
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const [open, setOpen] = useState(null);
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
    setOpen(null);
    await load();
  }

  if (!current) return null;
  if (!isOwner && !isRenter && !can('rent.view')) {
    return <Screen><Title>Booth rent</Title><T muted>You don&apos;t have access to the rent ledger.</T></Screen>;
  }

  const nameOf = (mid) => (staff.find((x) => x.membership_id === mid) || {}).name || 'Renter';
  const chairOf = (id) => (chairs.find((x) => x.id === id) || {}).label;
  const renters = staff.filter((m) => m.role === 'renter' && m.status === 'active');
  const month = ymd(new Date()).slice(0, 7);
  const collected = ledger.filter((r) => r.due_on.slice(0, 7) === month).reduce((a, r) => a + r.paid_cents, 0);
  const outstanding = ledger.filter((r) => r.display_status !== 'paid').reduce((a, r) => a + r.balance_cents, 0);
  const shown = ledger.filter((r) => filter === 'all' || r.display_status === filter);

  function exportCsv() {
    const head = 'renter,due_on,amount,paid,balance,status';
    const lines = ledger.map((r) => [nameOf(r.renter_id), r.due_on, r.amount_cents / 100, r.paid_cents / 100, r.balance_cents / 100, r.display_status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    Share.share({ title: `Rent ledger ${ymd(new Date())}`, message: [head, ...lines].join('\n') });
  }

  return (
    <Screen onRefresh={load}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{isRenter ? 'My booth rent' : 'Booth rent'}</Title>
        {!isRenter ? <Button small title="Export" onPress={exportCsv} /> : null}
      </Row>
      <ErrorText>{error}</ErrorText>

      <Card dark>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: C.darkMuted, fontSize: 12 }}>{isRenter ? 'Paid this month' : 'Collected this month'}</Text>
            <Text style={{ color: C.bg, fontSize: 24, fontWeight: '600' }}>{money(collected)}</Text>
          </View>
          <View>
            <Text style={{ color: C.darkMuted, fontSize: 12 }}>{isRenter ? 'I owe' : 'Outstanding'}</Text>
            <Text style={{ color: '#F2A07B', fontSize: 24, fontWeight: '600' }}>{money(outstanding)}</Text>
          </View>
        </Row>
      </Card>

      {(isRenter || isOwner) && contracts.length > 0 ? (
        <View>
          <H2>Contracts</H2>
          <List>
            {contracts.map((c, i) => (
              <Item key={c.id} last={i === contracts.length - 1} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <T strong>{isRenter ? 'Booth rental agreement' : nameOf(c.renter_id)} · v{c.version}</T>
                    <T tiny muted>{money(c.rent_cents)} {c.cadence} · starts {c.start_date}{c.chair_id && chairOf(c.chair_id) ? ` · ${chairOf(c.chair_id)}` : ''}</T>
                  </View>
                  <Badge kind={c.status === 'countersigned' ? 'good' : c.status === 'void' ? 'plain' : 'warn'}>{c.status}</Badge>
                </Row>
                <Row wrap style={{ marginTop: 8 }}>
                  {isRenter && c.status === 'sent' ? (
                    <Button small kind="dark" title="Sign" onPress={() => Alert.alert('Sign this booth rental agreement?', `${money(c.rent_cents)} ${c.cadence}, starting ${c.start_date}`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign', onPress: () => run(sb.rpc('sign_contract', { c: c.id })) },
                    ])} />
                  ) : null}
                  {isOwner && c.status === 'signed' ? (
                    <Button small kind="dark" title="Countersign" onPress={() => run(sb.from('contracts').update({ status: 'countersigned', countersigned_at: new Date().toISOString() }).eq('id', c.id))} />
                  ) : null}
                  {isOwner && (c.status === 'signed' || c.status === 'countersigned') ? (
                    <Button small title={open === `charge:${c.id}` ? 'Close' : 'Add charge'} onPress={() => setOpen(open === `charge:${c.id}` ? null : `charge:${c.id}`)} />
                  ) : null}
                </Row>
                {open === `charge:${c.id}` ? (
                  <ChargeForm
                    defaultAmount={c.rent_cents}
                    onAdd={(due, amount) => run(sb.from('rent_charges').insert({
                      contract_id: c.id, location_id: loc, renter_id: c.renter_id, period_start: due, due_on: due, amount_cents: toCents(amount),
                    }))}
                  />
                ) : null}
              </Item>
            ))}
          </List>
        </View>
      ) : null}

      {isOwner ? (
        <View style={{ gap: 8 }}>
          <H2>New booth rental contract</H2>
          {renters.length === 0 ? (
            <T small muted>Invite a booth renter on the Staff tab first.</T>
          ) : (
            <ContractForm
              renters={renters}
              chairs={chairs}
              onCreate={(v) => run(sb.from('contracts').insert({
                location_id: loc, renter_id: v.renter, rent_cents: toCents(v.rent), cadence: v.cadence,
                start_date: v.start, chair_id: v.chair || null, status: 'sent', sent_at: new Date().toISOString(),
              }))}
            />
          )}
          <T tiny muted>The renter signs in ShopBoss and you countersign. Every change is kept in the audit history.</T>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <H2>Ledger</H2>
        <Row wrap>
          {[['all', 'All'], ['overdue', 'Overdue'], ['due_soon', 'Due soon'], ['paid', 'Paid']].map(([id, label]) => (
            <Chip key={id} title={label} selected={filter === id} onPress={() => setFilter(id)} style={{ minHeight: 36 }} />
          ))}
        </Row>
        {shown.map((r) => (
          <Card key={r.charge_id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T strong>{isRenter ? `Due ${r.due_on}` : nameOf(r.renter_id)}</T>
              <Badge kind={STATUS[r.display_status][0]}>{STATUS[r.display_status][1]}</Badge>
            </Row>
            <T small muted>{isRenter ? '' : `Due ${r.due_on} · `}{money(r.amount_cents)} · paid {money(r.paid_cents)} · balance {money(r.balance_cents)}</T>
            {isOwner && r.display_status !== 'paid' ? (
              open === `pay:${r.charge_id}` ? (
                <PaymentForm balance={r.balance_cents} onPay={(amount, method) => run(sb.from('rent_payments').insert({ charge_id: r.charge_id, amount_cents: toCents(amount), method }))} />
              ) : (
                <Button small title="Record payment" onPress={() => setOpen(`pay:${r.charge_id}`)} />
              )
            ) : null}
          </Card>
        ))}
        {shown.length === 0 ? <T small muted>Nothing here.</T> : null}
      </View>
    </Screen>
  );
}

function ContractForm({ renters, chairs, onCreate }) {
  const [v, setV] = useState({ renter: renters[0].membership_id, rent: '', cadence: 'weekly', start: ymd(new Date()), chair: null });
  const set = (k) => (val) => setV({ ...v, [k]: val });
  return (
    <Card>
      <Picker label="Renter" value={v.renter} onChange={set('renter')} options={renters.map((r) => ({ value: r.membership_id, label: r.name }))} />
      {chairs.length > 0 ? (
        <Picker label="Chair" value={v.chair} onChange={set('chair')} options={[{ value: null, label: 'None' }, ...chairs.map((c) => ({ value: c.id, label: c.label }))]} />
      ) : null}
      <Picker label="How often" value={v.cadence} onChange={set('cadence')} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' }]} />
      <Row>
        <Field label="Rent ($)" value={v.rent} onChangeText={set('rent')} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Start (YYYY-MM-DD)" value={v.start} onChangeText={set('start')} keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
      </Row>
      <Button kind="dark" title="Send for signature" disabled={!v.rent || !DATE_RE.test(v.start)} onPress={() => onCreate(v)} />
    </Card>
  );
}

function ChargeForm({ defaultAmount, onAdd }) {
  const [due, setDue] = useState(ymd(new Date()));
  const [amount, setAmount] = useState(String(defaultAmount / 100));
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Row>
        <Field label="Due (YYYY-MM-DD)" value={due} onChangeText={setDue} keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
        <Field label="Amount ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ flex: 1 }} />
      </Row>
      <Button small kind="dark" title="Add charge" disabled={!DATE_RE.test(due) || !amount} onPress={() => onAdd(due, amount)} />
    </View>
  );
}

function PaymentForm({ balance, onPay }) {
  const [amount, setAmount] = useState(String(balance / 100));
  const [method, setMethod] = useState('cash');
  return (
    <View style={{ gap: 8 }}>
      <Field label="Amount ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Picker
        label="Method"
        value={method}
        onChange={setMethod}
        options={[{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'ach', label: 'Bank' }, { value: 'app', label: 'Cash App / Zelle' }, { value: 'credit', label: 'Credit' }]}
      />
      <Button small kind="dark" title="Save payment" disabled={!amount} onPress={() => onPay(amount, method)} />
    </View>
  );
}
