import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useShop } from '../lib/shop';
import { Button, ErrorText, Field, Notice, Screen, T, Title } from '../components/ui';

export default function Onboarding() {
  const shop = useShop();
  const [name, setName] = useState(shop.profile && shop.profile.full_name ? shop.profile.full_name : '');
  const [biz, setBiz] = useState('');
  const [loc, setLoc] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (shop.ready && !shop.session) router.replace('/login');
    else if (shop.current) router.replace('/');
  }, [shop.ready, shop.session, shop.current]);

  async function submit() {
    setBusy(true);
    setError('');
    if (name.trim()) await shop.sb.from('profiles').update({ full_name: name.trim() }).eq('id', shop.user.id);
    const { error: err } = await shop.sb.rpc('create_shop', { p_business: biz.trim(), p_location: loc.trim(), p_address: addr.trim() || null });
    setBusy(false);
    if (err) setError(err.message);
    else await shop.reload();
  }

  return (
    <Screen>
      <Title>Set up your shop</Title>
      <T muted>You&apos;ll be the owner. Next you can invite staff and choose who sees what.</T>
      <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="Business name" value={biz} onChangeText={setBiz} placeholder="e.g. Fresh Fades" />
      <Field label="First location name" value={loc} onChangeText={setLoc} placeholder="e.g. Main St" />
      <Field label="Address (optional)" value={addr} onChangeText={setAddr} />
      <Button kind="dark" title="Create my shop" onPress={submit} loading={busy} disabled={!biz.trim() || !loc.trim() || !name.trim()} />
      <ErrorText>{error}</ErrorText>
      <Notice>Working at someone else&apos;s shop? Ask the owner to invite {shop.user ? shop.user.email : 'your email'}, then pull down to refresh or sign in again.</Notice>
      <Button title="Check for my invite" onPress={() => shop.reload()} />
      <Button title="Sign out" onPress={() => shop.signOut()} />
    </Screen>
  );
}
