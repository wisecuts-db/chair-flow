import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useShop } from '../lib/shop';
import { money, shortDate, ymd, ROLE_LABEL } from '../lib/format';
import { Badge, Button, Card, Chip, ErrorText, Field, H2, Item, List, Picker, Row, T } from './ui';

export const DOC_KINDS = [
  { value: 'booth_contract', label: 'Booth rent contract' },
  { value: 'form_1099', label: '1099 form' },
  { value: 'w9', label: 'W-9' },
  { value: 'license', label: 'State board license' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
];
const kindLabel = (k) => (DOC_KINDS.find((d) => d.value === k) || { label: k }).label;
const LICENSE_BADGE = { active: ['good', 'Active'], pending: ['warn', 'Pending'], expired: ['bad', 'Expired'], suspended: ['bad', 'Suspended'] };
const RENT_BADGE = { paid: ['good', 'Paid'], overdue: ['bad', 'Late'], partial: ['warn', 'Partial'], due_soon: ['warn', 'Due soon'], upcoming: ['plain', 'Upcoming'] };

export default function BarberProfile({ id }) {
  const { sb, current, can } = useShop();
  const [p, setP] = useState(null);
  const [docs, setDocs] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [rent, setRent] = useState([]);
  const [editLicense, setEditLicense] = useState(false);
  const [uploadKind, setUploadKind] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isMe = current && current.id === id;
  const canManage = can('staff.manage');
  const canSeeRent = current && (current.role === 'owner' || can('rent.view') || isMe);

  const load = useCallback(async () => {
    setError('');
    const r = await sb.rpc('staff_profile', { mid: id });
    if (r.error) { setError(r.error.message); return; }
    setP(r.data);
    const d = await sb.from('staff_documents').select('id, kind, storage_path, expires_on, uploaded_at').eq('membership_id', id).order('uploaded_at', { ascending: false });
    setDocs(d.data || []);
    if (r.data && r.data.role === 'renter') {
      const c = await sb.from('contracts').select('id, status, rent_cents, cadence, start_date, signed_at, countersigned_at, version').eq('renter_id', id).order('created_at', { ascending: false });
      setContracts(c.data || []);
      if (canSeeRent) {
        const rs = await sb.from('rent_status_view').select('*').eq('renter_id', id).order('due_on', { ascending: false }).limit(6);
        setRent(rs.data || []);
      }
    }
  }, [sb, id, canSeeRent]);

  useEffect(() => { load(); }, [load]);

  async function upload(kind) {
    setError('');
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets || !res.assets[0]) return;
    const f = res.assets[0];
    setBusy(true);
    try {
      const safe = String(f.name || 'document').replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
      const path = `${p.location_id}/${id}/${Date.now()}-${safe}`;
      const body = await (await fetch(f.uri)).arrayBuffer();
      const up = await sb.storage.from('staff-docs').upload(path, body, { contentType: f.mimeType || 'application/octet-stream' });
      if (up.error) throw up.error;
      const ins = await sb.from('staff_documents').insert({ membership_id: id, kind, storage_path: path });
      if (ins.error) throw ins.error;
      setUploadKind(null);
      await load();
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  }

  async function view(doc) {
    const r = await sb.rpc('open_staff_document', { doc: doc.id });   // also records who opened it
    if (r.error) { setError(r.error.message); return; }
    const s = await sb.storage.from('staff-docs').createSignedUrl(r.data, 300);
    if (s.error) { setError(s.error.message); return; }
    Linking.openURL(s.data.signedUrl);
  }

  function remove(doc) {
    Alert.alert('Delete this document?', kindLabel(doc.kind), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await sb.storage.from('staff-docs').remove([doc.storage_path]);
        const del = await sb.from('staff_documents').delete().eq('id', doc.id);
        if (del.error) setError(del.error.message);
        load();
      } },
    ]);
  }

  if (!p) return <ErrorText>{error}</ErrorText>;
  const lic = p.license;
  const digits = (x) => String(x || '').replace(/[^0-9+]/g, '');

  return (
    <View style={{ gap: 18 }}>
      <ErrorText>{error}</ErrorText>

      <Card>
        <T strong>{ROLE_LABEL[p.role]}{p.chair ? ` · ${p.chair}` : ''}{p.status !== 'active' ? ` · ${p.status}` : ''}</T>
        {p.start_date ? <T small muted>Started {shortDate(p.start_date)}</T> : null}
        {p.email ? <T small>{p.email}</T> : null}
        {p.phone ? <T small>{p.phone}</T> : null}
        {!isMe && (p.phone || p.email) ? (
          <Row wrap>
            {p.phone ? <Button small title="Call" onPress={() => Linking.openURL(`tel:${digits(p.phone)}`)} /> : null}
            {p.phone ? <Button small title="Text" onPress={() => Linking.openURL(`sms:${digits(p.phone)}`)} /> : null}
            {p.email ? <Button small title="Email" onPress={() => Linking.openURL(`mailto:${p.email}`)} /> : null}
          </Row>
        ) : null}
      </Card>

      {lic ? (
        <View>
          <H2>State board license</H2>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <T strong>{lic.number ? `#${lic.number}` : 'No license on file'}{lic.state ? ` · ${lic.state}` : ''}</T>
              {lic.status ? <Badge kind={LICENSE_BADGE[lic.status][0]}>{LICENSE_BADGE[lic.status][1]}</Badge> : <Badge>Unknown</Badge>}
            </Row>
            {lic.expires ? <T small muted>Expires {shortDate(`${lic.expires}T12:00:00`)}</T> : null}
            {canManage && !isMe ? (
              editLicense ? <LicenseForm lic={lic} onCancel={() => setEditLicense(false)} onSave={async (v) => {
                const r = await sb.from('staff_records').upsert({
                  membership_id: id, license_number: v.number || null, license_state: v.state || null,
                  license_expires: v.expires || null, license_status: v.status, updated_at: new Date().toISOString(),
                });
                if (r.error) setError(r.error.message); else { setEditLicense(false); load(); }
              }} /> : <Button small title="Update license" onPress={() => setEditLicense(true)} />
            ) : null}
          </Card>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <H2>Documents</H2>
        <List>
          {contracts.filter((c) => c.status !== 'draft').map((c) => (
            <Item key={c.id}>
              <View style={{ flex: 1 }}>
                <T strong>Booth rent contract (in app) · v{c.version}</T>
                <T tiny muted>{money(c.rent_cents)} {c.cadence} from {c.start_date}{c.signed_at ? ` · signed ${shortDate(c.signed_at)}` : ''}</T>
              </View>
              <Badge kind={c.status === 'countersigned' ? 'good' : 'warn'}>{c.status}</Badge>
            </Item>
          ))}
          {docs.map((d, i) => (
            <Item key={d.id} last={i === docs.length - 1}>
              <View style={{ flex: 1 }}>
                <T strong>{kindLabel(d.kind)}</T>
                <T tiny muted>Uploaded {shortDate(d.uploaded_at)}{d.expires_on ? ` · expires ${d.expires_on}` : ''}</T>
              </View>
              <Button small title="View" onPress={() => view(d)} />
              {isMe || canManage ? <Button small title="Delete" onPress={() => remove(d)} /> : null}
            </Item>
          ))}
          {docs.length === 0 && contracts.length === 0 ? <Item last><T small muted>No documents yet.</T></Item> : null}
        </List>
        {isMe || canManage ? (
          uploadKind === null ? (
            <Button title="Upload a document" onPress={() => setUploadKind('')} />
          ) : (
            <Card>
              <T small muted>What are you uploading? (PDF or photo)</T>
              <Row wrap>
                {DOC_KINDS.map((k) => <Chip key={k.value} title={k.label} selected={false} onPress={() => upload(k.value)} style={{ minHeight: 38 }} />)}
              </Row>
              <Button small title={busy ? 'Uploading…' : 'Cancel'} disabled={busy} onPress={() => setUploadKind(null)} />
            </Card>
          )
        ) : null}
        <T tiny muted>Documents are private: only this person and staff allowed to see licenses and documents can open them. Every view is logged.</T>
      </View>

      {p.role === 'renter' && canSeeRent ? (
        <View>
          <H2>Booth rent</H2>
          <List>
            {rent.map((r, i) => (
              <Item key={r.charge_id} last={i === rent.length - 1}>
                <View style={{ flex: 1 }}>
                  <T strong>Due {r.due_on}</T>
                  <T tiny muted>{money(r.amount_cents)} · paid {money(r.paid_cents)} · balance {money(r.balance_cents)}</T>
                </View>
                <Badge kind={RENT_BADGE[r.display_status][0]}>{RENT_BADGE[r.display_status][1]}</Badge>
              </Item>
            ))}
            {rent.length === 0 ? <Item last><T small muted>No rent charges yet.</T></Item> : null}
          </List>
        </View>
      ) : null}
    </View>
  );
}

function LicenseForm({ lic, onSave, onCancel }) {
  const [v, setV] = useState({ number: lic.number || '', state: lic.state || '', expires: lic.expires || '', status: lic.status || 'active' });
  const ok = !v.expires || /^\d{4}-\d{2}-\d{2}$/.test(v.expires);
  return (
    <View style={{ gap: 8 }}>
      <Row>
        <Field label="License #" value={v.number} onChangeText={(x) => setV({ ...v, number: x })} style={{ flex: 2 }} />
        <Field label="State" value={v.state} onChangeText={(x) => setV({ ...v, state: x.toUpperCase().slice(0, 2) })} style={{ flex: 1 }} autoCapitalize="characters" />
      </Row>
      <Field label="Expires (YYYY-MM-DD)" value={v.expires} onChangeText={(x) => setV({ ...v, expires: x })} keyboardType="numbers-and-punctuation" placeholder={ymd(new Date())} />
      <Picker label="Status" value={v.status} onChange={(x) => setV({ ...v, status: x })}
        options={[{ value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'expired', label: 'Expired' }, { value: 'suspended', label: 'Suspended' }]} />
      <Row>
        <Button small kind="dark" title="Save" disabled={!ok} onPress={() => onSave(v)} />
        <Button small title="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}
