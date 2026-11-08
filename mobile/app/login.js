import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useShop } from '../lib/shop';
import { Button, ErrorText, Field, Screen, T, Title, C } from '../components/ui';

// Test accounts can sign in with a short username instead of an email.
const toEmail = (v) => {
  const s = v.trim().toLowerCase();
  return s.includes('@') ? s : `${s}@example.com`;
};

export default function Login() {
  const shop = useShop();
  const [mode, setMode] = useState('code'); // 'code' | 'password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  async function passwordSignIn() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: toEmail(email), password });
    setBusy(false);
    if (err) setError(err.message === 'Invalid login credentials' ? 'Wrong username or password.' : err.message);
  }

  const switchMode = (m) => { setMode(m); setSent(false); setCode(''); setPassword(''); setError(''); };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.ink, marginTop: 24 }}>ShopBoss</Text>
        <Title>{sent ? 'Enter your code' : 'Sign in'}</Title>

        {mode === 'password' ? (
          <>
            <Field label="Email or username" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" />
            <Button kind="dark" title="Sign in" onPress={passwordSignIn} loading={busy} disabled={!email.trim() || !password} />
            <Button title="Email me a code instead" onPress={() => switchMode('code')} />
          </>
        ) : !sent ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@yourshop.com" />
            <Button kind="dark" title="Email me a sign-in code" onPress={sendCode} loading={busy} disabled={!email.includes('@')} />
            <Button title="Sign in with a password" onPress={() => switchMode('password')} />
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
