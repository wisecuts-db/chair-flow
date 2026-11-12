import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useShop } from '../../lib/shop';
import { shortDate } from '../../lib/format';
import { Button, Card, ErrorText, Field, H2, Item, List, Row, Screen, T, Title } from '../../components/ui';

export default function Clients() {
  const { sb, current, can } = useShop();
  const [clients, setClients] = useState([]);
  const [visits, setVisits] = useState({});
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const loc = current ? current.location_id : null;
  const biz = current && current.locations ? current.locations.business_id : null;

  const load = useCallback(async () => {
    if (!biz) return;
    setError('');
    const c = await sb.from('clients')
      .select('id, full_name, phone, email, notes, marketing_opt_in, renter_id, created_at')
      .eq('business_id', biz).order('full_name').limit(1000);
    if (c.error) { setError(c.error.message); return; }
    setClients(c.data || []);
    const a = await sb.from('appointments').select('client_id, starts_at, status')
      .eq('location_id', loc).order('starts_at', { ascending: false }).limit(2000);
    const map = {};
    (a.data || []).forEach((x) => {
      if (!x.client_id) return;
      const v = map[x.client_id] || { count: 0, last: null };
      if (x.status === 'completed') { v.count += 1; if (!v.last) v.last = x.starts_at; }
      map[x.client_id] = v;
    });
    setVisits(map);
  }, [sb, biz, loc]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) => [c.full_name, c.phone, c.email].some((v) => v && String(v).toLowerCase().includes(s)));
  }, [clients, q]);

  if (!current) return null;
  if (!can('clients.view_all')) {
    return <Screen><Title>Clients</Title><T muted>Your shop owner hasn&apos;t given you access to the client list.</T></Screen>;
  }

  const digits = (p) => String(p || '').replace(/[^0-9+]/g, '');

  return (
    <Screen onRefresh={load}>
      <Title sub={`${clients.length} client${clients.length === 1 ? '' : 's'}`}>Clients</Title>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, phone or email" autoCapitalize="none" autoCorrect={false} />
      <ErrorText>{error}</ErrorText>
      <View>
        <H2>Contact list</H2>
        <List>
          {shown.map((c, i) => {
            const v = visits[c.id];
            const isOpen = open === c.id;
            return (
              <Item key={c.id} last={i === shown.length - 1} onPress={() => setOpen(isOpen ? null : c.id)} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <T strong>{c.full_name}</T>
                    <T tiny muted>
                      {c.phone || 'No phone'}{v && v.count ? ` · ${v.count} visit${v.count === 1 ? '' : 's'} · last ${shortDate(v.last)}` : ' · no visits yet'}
                    </T>
                  </View>
                </Row>
                {isOpen ? (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {c.email ? <T small>{c.email}</T> : null}
                    {c.notes ? <T small muted>Notes: {c.notes}</T> : null}
                    <T tiny muted>{c.marketing_opt_in ? 'OK to receive promotions' : 'Has not opted in to promotions'} · added {shortDate(c.created_at)}</T>
                    <Row wrap>
                      {c.phone ? <Button small kind="dark" title="Call" onPress={() => Linking.openURL(`tel:${digits(c.phone)}`)} /> : null}
                      {c.phone ? <Button small title="Text" onPress={() => Linking.openURL(`sms:${digits(c.phone)}`)} /> : null}
                      {c.email ? <Button small title="Email" onPress={() => Linking.openURL(`mailto:${c.email}`)} /> : null}
                    </Row>
                  </View>
                ) : null}
              </Item>
            );
          })}
          {shown.length === 0 ? <Item last><T small muted>{q ? 'No matches.' : 'No clients yet. They appear here when they book or are added.'}</T></Item> : null}
        </List>
      </View>
      <Card>
        <T tiny muted>Booth renters&apos; own clients stay private to each renter and aren&apos;t listed here.</T>
      </Card>
    </Screen>
  );
}
