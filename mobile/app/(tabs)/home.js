import { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useShop } from '../../lib/shop';
import { WEB_URL } from '../../lib/supabase';
import { dayBounds, money, ymd } from '../../lib/format';
import { Badge, Button, C, Card, H2, Item, List, Notice, Row, Screen, Stat, T, Title } from '../../components/ui';

export default function Home() {
  const { sb, current, can, superAdmin } = useShop();
  const [d, setD] = useState(null);
  const loc = current ? current.location_id : null;

  const load = useCallback(async () => {
    if (!loc) return;
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
    if (can('revenue.view') || superAdmin) {
      const s = await sb.from('sales_daily').select('net_cents, renter_owned').eq('location_id', loc).eq('day', ymd(new Date()));
      const rows = s.data || [];
      out.sales = rows.filter((r) => !r.renter_owned).reduce((a, r) => a + (r.net_cents || 0), 0);
      if (superAdmin) out.renterSales = rows.filter((r) => r.renter_owned).reduce((a, r) => a + (r.net_cents || 0), 0);
    }
    const staff = await sb.rpc('location_staff', { loc });
    const chairs = await sb.from('chairs').select('id', { count: 'exact', head: true }).eq('location_id', loc);
    const team = staff.data || [];
    out.staff = team.filter((m) => m.role !== 'owner' && m.status === 'active').length;
    out.chairsUsed = team.filter((m) => m.chair).length;
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
      const c = await sb.from('contracts').select('id, status').eq('location_id', loc).in('status', ['sent', 'signed']);
      (c.data || []).forEach((x) => alerts.push({
        kind: 'warn',
        text: x.status === 'sent' ? 'Contract waiting for the renter to sign' : 'Signed contract ready for your countersignature',
        to: '/rent',
      }));
    }
    if (can('roster.view') && team.length) {
      const soon = new Date();
      soon.setDate(soon.getDate() + 30);
      const recs = await sb.from('staff_records').select('membership_id, license_expires')
        .in('membership_id', team.map((m) => m.membership_id)).lte('license_expires', ymd(soon));
      (recs.data || []).forEach((r) => {
        const who = team.find((m) => m.membership_id === r.membership_id);
        alerts.push({ kind: 'bad', text: `License expires ${r.license_expires}: ${who ? who.name : 'staff member'}`, to: '/staff' });
      });
    }
    out.alerts = alerts;
    setD(out);
  }, [sb, loc, current, can, superAdmin]);

  useEffect(() => { load(); }, [load]);

  if (!current) return null;
  const bookingUrl = WEB_URL ? `${WEB_URL}/book/${loc}` : '';

  return (
    <Screen onRefresh={load}>
      <Title sub={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}>
        {current.locations ? current.locations.name : 'Today'}
      </Title>

      <View>
        <H2>Today</H2>
        <Row wrap>
          <Stat label="Appointments" value={d ? d.appts : '…'} />
          {d && d.waiting !== undefined ? <Stat label="Walk-ins waiting" value={d.waiting} /> : null}
          {d && d.sales !== undefined ? <Stat label="Shop sales (net)" value={money(d.sales)} /> : null}
          {d && d.renterSales !== undefined ? <Stat label="Booth renter sales" value={money(d.renterSales)} /> : null}
          <Stat label="Chairs assigned" value={d ? `${d.chairsUsed} / ${d.chairs}` : '…'} />
        </Row>
      </View>

      {d && d.rent ? (
        <Card dark>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.bg, fontWeight: '700', fontSize: 16 }}>Booth rent</Text>
            <Text style={{ color: C.brass, fontWeight: '600' }} onPress={() => router.push('/rent')}>View all</Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <RentNum label="Outstanding" value={money(d.rent.owed)} />
            <RentNum label="Due soon" value={d.rent.dueSoon} />
            <RentNum label="Overdue" value={d.rent.overdue} color="#F2A07B" />
          </Row>
        </Card>
      ) : null}

      {d && d.alerts.length > 0 ? (
        <View>
          <H2>Needs attention</H2>
          <List>
            {d.alerts.map((a, i) => (
              <Item key={i} last={i === d.alerts.length - 1} onPress={() => router.push(a.to)}>
                <Badge kind={a.kind}>{a.kind === 'bad' ? 'Urgent' : 'To do'}</Badge>
                <T style={{ flex: 1 }}>{a.text}</T>
              </Item>
            ))}
          </List>
        </View>
      ) : null}

      {d && d.staff === 0 ? <Notice>Next step: add services and invite your barbers and booth renters on the Staff tab.</Notice> : null}

      <View style={{ gap: 8 }}>
        <H2>Clients and walk-ins</H2>
        <Button
          kind="dark"
          title="Share online booking link"
          disabled={!bookingUrl}
          onPress={() => Share.share({ message: `Book with ${current.locations ? current.locations.name : 'us'}: ${bookingUrl}` })}
        />
        {!bookingUrl ? <T tiny muted>Set EXPO_PUBLIC_WEB_URL once the booking website is deployed.</T> : null}
        {can('walkins.manage') ? (
          <Button kind="brass" title="Start walk-in kiosk on this device" onPress={() => router.push('/kiosk')} />
        ) : null}
      </View>
    </Screen>
  );
}

function RentNum({ label, value, color }) {
  return (
    <View>
      <Text style={{ color: color || C.bg, fontSize: 22, fontWeight: '600' }}>{value}</Text>
      <Text style={{ color: C.darkMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
