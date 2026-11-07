import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useShop } from '../../lib/shop';
import { dayBounds, minutesAgo, money, time } from '../../lib/format';
import { Badge, Button, C, Card, ErrorText, Field, H2, Item, List, Picker, Row, Screen, T, Title } from '../../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const OPEN = ['booked', 'confirmed', 'checked_in'];

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
      const b = await sb.from('appointments').select('id, starts_at, status, barber_id, services(name)')
        .eq('location_id', loc).neq('barber_id', me).gte('starts_at', start).lt('starts_at', end).order('starts_at');
      setAll(b.data || []);
    }
    if (can('walkins.manage')) {
      const w = await sb.from('walkins').select('id, name, status, joined_at, assigned_to, preferred_barber, services(name)')
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
  const next = mine.find((a) => OPEN.includes(a.status));
  const showHours = current.role !== 'owner' || hours.length > 0;

  return (
    <Screen onRefresh={load}>
      <Title sub={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}>My day</Title>
      <ErrorText>{error}</ErrorText>

      {next ? (
        <Card dark style={{ gap: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ color: C.brass, fontWeight: '700', fontSize: 12, letterSpacing: 0.8 }}>NEXT · {time(next.starts_at)}</Text>
            <Text style={{ color: C.darkMuted, fontSize: 12 }}>{next.status.replace('_', ' ')}</Text>
          </Row>
          <View>
            <Text style={{ color: C.bg, fontSize: 22, fontWeight: '600' }}>{next.clients ? next.clients.full_name : 'Client'}</Text>
            <Text style={{ color: C.darkMuted }}>
              {next.services ? `${next.services.name} · ${next.services.duration_min} min` : ''}{next.clients && next.clients.phone ? ` · ${next.clients.phone}` : ''}
            </Text>
          </View>
          {next.client_notes ? (
            <Text style={{ color: '#E6E3DA', backgroundColor: C.darkSoft, borderRadius: 10, padding: 10, overflow: 'hidden' }}>Client note: {next.client_notes}</Text>
          ) : null}
          <Row>
            {next.status !== 'checked_in' ? (
              <Button kind="brass" title="Check in" style={{ flex: 1 }} onPress={() => run(sb.from('appointments').update({ status: 'checked_in' }).eq('id', next.id))} />
            ) : null}
            <Button title="Complete" style={{ flex: 1 }} onPress={() => complete(next)} />
          </Row>
        </Card>
      ) : null}

      <View>
        <H2>My appointments today</H2>
        <List>
          {mine.map((a, i) => (
            <Item key={a.id} last={i === mine.length - 1}>
              <T small strong style={{ width: 70 }}>{time(a.starts_at)}</T>
              <View style={{ flex: 1 }}>
                <T strong>{a.clients ? a.clients.full_name : 'Client'}</T>
                <T tiny muted>{a.services ? a.services.name : ''}</T>
              </View>
              {OPEN.includes(a.status) ? (
                <Button small title="No-show" onPress={() => run(sb.from('appointments').update({ status: 'no_show' }).eq('id', a.id))} />
              ) : (
                <Badge>{a.status.replace('_', ' ')}</Badge>
              )}
            </Item>
          ))}
          {mine.length === 0 ? <Item last><T small muted>No appointments today.</T></Item> : null}
        </List>
      </View>

      {can('walkins.manage') ? (
        <View>
          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.muted, letterSpacing: 0.8 }}>WALK-IN LINE</Text>
            <Text style={{ color: C.brassInk, fontWeight: '600' }} onPress={() => router.push('/kiosk')}>Open kiosk</Text>
          </Row>
          <List>
            {queue.map((w, i) => (
              <Item key={w.id} last={i === queue.length - 1} style={{ flexWrap: 'wrap' }}>
                <Text style={{ width: 22, fontSize: 18, fontWeight: '700', color: C.brassInk }}>{i + 1}</Text>
                <View style={{ flex: 1, minWidth: 150 }}>
                  <T strong>{w.name}</T>
                  <T tiny muted>
                    {w.services ? w.services.name : 'Any service'} · waiting {minutesAgo(w.joined_at)} min
                    {w.preferred_barber ? ` · wants ${nameOf(w.preferred_barber)}` : ''}
                    {w.assigned_to ? ` · with ${nameOf(w.assigned_to)}` : ''}
                  </T>
                </View>
                <Row>
                  {w.status === 'waiting' ? (
                    <Button small kind="dark" title="Take" onPress={() => run(sb.from('walkins').update({ status: 'assigned', assigned_to: me, notified_at: new Date().toISOString() }).eq('id', w.id))} />
                  ) : null}
                  <Button small title="Served" onPress={() => run(sb.from('walkins').update({ status: 'served' }).eq('id', w.id))} />
                  <Button small title="Remove" onPress={() => run(sb.from('walkins').update({ status: 'removed' }).eq('id', w.id))} />
                </Row>
              </Item>
            ))}
            {queue.length === 0 ? <Item last><T small muted>Nobody waiting.</T></Item> : null}
          </List>
        </View>
      ) : null}

      {can('schedule.view_all') && all.length > 0 ? (
        <View>
          <H2>Rest of the shop</H2>
          <List>
            {all.map((a, i) => (
              <Item key={a.id} last={i === all.length - 1}>
                <T small strong style={{ width: 70 }}>{time(a.starts_at)}</T>
                <View style={{ flex: 1 }}>
                  <T strong>{nameOf(a.barber_id)}</T>
                  <T tiny muted>{a.services ? a.services.name : 'Busy'}</T>
                </View>
                <Badge>{a.status.replace('_', ' ')}</Badge>
              </Item>
            ))}
          </List>
        </View>
      ) : null}

      {earned !== null ? (
        <Card>
          <T tiny muted>My sales + tips, last 14 days</T>
          <Text style={{ fontSize: 22, fontWeight: '600', color: C.ink }}>{money(earned)}</Text>
        </Card>
      ) : null}

      {showHours ? (
        <View style={{ gap: 8 }}>
          <H2>My bookable hours</H2>
          <List>
            {hours.map((h, i) => (
              <Item key={h.id} last={i === hours.length - 1}>
                <T style={{ flex: 1 }}>{DAYS[h.weekday]} · {h.starts.slice(0, 5)}–{h.ends.slice(0, 5)}</T>
                <Button small title="Remove" onPress={() => run(sb.from('availability').delete().eq('id', h.id))} />
              </Item>
            ))}
            {hours.length === 0 ? <Item last><T small muted>Clients can&apos;t book you until you add hours.</T></Item> : null}
          </List>
          <HoursForm onAdd={(weekday, starts, ends) => run(sb.from('availability').insert({ membership_id: me, weekday, starts, ends }))} />
        </View>
      ) : null}
    </Screen>
  );
}

function HoursForm({ onAdd }) {
  const [day, setDay] = useState(1);
  const [starts, setStarts] = useState('09:00');
  const [ends, setEnds] = useState('17:00');
  const valid = /^\d{1,2}:\d{2}$/.test(starts) && /^\d{1,2}:\d{2}$/.test(ends);
  return (
    <Card>
      <Picker label="Day" value={day} onChange={setDay} options={DAYS.map((d, i) => ({ label: d, value: i }))} />
      <Row>
        <Field label="From (24h)" value={starts} onChangeText={setStarts} style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
        <Field label="To (24h)" value={ends} onChangeText={setEnds} style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
      </Row>
      <Button kind="dark" title="Add hours" disabled={!valid} onPress={() => onAdd(day, starts, ends)} />
    </Card>
  );
}
