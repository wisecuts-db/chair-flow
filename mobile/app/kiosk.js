import { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useShop } from '../lib/shop';
import { supabase } from '../lib/supabase';
import { Button, C, Chip, ErrorText, Field } from '../components/ui';

// Shop-tablet walk-in sign-in. A staff member starts it from the app; the
// tablet then stays on this screen. Hold the shop name for 3 seconds to exit.
export default function Kiosk() {
  useKeepAwake();
  const { current } = useShop();
  const loc = current ? current.location_id : null;
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', service: null, barber: null });
  const [position, setPosition] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resetTimer = useRef(null);

  // Block the Android back button while in kiosk mode.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!loc) return undefined;
    (async () => {
      const b = await supabase.rpc('public_barbers', { loc });
      setBarbers(b.data || []);
      const s = await supabase.from('services').select('id, name').eq('location_id', loc).eq('active', true).is('renter_id', null).order('name');
      setServices(s.data || []);
    })();
    const loadQueue = async () => {
      const w = await supabase.from('walkins').select('id, name, joined_at, services(name)').eq('location_id', loc).eq('status', 'waiting').order('joined_at');
      setQueue(w.data || []);
    };
    loadQueue();
    const t = setInterval(loadQueue, 20000);
    return () => clearInterval(t);
  }, [loc, position]);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function submit() {
    setBusy(true);
    setError('');
    const { data: id, error: err } = await supabase.rpc('join_walkin', {
      loc, p_name: form.name.trim(), p_phone: form.phone.trim(), p_service: form.service, p_barber: form.barber,
    });
    if (err) { setBusy(false); setError(err.message); return; }
    const pos = await supabase.rpc('walkin_position', { w: id });
    setBusy(false);
    setPosition(pos.data || 1);
    setForm({ name: '', phone: '', service: null, barber: null });
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setPosition(null), 10000);
  }

  function exit() {
    Alert.alert('Exit kiosk mode?', 'The tablet will go back to the staff app.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Exit', style: 'destructive', onPress: () => router.replace('/') },
    ]);
  }

  if (!current) return null;
  const shopName = current.locations ? current.locations.name : 'Welcome';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
          <ScrollView style={{ flex: 1, minWidth: 340 }} contentContainerStyle={{ padding: 32, gap: 18 }} keyboardShouldPersistTaps="handled">
            <Pressable onLongPress={exit} delayLongPress={3000} accessibilityLabel="Shop name. Staff: hold for 3 seconds to exit kiosk mode.">
              <Text style={{ color: C.muted, fontSize: 16 }}>{shopName}</Text>
            </Pressable>
            {position !== null ? (
              <View style={{ gap: 16, paddingVertical: 40 }}>
                <Text style={{ fontSize: 44, fontWeight: '700', color: C.ink }}>You&apos;re #{position} in line</Text>
                <Text style={{ fontSize: 18, color: C.muted }}>Have a seat. Your barber will call your name.</Text>
                <Button title="Done" onPress={() => setPosition(null)} style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : (
              <>
                <Text style={{ fontSize: 36, fontWeight: '700', color: C.ink, lineHeight: 40 }}>Walk in? Add yourself to the line.</Text>
                <Field label="First name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoComplete="given-name" inputStyle={{ minHeight: 60, fontSize: 20 }} />
                <Field label="Mobile number" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" autoComplete="tel" inputStyle={{ minHeight: 60, fontSize: 20 }} />
                {services.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: C.muted }}>Service</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {services.map((s) => <Chip key={s.id} title={s.name} selected={form.service === s.id} onPress={() => setForm({ ...form, service: s.id })} style={{ minHeight: 56 }} />)}
                    </View>
                  </View>
                ) : null}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: C.muted }}>Barber</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <Chip title="First available" selected={form.barber === null} onPress={() => setForm({ ...form, barber: null })} style={{ minHeight: 56 }} />
                    {barbers.map((b) => <Chip key={b.id} title={b.name} selected={form.barber === b.id} onPress={() => setForm({ ...form, barber: b.id })} style={{ minHeight: 56 }} />)}
                  </View>
                </View>
                <Button kind="brass" title="Join the line" onPress={submit} loading={busy} disabled={!form.name.trim() || form.phone.trim().length < 7} style={{ minHeight: 64 }} />
                <ErrorText>{error}</ErrorText>
              </>
            )}
          </ScrollView>

          <View style={{ flex: 1, minWidth: 300, backgroundColor: C.ink, padding: 32, gap: 14 }}>
            <Text style={{ color: C.bg, fontSize: 24, fontWeight: '600' }}>Now waiting</Text>
            {queue.map((w, i) => (
              <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: C.darkSoft, borderRadius: 14, padding: 16 }}>
                <Text style={{ color: C.brass, fontSize: 24, fontWeight: '600', width: 28 }}>{i + 1}</Text>
                <Text style={{ color: C.bg, fontSize: 18, fontWeight: '600', flex: 1 }}>{firstNameInitial(w.name)}</Text>
                <Text style={{ color: C.darkMuted }}>{w.services ? w.services.name : ''}</Text>
              </View>
            ))}
            {queue.length === 0 ? <Text style={{ color: C.darkMuted, fontSize: 16 }}>No wait right now.</Text> : null}
            <Text style={{ color: C.darkMuted, marginTop: 'auto' }}>Clients with appointments are seen at their booked time.</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Only first name + last initial on the public screen.
function firstNameInitial(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}
