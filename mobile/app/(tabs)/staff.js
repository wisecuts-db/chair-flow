import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { useShop } from '../../lib/shop';
import { money, toCents, ROLE_LABEL } from '../../lib/format';
import { Badge, Button, Card, Chip, ErrorText, Field, H2, Item, List, Picker, Row, Screen, T, Title } from '../../components/ui';

export default function Staff() {
  const shop = useShop();
  const { sb, current, can } = shop;
  const loc = current ? current.location_id : null;
  const manage = can('staff.manage');
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [chairs, setChairs] = useState([]);
  const [services, setServices] = useState([]);
  const [records, setRecords] = useState({});
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!loc) return;
    const s = await sb.rpc('location_staff', { loc });
    setStaff(s.data || []);
    const c = await sb.from('chairs').select('id, label').eq('location_id', loc).order('label');
    setChairs(c.data || []);
    const sv = await sb.from('services').select('id, name, price_cents, duration_min, renter_id, active').eq('location_id', loc).order('name');
    setServices(sv.data || []);
    if (manage) {
      const i = await sb.from('invites').select('id, email, role').eq('location_id', loc).is('accepted_at', null);
      setInvites(i.data || []);
    }
    if (can('roster.view') && (s.data || []).length) {
      const r = await sb.from('staff_records').select('membership_id, license_number, license_expires')
        .in('membership_id', s.data.map((m) => m.membership_id));
      const map = {};
      (r.data || []).forEach((x) => { map[x.membership_id] = x; });
      setRecords(map);
    }
  }, [sb, loc, manage, can]);

  useEffect(() => { load(); }, [load]);

  async function run(promise) {
    setError('');
    const { error: err } = await promise;
    if (err) setError(err.message);
    await load();
  }

  if (!current) return null;

  return (
    <Screen onRefresh={load}>
      <Title>Staff &amp; services</Title>
      <ErrorText>{error}</ErrorText>

      <View>
        <H2>Team</H2>
        <List>
          {staff.map((m, i) => {
            const rec = records[m.membership_id];
            const open = editing === m.membership_id;
            return (
              <Item key={m.membership_id} last={i === staff.length - 1} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <T strong>{m.name}</T>
                    <T tiny muted>
                      {ROLE_LABEL[m.role]}{m.email ? ` · ${m.email}` : ''}{rec && rec.license_expires ? ` · license exp. ${rec.license_expires}` : ''}
                    </T>
                  </View>
                  {m.chair ? <Badge>{m.chair}</Badge> : null}
                  {m.role !== 'owner' && (current.role === 'owner' || can('earnings.view_others') || m.membership_id === current.id) ? (
                    <Button small title="Report" onPress={() => router.push({ pathname: '/barber/[id]', params: { id: m.membership_id, name: m.name } })} />
                  ) : null}
                  {manage && m.role !== 'owner' ? <Button small title={open ? 'Close' : 'Edit'} onPress={() => setEditing(open ? null : m.membership_id)} /> : null}
                </Row>
                {open ? (
                  <MemberEditor
                    member={m}
                    record={rec}
                    chairs={chairs}
                    onChair={(chairId) => run(sb.from('memberships').update({ chair_id: chairId }).eq('id', m.membership_id))}
                    onLicense={(num, exp) => run(sb.from('staff_records').upsert({ membership_id: m.membership_id, license_number: num || null, license_expires: exp || null, updated_at: new Date().toISOString() }))}
                    onRemove={() => Alert.alert('Remove from this location?', m.name, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => { setEditing(null); run(sb.from('memberships').update({ status: 'inactive' }).eq('id', m.membership_id)); } },
                    ])}
                  />
                ) : null}
              </Item>
            );
          })}
        </List>
      </View>

      {manage ? (
        <View style={{ gap: 8 }}>
          <H2>Invite someone</H2>
          <InviteForm
            canInviteManager={current.role === 'owner'}
            onInvite={(email, role) => run(sb.from('invites').upsert({ location_id: loc, email: email.toLowerCase(), role }, { onConflict: 'location_id,email' }))}
          />
          {invites.length > 0 ? (
            <List>
              {invites.map((iv, i) => (
                <Item key={iv.id} last={i === invites.length - 1}>
                  <View style={{ flex: 1 }}>
                    <T strong>{iv.email}</T>
                    <T tiny muted>{ROLE_LABEL[iv.role]} · waiting for them to sign in</T>
                  </View>
                  <Button small title="Cancel" onPress={() => run(sb.from('invites').delete().eq('id', iv.id))} />
                </Item>
              ))}
            </List>
          ) : null}
          <T tiny muted>They download ShopBoss, sign in with that email, and join automatically.</T>
        </View>
      ) : null}

      {manage ? (
        <View style={{ gap: 8 }}>
          <H2>Chairs</H2>
          <Row wrap>
            {chairs.map((c) => <Badge key={c.id}>{c.label}</Badge>)}
            {chairs.length === 0 ? <T small muted>No chairs yet.</T> : null}
          </Row>
          <OneField label="New chair" placeholder="e.g. Chair 1" button="Add chair" onSubmit={(v) => run(sb.from('chairs').insert({ location_id: loc, label: v }))} />
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <H2>Services</H2>
        <List>
          {services.map((sv, i) => (
            <Item key={sv.id} last={i === services.length - 1}>
              <View style={{ flex: 1 }}>
                <T strong>{sv.name}{!sv.active ? ' (hidden)' : ''}</T>
                <T tiny muted>{sv.duration_min} min{sv.renter_id ? ' · renter service' : ''}</T>
              </View>
              <T strong>{money(sv.price_cents)}</T>
              {(sv.renter_id ? sv.renter_id === current.id : can('services.manage')) ? (
                <Button small title={sv.active ? 'Hide' : 'Show'} onPress={() => run(sb.from('services').update({ active: !sv.active }).eq('id', sv.id))} />
              ) : null}
            </Item>
          ))}
          {services.length === 0 ? <Item last><T small muted>No services yet.</T></Item> : null}
        </List>
        {can('services.manage') || current.role === 'renter' ? (
          <ServiceForm
            renter={current.role === 'renter'}
            onAdd={(name, price, minutes) => run(sb.from('services').insert({
              location_id: loc, name, price_cents: toCents(price), duration_min: parseInt(minutes, 10) || 30,
              renter_id: current.role === 'renter' ? current.id : null,
            }))}
          />
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <H2>Account</H2>
        <Card>
          <T strong>{shop.profile && shop.profile.full_name ? shop.profile.full_name : shop.user ? shop.user.email : ''}</T>
          <T tiny muted>{shop.user ? shop.user.email : ''}</T>
          {shop.memberships.length > 1 ? (
            <Picker
              label="Location"
              value={current.location_id}
              onChange={(id) => shop.pickLocation(id)}
              options={shop.memberships.map((m) => ({ value: m.location_id, label: `${m.locations ? m.locations.name : 'Location'} · ${ROLE_LABEL[m.role]}` }))}
            />
          ) : (
            <T small muted>{current.locations ? current.locations.name : ''} · {ROLE_LABEL[current.role]}</T>
          )}
          <Button title="Sign out" onPress={() => shop.signOut()} />
        </Card>
      </View>
    </Screen>
  );
}

function MemberEditor({ member, record, chairs, onChair, onLicense, onRemove }) {
  const [num, setNum] = useState(record ? record.license_number || '' : '');
  const [exp, setExp] = useState(record ? record.license_expires || '' : '');
  const currentChair = (chairs.find((c) => c.label === member.chair) || {}).id || null;
  const expOk = !exp || /^\d{4}-\d{2}-\d{2}$/.test(exp);
  return (
    <View style={{ gap: 10, paddingTop: 10 }}>
      {chairs.length > 0 ? (
        <Picker
          label="Chair"
          value={currentChair}
          onChange={onChair}
          options={[{ value: null, label: 'None' }, ...chairs.map((c) => ({ value: c.id, label: c.label }))]}
        />
      ) : null}
      <Row>
        <Field label="License #" value={num} onChangeText={setNum} style={{ flex: 1 }} />
        <Field label="Expires (YYYY-MM-DD)" value={exp} onChangeText={setExp} style={{ flex: 1 }} keyboardType="numbers-and-punctuation" />
      </Row>
      <Row>
        <Button small kind="dark" title="Save license" disabled={!expOk} onPress={() => onLicense(num, exp)} />
        <Button small title="Remove from location" onPress={onRemove} />
      </Row>
    </View>
  );
}

function InviteForm({ onInvite, canInviteManager }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('barber');
  const roles = [{ value: 'barber', label: 'Barber' }, { value: 'renter', label: 'Booth renter' }];
  if (canInviteManager) roles.push({ value: 'manager', label: 'Manager' });
  return (
    <Card>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Row wrap>{roles.map((r) => <Chip key={r.value} title={r.label} selected={role === r.value} onPress={() => setRole(r.value)} style={{ minHeight: 38 }} />)}</Row>
      <Button kind="dark" title="Invite" disabled={!email.includes('@')} onPress={() => { onInvite(email.trim(), role); setEmail(''); }} />
    </Card>
  );
}

function OneField({ label, placeholder, button, onSubmit }) {
  const [v, setV] = useState('');
  return (
    <Row style={{ alignItems: 'flex-end' }}>
      <Field label={label} placeholder={placeholder} value={v} onChangeText={setV} style={{ flex: 1 }} />
      <Button title={button} disabled={!v.trim()} onPress={() => { onSubmit(v.trim()); setV(''); }} />
    </Row>
  );
}

function ServiceForm({ onAdd, renter }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState('30');
  return (
    <Card>
      <Field label={renter ? 'Your service' : 'Service'} value={name} onChangeText={setName} placeholder="Haircut" />
      <Row>
        <Field label="Price ($)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={{ flex: 1 }} />
        <Field label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" style={{ flex: 1 }} />
      </Row>
      <Button kind="dark" title="Add service" disabled={!name.trim() || !price} onPress={() => { onAdd(name.trim(), price, minutes); setName(''); setPrice(''); }} />
    </Card>
  );
}
