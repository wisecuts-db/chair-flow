import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useShop } from '../lib/shop';
import { Button, ErrorText, Field, Screen, T, Title, C } from '../components/ui';

export default function Login() {
  const shop = useShop();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (shop.ready && shop.session) router.replace('/');
  }, [shop.ready, shop.session]);

  async function sendCode() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) setError(err.message);
    // On success the auth listener reloads the shop and the effect above routes on.
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.ink, marginTop: 24 }}>Chair Flow</Text>
        <Title>{sent ? 'Enter your code' : 'Sign in'}</Title>
        {!sent ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@yourshop.com" />
            <Button kind="dark" title="Email me a sign-in code" onPress={sendCode} loading={busy} disabled={!email.includes('@')} />
            <T small muted>New owner? Sign in and you&apos;ll set up your shop. Barbers and renters: use the email your owner invited.</T>
          </>
        ) : (
          <>
            <T muted>We sent a 6-digit code to {email}.</T>
            <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} inputStyle={{ fontSize: 24, letterSpacing: 6 }} />
            <Button kind="dark" title="Sign in" onPress={verify} loading={busy} disabled={code.trim().length < 6} />
            <Button title="Use a different email" onPress={() => { setSent(false); setCode(''); }} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </Screen>
    </KeyboardAvoidingView>
  );
}
