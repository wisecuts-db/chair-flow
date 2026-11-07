import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useShop } from '../../lib/shop';
import { money, ymd, ROLE_LABEL } from '../../lib/format';
import { Badge, C, Card, Chip, ErrorText, H2, Item, List, Row, Screen, Stat, T, Title } from '../../components/ui';

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
];

const TABLE_LABEL = {
  appointments: 'Appointment', sales: 'Sale', walkins: 'Walk-in', services: 'Service', availability: 'Hours',
  time_off: 'Time off', memberships: 'Membership', staff_records: 'Roster record', staff_documents: 'Document',
  contracts: 'Contract', rent_charges: 'Rent charge', rent_payments: 'Rent payment', clients: 'Client', role_permissions: 'Permission',
};

export default function BarberReport() {
  const { id, name } = useLocalSearchParams();
  const { sb, current } = useShop();
  const isOwner = current && current.role === 'owner';
  const [range, setRange] = useState('30');
  const [sum, setSum] = useState(null);
  const [events, setEvents] = useState([]);
  const [openRow, setOpenRow] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const days = RANGES.find((r) => r.id === range).days;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const s = await sb.rpc('barber_summary', { p_membership: id, p_from: ymd(from), p_to: ymd(new Date()) });
    if (s.error) { setError(s.error.message); return; }
    setSum(s.data);
    if (isOwner) {
      const a = await sb.rpc('barber_activity', { p_membership: id, p_from: from.toISOString(), p_to: new Date().toISOString(), p_limit: 300 });
      if (a.error) setError(a.error.message);
      setEvents(a.data || []);
    }
  }, [sb, id, range, isOwner]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    const head = 'when,what,action,fields_changed,by,about_this_barber';
    const lines = events.map((e) => [e.at, TABLE_LABEL[e.table_name] || e.table_name, e.action, (e.changed || []).join(' '), e.actor_name, e.role_in_change !== 'by']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    Share.share({ title: `Audit ${name || ''}`, message: [head, ...lines].join('\n') });
  }

  const a = sum ? sum.appointments : null;
  const sales = sum ? sum.sales : null;
  const rent = sum ? sum.rent : null;
  const showRate = a && a.total ? Math.round((a.no_show / a.total) * 100) : 0;

  return (
    <Screen onRefresh={load}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: C.brassInk, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Title sub={sum ? ROLE_LABEL[sum.role] : ''}>{name || 'Barber'}</Title>
      <Row wrap>
        {RANGES.map((r) => <Chip key={r.id} title={r.label} selected={range === r.id} onPress={() => setRange(r.id)} style={{ minHeight: 36 }} />)}
      </Row>
      <ErrorText>{error}</ErrorText>

      {a ? (
        <View>
          <H2>Appointments</H2>
          <Row wrap>
            <Stat label="Completed" value={a.completed} />
            <Stat label="No-shows" value={`${a.no_show}${a.total ? ` (${showRate}%)` : ''}`} />
            <Stat label="Cancelled" value={a.cancelled} />
            <Stat label="Hours in chair" value={(a.booked_minutes / 60).toFixed(1)} />
            <Stat label="Unique clients" value={a.unique_clients} />
            <Stat label="Walk-ins served" value={sum.walk_ins_served} />
          </Row>
        </View>
      ) : null}

      {sales ? (
        <View>
          <H2>Sales</H2>
          <Row wrap>
            <Stat label="Net sales" value={money(sales.net_cents)} />
            <Stat label="Tips" value={money(sales.tip_cents)} />
            <Stat label="Avg ticket" value={money(sales.avg_ticket_cents)} />
            <Stat label="Discounts + refunds" value={money(sales.discount_cents + sales.refund_cents)} />
          </Row>
        </View>
      ) : sum && sum.role === 'renter' ? (
        <T small muted>A booth renter&apos;s own sales stay private to them.</T>
      ) : null}

      {rent ? (
        <View>
          <H2>Booth rent</H2>
          <Row wrap>
            <Stat label="Charged" value={money(rent.charged_cents)} />
            <Stat label="Paid" value={money(rent.paid_cents)} />
            <Stat label="Balance" value={money(rent.balance_cents)} />
            <Stat label="Late charges" value={rent.late_charges} />
          </Row>
        </View>
      ) : null}

      {sum ? (
        <Card>
          <T strong>Changes in this period</T>
          <T small muted>
            {sum.changes.made_by_them} made by them · {sum.changes.made_by_others_about_them} made by others about them
          </T>
          {sum.changes.appointment_deletes > 0 || sum.changes.sale_edits > 0 ? (
            <Row wrap>
              {sum.changes.appointment_deletes > 0 ? <Badge kind="bad">{sum.changes.appointment_deletes} deleted appointments</Badge> : null}
              {sum.changes.sale_edits > 0 ? <Badge kind="warn">{sum.changes.sale_edits} edited or deleted sales</Badge> : null}
            </Row>
          ) : null}
        </Card>
      ) : null}

      {isOwner ? (
        <View>
          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.muted, letterSpacing: 0.8 }}>AUDIT TRAIL</Text>
            {events.length > 0 ? <Text style={{ color: C.brassInk, fontWeight: '600' }} onPress={exportCsv}>Export</Text> : null}
          </Row>
          <List>
            {events.map((e, i) => {
              const key = `${e.at}-${i}`;
              const open = openRow === key;
              const flag = (e.table_name === 'appointments' && e.action === 'delete') || (e.table_name === 'sales' && e.action !== 'insert');
              return (
                <Item key={key} last={i === events.length - 1} onPress={() => setOpenRow(open ? null : key)} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <T strong>{TABLE_LABEL[e.table_name] || e.table_name} {e.action === 'insert' ? 'added' : e.action === 'update' ? 'changed' : 'deleted'}</T>
                      <T tiny muted>
                        {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {' · by '}{e.actor_name}
                        {e.changed && e.changed.length ? ` · ${e.changed.filter((c) => c !== 'updated_at').join(', ')}` : ''}
                      </T>
                    </View>
                    {flag ? <Badge kind="warn">Review</Badge> : null}
                  </Row>
                  {open ? <Diff e={e} /> : null}
                </Item>
              );
            })}
            {events.length === 0 ? <Item last><T small muted>No activity in this period.</T></Item> : null}
          </List>
          <T tiny muted style={{ marginTop: 8 }}>The audit trail can&apos;t be edited or deleted by anyone, including the owner.</T>
        </View>
      ) : null}
    </Screen>
  );
}

function Diff({ e }) {
  const fields = e.action === 'update' ? (e.changed || []) : Object.keys(e.new_data || e.old_data || {});
  const skip = ['id', 'location_id', 'created_at', 'updated_at'];
  return (
    <View style={{ marginTop: 8, gap: 4 }}>
      {fields.filter((f) => !skip.includes(f)).slice(0, 12).map((f) => (
        <T key={f} tiny>
          <Text style={{ fontWeight: '600' }}>{f}: </Text>
          {e.action === 'update' ? `${fmt(e.old_data && e.old_data[f])} → ${fmt(e.new_data && e.new_data[f])}` : fmt((e.new_data || e.old_data)[f])}
        </T>
      ))}
    </View>
  );
}

function fmt(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
