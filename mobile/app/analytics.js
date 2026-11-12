import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useShop } from '../lib/shop';
import { money, ymd, ROLE_LABEL } from '../lib/format';
import { C, Card, Chip, ErrorText, H2, Item, List, Row, Screen, Stat, T, Title } from '../components/ui';

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '1 year', days: 365 },
];

export default function Analytics() {
  const { sb, current, can } = useShop();
  const [range, setRange] = useState('30');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const loc = current ? current.location_id : null;

  const load = useCallback(async () => {
    if (!loc) return;
    setError('');
    const days = RANGES.find((r) => r.id === range).days;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const r = await sb.rpc('shop_analytics', { loc, p_from: ymd(from), p_to: ymd(new Date()) });
    if (r.error) { setError(r.error.message === 'not allowed' ? 'Your shop owner hasn\'t turned on analytics for you.' : r.error.message); return; }
    setD(r.data);
  }, [sb, loc, range]);

  useEffect(() => { load(); }, [load]);

  const a = d ? d.appointments : null;
  const s = d ? d.shop_sales : null;
  const noShowRate = a && a.total ? Math.round((a.no_show / a.total) * 100) : 0;

  return (
    <Screen onRefresh={load}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: C.brassInk, fontWeight: '600' }}>‹ Back</Text>
      </Pressable>
      <Title sub={current && current.locations ? current.locations.name : ''}>Analytics</Title>
      <Row wrap>
        {RANGES.map((r) => <Chip key={r.id} title={r.label} selected={range === r.id} onPress={() => setRange(r.id)} style={{ minHeight: 36 }} />)}
      </Row>
      <ErrorText>{error}</ErrorText>

      {s ? (
        <View>
          <H2>Shop sales</H2>
          <Row wrap>
            <Stat label="Net sales" value={money(s.net_cents)} />
            <Stat label="Tips" value={money(s.tip_cents)} />
            <Stat label="Avg ticket" value={money(s.avg_ticket_cents)} />
            <Stat label="Discounts + refunds" value={money(s.discount_cents + s.refund_cents)} />
          </Row>
        </View>
      ) : null}

      {d && d.renter_sales ? (
        <View>
          <H2>Booth renter sales</H2>
          <Row wrap>
            <Stat label="Renters' net sales" value={money(d.renter_sales.net_cents)} />
            <Stat label="Renters' tips" value={money(d.renter_sales.tip_cents)} />
          </Row>
        </View>
      ) : null}

      {a ? (
        <View>
          <H2>Appointments and clients</H2>
          <Row wrap>
            <Stat label="Completed" value={a.completed} />
            <Stat label="No-shows" value={`${a.no_show} (${noShowRate}%)`} />
            <Stat label="Cancelled" value={a.cancelled} />
            <Stat label="Booked online" value={a.online} />
            <Stat label="Unique clients" value={a.unique_clients} />
            <Stat label="New clients" value={d.new_clients} />
            <Stat label="Walk-ins served" value={`${d.walk_ins.served} of ${d.walk_ins.joined}`} />
          </Row>
        </View>
      ) : null}

      {d && d.rent ? (
        <View>
          <H2>Booth rent</H2>
          <Row wrap>
            <Stat label="Collected" value={money(d.rent.collected_cents)} />
            <Stat label="Outstanding now" value={money(d.rent.outstanding_cents)} />
            <Stat label="Late" value={d.rent.late} />
            <Stat label="Partially paid" value={d.rent.partial} />
          </Row>
        </View>
      ) : null}

      {d && d.messages ? (
        <Card>
          <T strong>Texts sent to clients</T>
          <T small muted>{d.messages.reminders} reminders · {d.messages.receipts} receipts · {d.messages.reviews} review requests</T>
        </Card>
      ) : null}

      {d && d.by_barber ? (
        <View>
          <H2>By barber</H2>
          <List>
            {d.by_barber.map((b, i) => (
              <Item key={b.membership_id} last={i === d.by_barber.length - 1}
                onPress={() => router.push({ pathname: '/barber/[id]', params: { id: b.membership_id, name: b.name } })}>
                <View style={{ flex: 1 }}>
                  <T strong>{b.name}</T>
                  <T tiny muted>{ROLE_LABEL[b.role]} · {b.completed} done · {b.no_show} no-shows · {b.walk_ins} walk-ins</T>
                </View>
                <T strong>{b.sales_private ? 'Private' : money(b.net_cents)}</T>
              </Item>
            ))}
            {d.by_barber.length === 0 ? <Item last><T small muted>No staff yet.</T></Item> : null}
          </List>
          {can('analytics.view') ? <T tiny muted style={{ marginTop: 6 }}>Tap a barber for their full profile and history.</T> : null}
        </View>
      ) : null}
    </Screen>
  );
}
