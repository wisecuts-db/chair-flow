import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { useShop } from '../../lib/shop';
import { money, shortDate, time, toCents, ymd } from '../../lib/format';
import { Badge, Button, C, Card, Chip, ErrorText, Field, H2, Item, List, Picker, Row, Screen, T, Title } from '../../components/ui';

// Rent rule (set per shop in the database): due Saturday 5 PM, Sunday grace, late Monday.
const STATUS = {
  paid: ['good', 'Paid'],
  waived: ['plain', 'Waived'],
  due: ['plain', 'Due'],
  grace: ['warn', 'Grace period'],
  late: ['bad', 'Late'],
  none: ['plain', 'No rent set'],
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (d) => shortDate(`${d}T12:00:00`);

export default function Rent() {
  const { sb, current, can } = useShop();
  const loc = current ? current.location_id : null;
  const isOwner = current && current.role === 'owner';
  const isRenter = current && current.role === 'renter';
  const [board, setBoard] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [chairs, setChairs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!loc) return;
    const [s, b, l, c] = await Promise.all([
      sb.rpc('location_staff', { loc }),
      sb.rpc('rent_board', { loc }),
      sb.from('rent_status_view').select('*').eq('location_id', loc).order('due_on', { ascending: false }),
      sb.from('contracts').select('*').eq('location_id', loc).order('created_at', { ascending: false }),
    ]);
    setStaff(s.data || []);
    if (b.error) setError(b.error.message);
    setBoard(b.data || null);
    setLedger(l.data || []);
    setContracts(c.data || []);
    if (isOwner) {
      const ch = await sb.from('chairs').select('id, label').eq('location_id', loc).order('label');
      setChairs(ch.data || []);
    }
  }, [sb, loc, isOwner]);

  useEffect(() => { load(); }, [load]);

  async function run(promise, done) {
    setError(''); setNotice('');
    const { data, error: err } = await promise;
    if (err) setError(err.message);
    else { setOpen(null); if (done) setNotice(done(data)); }
    await load();
  }

  if (!current) return null;
  if (!isOwner && !isRenter && !can('rent.view')) {
    return <Screen><Title>Booth rent</Title><T muted>You don&apos;t have access to booth rent.</T></Screen>;
  }

  const nameOf = (mid) => (staff.find((x) => x.membership_id === mid) || {}).name || 'Renter';
  const chairOf = (id) => (chairs.find((x) => x.id === id) || {}).label;
  const rows = board ? board.renters : [];
  const withPlan = new Set(rows.filter((r) => r.weekly_cents).map((r) => r.renter_id));
  const renters = staff.filter((m) => m.role === 'renter' && m.status === 'active');
  const noPlan = renters.filter((m) => !withPlan.has(m.membership_id));
  const dueOn = board ? board.due_on : null;
  const count = (st) => rows.filter((r) => r.status === st).length;
  const behind = rows.reduce((a, r) => a + (r.late_cents || 0), 0);
  const thisWeekPaid = rows.reduce((a, r) => a + ((r.this_week && r.this_week.paid_cents) || 0), 0);
  const thisWeekTotal = rows.reduce((a, r) => a + ((r.this_week && r.this_week.amount_cents) || 0), 0);
  const shown = ledger.filter((r) => filter === 'all' || r.display_status === filter);
  const me = isRenter ? rows.find((r) => r.renter_id === current.id) || rows[0] : null;

  function exportCsv() {
    const head = 'renter,due_on,amount,paid,balance,status,paid_late';
    const lines = ledger.map((r) => [nameOf(r.renter_id), r.due_on, r.amount_cents / 100, r.paid_cents / 100, r.balance_cents / 100, r.display_status, r.paid_late ? 'yes' : '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    Share.share({ title: `Booth rent ${ymd(new Date())}`, message: [head, ...lines].join('\n') });
  }

  const deadline = board ? (
    <T small style={{ color: C.darkMuted }}>
      Due {day(dueOn)} by {time(board.due_at)} · grace until {shortDate(new Date(new Date(board.late_at).getTime() - 60000))} · late after that
    </T>
  ) : null;

  return (
    <Screen onRefresh={load}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{isRenter ? 'My booth rent' : 'Booth rent'}</Title>
        {!isRenter ? <Button small title="Export" onPress={exportCsv} /> : null}
      </Row>
      <ErrorText>{error}</ErrorText>
      {notice ? <T small style={{ color: C.good }}>{notice}</T> : null}

      {isRenter ? (
        <Card dark>
          {me && me.weekly_cents ? (
            <View style={{ gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: C.darkMuted, fontSize: 12 }}>This week · {money(me.weekly_cents)}</Text>
                <Badge kind={STATUS[me.this_week ? me.this_week.display_status : 'none'][0]}>
                  {me.this_week && me.this_week.paid_late ? 'Paid late' : STATUS[me.this_week ? me.this_week.display_status : 'none'][1]}
                </Badge>
              </Row>
              <Text style={{ color: C.bg, fontSize: 24, fontWeight: '600' }}>
                {me.this_week && me.this_week.balance_cents > 0 ? `${money(me.this_week.balance_cents)} to pay` : 'All set this week'}
              </Text>
              {deadline}
              {me.late_cents > 0 ? (
                <Text style={{ color: '#F2A07B', fontSize: 15, fontWeight: '600' }}>
                  Behind {money(me.late_cents)} · {me.weeks_late} {me.weeks_late === 1 ? 'week' : 'weeks'} late
                </Text>
              ) : null}
              <T tiny style={{ color: C.darkMuted }}>On time {me.on_time_12w} of the last 12 weeks · pay the shop owner, who records it here.</T>
            </View>
          ) : (
            <Text style={{ color: C.bg }}>Your weekly booth rent hasn&apos;t been set up yet.</Text>
          )}
        </Card>
      ) : (
        <Card dark>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: C.darkMuted, fontSize: 12 }}>Collected this week</Text>
              <Text style={{ color: C.bg, fontSize: 24, fontWeight: '600' }}>{money(thisWeekPaid)}<Text style={{ fontSize: 14, color: C.darkMuted }}> / {money(thisWeekTotal)}</Text></Text>
            </View>
            <View>
              <Text style={{ color: C.darkMuted, fontSize: 12 }}>Behind (late)</Text>
              <Text style={{ color: '#F2A07B', fontSize: 24, fontWeight: '600' }}>{money(behind)}</Text>
            </View>
          </Row>
          <View style={{ marginTop: 6 }}>{deadline}</View>
          <Text style={{ color: C.bg, fontSize: 13, marginTop: 6 }}>
            {count('paid')} paid · {count('due')} due · {count('grace')} in grace · {count('late')} late
          </Text>
        </Card>
      )}

      {!isRenter ? (
        <View style={{ gap: 8 }}>
          <H2>Renters</H2>
          {rows.filter((r) => r.weekly_cents || r.owed_cents > 0).map((r) => (
            <RenterCard
              key={r.renter_id}
              r={r}
              name={nameOf(r.renter_id)}
              isOwner={isOwner}
              open={open}
              setOpen={setOpen}
              dueOn={dueOn}
              onPay={(amount, method, paidAt) => run(sb.rpc('record_rent_payment', {
                p_renter: r.renter_id, p_amount_cents: toCents(amount), p_method: method, p_paid_at: paidAt,
              }), (d) => `Saved. ${d.still_owed_cents > 0 ? `${nameOf(r.renter_id)} still owes ${money(d.still_owed_cents)}.` : `${nameOf(r.renter_id)} is paid up.`}`)}
              onSetRent={(amount) => run(sb.rpc('set_weekly_rent', { p_renter: r.renter_id, p_weekly_cents: toCents(amount) }), () => 'Weekly rent updated.')}
              onStop={() => Alert.alert(`Stop weekly rent for ${nameOf(r.renter_id)}?`, 'No new weeks will be charged. What they already owe stays on the books.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Stop', style: 'destructive', onPress: () => run(sb.rpc('stop_weekly_rent', { p_renter: r.renter_id }), () => 'Weekly rent stopped.') },
              ])}
            />
          ))}
          {rows.length === 0 && noPlan.length === 0 ? <T small muted>No booth renters yet. Invite a barber on the Team tab and tick &quot;booth renter&quot;.</T> : null}

          {isOwner && noPlan.length > 0 ? (
            <View style={{ gap: 8 }}>
              <H2>Set up weekly rent</H2>
              <SetupForm
                renters={noPlan}
                onCreate={(mid, amount, start) => run(sb.rpc('set_weekly_rent', { p_renter: mid, p_weekly_cents: toCents(amount), p_start: start }),
                  () => `Weekly rent set for ${nameOf(mid)}.`)}
              />
              <T tiny muted>Each week is charged automatically. Due Saturday by 5 PM, Sunday is the grace period, Monday it&apos;s late. Renters get a reminder Saturday morning, and you&apos;re notified Monday if anyone is late.</T>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <H2>{isRenter ? 'My weeks' : 'All weeks'}</H2>
        <Row wrap>
          {[['all', 'All'], ['late', 'Late'], ['grace', 'Grace'], ['due', 'Due'], ['paid', 'Paid']].map(([id, label]) => (
            <Chip key={id} title={label} selected={filter === id} onPress={() => setFilter(id)} style={{ minHeight: 36 }} />
          ))}
        </Row>
        {shown.map((r) => (
          <Card key={r.charge_id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T strong>{isRenter ? `Week due ${day(r.due_on)}` : nameOf(r.renter_id)}</T>
              <Row>
                {r.is_partial ? <Badge kind="warn">Partial</Badge> : null}
                <Badge kind={r.paid_late ? 'warn' : STATUS[r.display_status][0]}>{r.paid_late ? 'Paid late' : STATUS[r.display_status][1]}</Badge>
              </Row>
            </Row>
            <T small muted>
              {isRenter ? '' : `${r.kind === 'extra' ? 'Extra charge' : 'Week'} due ${day(r.due_on)} · `}{money(r.amount_cents)} · paid {money(r.paid_cents)}
              {r.balance_cents > 0 ? ` · owes ${money(r.balance_cents)}` : ''}
            </T>
            {isOwner && (r.display_status === 'late' || r.display_status === 'grace' || r.display_status === 'due' || r.display_status === 'waived') && r.paid_cents === 0 ? (
              <Row style={{ marginTop: 6 }}>
                <Button
                  small
                  title={r.display_status === 'waived' ? 'Undo waive' : 'Waive this week'}
                  onPress={() => run(sb.rpc('waive_rent_charge', { p_charge: r.charge_id, p_waive: r.display_status !== 'waived' }))}
                />
              </Row>
            ) : null}
          </Card>
        ))}
        {shown.length === 0 ? <T small muted>Nothing here.</T> : null}
      </View>

      {(isRenter || isOwner) && contracts.length > 0 ? (
        <View>
          <H2>Contracts</H2>
          <List>
            {contracts.map((c, i) => (
              <Item key={c.id} last={i === contracts.length - 1} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <T strong>{isRenter ? 'Booth rental agreement' : nameOf(c.renter_id)} · v{c.version}</T>
                    <T tiny muted>{money(c.rent_cents)} a week · starts {c.start_date}{c.chair_id && chairOf(c.chair_id) ? ` · ${chairOf(c.chair_id)}` : ''}</T>
                  </View>
                  <Badge kind={c.status === 'countersigned' ? 'good' : c.status === 'void' ? 'plain' : 'warn'}>{c.status}</Badge>
                </Row>
                <Row wrap style={{ marginTop: 8 }}>
                  {isRenter && c.status === 'sent' ? (
                    <Button small kind="dark" title="Sign" onPress={() => Alert.alert('Sign this booth rental agreement?', `${money(c.rent_cents)} a week, starting ${c.start_date}`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign', onPress: () => run(sb.rpc('sign_contract', { c: c.id })) },
                    ])} />
                  ) : null}
                  {isOwner && c.status === 'signed' ? (
                    <Button small kind="dark" title="Countersign" onPress={() => run(sb.from('contracts').update({ status: 'countersigned', countersigned_at: new Date().toISOString() }).eq('id', c.id))} />
                  ) : null}
                </Row>
              </Item>
            ))}
          </List>
        </View>
      ) : null}

      {isOwner && renters.length > 0 ? (
        <View style={{ gap: 8 }}>
          <H2>New booth rental contract</H2>
          <ContractForm
            renters={renters}
            chairs={chairs}
            onCreate={(v) => run(sb.from('contracts').insert({
              location_id: loc, renter_id: v.renter, rent_cents: toCents(v.rent), cadence: 'weekly',
              start_date: v.start, chair_id: v.chair || null, status: 'sent', sent_at: new Date().toISOString(),
            }), () => 'Contract sent for signature.')}
          />
          <T tiny muted>The renter signs in ShopBoss and you countersign. Every change is kept in the audit history.</T>
        </View>
      ) : null}
    </Screen>
  );
}

function RenterCard({ r, name, isOwner, open, setOpen, dueOn, onPay, onSetRent, onStop }) {
  const w = r.this_week;
  const st = w ? w.display_status : 'none';
  const payKey = `pay:${r.renter_id}`;
  const rentKey = `rent:${r.renter_id}`;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T strong>{name}</T>
          <T tiny muted>{r.weekly_cents ? `${money(r.weekly_cents)} a week` : 'Weekly rent stopped'}</T>
        </View>
        <Row>
          {r.weeks_late > 0 ? <Badge kind="bad">Behind</Badge> : null}
          <Badge kind={w && w.paid_late ? 'warn' : STATUS[st][0]}>{w && w.paid_late ? 'Paid late' : `${STATUS[st][1]}${st === 'due' && dueOn ? ` ${day(dueOn).split(',')[0]}` : ''}`}</Badge>
        </Row>
      </Row>
      {w ? (
        <T small muted>This week: {money(w.amount_cents)} · paid {money(w.paid_cents)}{w.balance_cents > 0 ? ` · owes ${money(w.balance_cents)}` : ''}</T>
      ) : null}
      {r.weeks_late > 0 ? (
        <T small style={{ color: C.bad, fontWeight: '600' }}>Behind {money(r.late_cents)} · {r.weeks_late} {r.weeks_late === 1 ? 'week' : 'weeks'} late</T>
      ) : null}
      <T tiny muted>
        On time {r.on_time_12w} · late {r.late_12w} (last 12 weeks){r.last_paid_at ? ` · last paid ${shortDate(r.last_paid_at)}` : ''}
      </T>
      {isOwner ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Row wrap>
            {r.owed_cents > 0 ? (
              <Button small kind="dark" title={open === payKey ? 'Close' : 'Record payment'} onPress={() => setOpen(open === payKey ? null : payKey)} />
            ) : null}
            <Button small title={open === rentKey ? 'Close' : r.weekly_cents ? 'Change rent' : 'Restart rent'} onPress={() => setOpen(open === rentKey ? null : rentKey)} />
            {r.weekly_cents ? <Button small title="Stop rent" onPress={onStop} /> : null}
          </Row>
          {open === payKey ? <PaymentForm owed={r.owed_cents} lastDue={dueOn} onPay={onPay} /> : null}
          {open === rentKey ? <RentAmountForm current={r.weekly_cents} onSave={onSetRent} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

function SetupForm({ renters, onCreate }) {
  const [mid, setMid] = useState(renters[0].membership_id);
  const [amount, setAmount] = useState('');
  const [start, setStart] = useState(ymd(new Date()));
  return (
    <Card>
      <Picker label="Renter" value={mid} onChange={setMid} options={renters.map((r) => ({ value: r.membership_id, label: r.name }))} />
      <Row>
        <Field label="Weekly rent ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Starting (YYYY-MM-DD)" value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
      </Row>
      <T tiny muted>First charge is the Saturday on or after the start date. A past start date adds the weeks since then.</T>
      <Button kind="dark" title="Start weekly rent" disabled={!toCents(amount) || !DATE_RE.test(start)} onPress={() => onCreate(mid, amount, start)} />
    </Card>
  );
}

function RentAmountForm({ current, onSave }) {
  const [amount, setAmount] = useState(current ? String(current / 100) : '');
  return (
    <View style={{ gap: 8 }}>
      <Field label="Weekly rent ($)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <T tiny muted>Applies to this week if nothing has been paid on it yet, and every week after.</T>
      <Button small kind="dark" title="Save rent" disabled={!toCents(amount)} onPress={() => onSave(amount)} />
    </View>
  );
}

// When the money came in matters: by Saturday 5 PM is on time.
function whenOptions(lastDue) {
  const now = new Date();
  const opts = [{ value: 'now', label: 'Just now', at: now }];
  const y = new Date(now); y.setDate(y.getDate() - 1); y.setHours(12, 0, 0, 0);
  opts.push({ value: 'yesterday', label: 'Yesterday', at: y });
  if (lastDue) {
    // the most recent due day on or before today, at 4 PM (before the 5 PM cutoff)
    const d = new Date(`${lastDue}T16:00:00`);
    while (d > now) d.setDate(d.getDate() - 7);
    opts.push({ value: 'ontime', label: `${shortDate(d)}, before 5 PM`, at: d });
  }
  return opts;
}

function PaymentForm({ owed, lastDue, onPay }) {
  const [amount, setAmount] = useState(String(owed / 100));
  const [method, setMethod] = useState('cash');
  const opts = whenOptions(lastDue);
  const [when, setWhen] = useState('now');
  const at = (opts.find((o) => o.value === when) || opts[0]).at;
  return (
    <View style={{ gap: 8 }}>
      <Field label={`Amount ($) · owes ${money(owed)}`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Picker
        label="Method"
        value={method}
        onChange={setMethod}
        options={[{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'ach', label: 'Bank' }, { value: 'app', label: 'Cash App / Zelle' }, { value: 'credit', label: 'Credit' }]}
      />
      <Picker label="When they paid" value={when} onChange={setWhen} options={opts.map(({ value, label }) => ({ value, label }))} />
      <T tiny muted>Goes to the oldest unpaid week first.</T>
      <Button small kind="dark" title="Save payment" disabled={!toCents(amount)} onPress={() => onPay(amount, method, at.toISOString())} />
    </View>
  );
}

function ContractForm({ renters, chairs, onCreate }) {
  const [v, setV] = useState({ renter: renters[0].membership_id, rent: '', start: ymd(new Date()), chair: null });
  const set = (k) => (val) => setV({ ...v, [k]: val });
  return (
    <Card>
      <Picker label="Renter" value={v.renter} onChange={set('renter')} options={renters.map((r) => ({ value: r.membership_id, label: r.name }))} />
      {chairs.length > 0 ? (
        <Picker label="Chair" value={v.chair} onChange={set('chair')} options={[{ value: null, label: 'None' }, ...chairs.map((c) => ({ value: c.id, label: c.label }))]} />
      ) : null}
      <Row>
        <Field label="Weekly rent ($)" value={v.rent} onChangeText={set('rent')} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Start (YYYY-MM-DD)" value={v.start} onChangeText={set('start')} keyboardType="numbers-and-punctuation" style={{ flex: 1 }} />
      </Row>
      <Button kind="dark" title="Send for signature" disabled={!v.rent || !DATE_RE.test(v.start)} onPress={() => onCreate(v)} />
    </Card>
  );
}
