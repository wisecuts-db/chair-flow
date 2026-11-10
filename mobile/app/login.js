import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { useShop } from '../lib/shop';
import { Button, ErrorText, Field, Notice, Screen, T, Title, C } from '../components/ui';

// Test accounts can sign in with a short username instead of an email.
const toEmail = (v) => {
  const s = v.trim().toLowerCase();
  return s.includes('@') ? s : `${s}@example.com`;
};

const FRIENDLY = {
  'Invalid login credentials': 'Wrong email or password.',
  'Email not confirmed': 'This account is waiting on email confirmation. Ask your ShopBoss admin to turn off "Confirm email" in Supabase.',
  'User already registered': 'That email already has an account. Sign in instead.',
};

export default function Login() {
  const shop = useShop();
  // signin | signup | forgot | reset (emailed code + new password)
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (shop.ready && shop.session) router.replace('/');
  }, [shop.ready, shop.session]);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  const go = (m) => { setMode(m); setError(''); setInfo(''); setCode(''); };
  const fail = (err) => setError(FRIENDLY[err.message] || err.message);

  async function run(fn) {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { fail(e); }
    setBusy(false);
  }

  const signIn = () => run(async () => {
    const { error: err } = await supabase.auth.signInWithPassword({ email: toEmail(email), password });
    if (err) throw err;
  });

  const signUp = () => run(async () => {
    if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    if (err) throw err;
    if (!data.session) {
      // Try signing straight in (works when email confirmation is turned off in Supabase).
      const { error: err2 } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (err2) throw new Error('Your account was created, but sign-in is waiting on an email confirmation setting. Ask your ShopBoss admin to turn off "Confirm email".');
    }
  });

  const sendReset = () => run(async () => {
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (err) throw err;
    setInfo(`If ${email.trim()} has an account, we emailed it a code.`);
    setMode('reset');
  });

  const reset = () => run(async () => {
    if (password.length < 8) throw new Error('Use at least 8 characters for your new password.');
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'recovery' });
    if (err) throw err;
    const { error: err2 } = await supabase.auth.updateUser({ password });
    if (err2) throw err2;
  });

  const apple = () => run(async () => {
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    let cred;
    try {
      cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashedNonce,
      });
    } catch (e) {
      if (e && e.code === 'ERR_REQUEST_CANCELED') return; // user closed the Apple sheet
      throw e;
    }
    if (!cred.identityToken) throw new Error('Apple did not return a sign-in token. Please try again.');
    const { error: err } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken, nonce: rawNonce });
    if (err) throw err;
    // Apple only shares the name the first time; save it.
    const full = [cred.fullName && cred.fullName.givenName, cred.fullName && cred.fullName.familyName].filter(Boolean).join(' ');
    if (full) {
      const { data } = await supabase.auth.getUser();
      if (data.user) await supabase.from('profiles').update({ full_name: full }).eq('id', data.user.id);
    }
  });

  const titles = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset password', reset: 'Choose a new password' };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.ink, marginTop: 24 }}>ShopBoss</Text>
        <Title>{titles[mode]}</Title>
        {info ? <Notice>{info}</Notice> : null}

        {(mode === 'signin' || mode === 'signup') && appleAvailable ? (
          <>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={mode === 'signup' ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={{ height: 48, width: '100%' }}
              onPress={apple}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
              <T small muted>or with email</T>
              <View style={{ flex: 1, height: 1, backgroundColor: C.line }} />
            </View>
          </>
        ) : null}

        {mode === 'signin' ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" textContentType="password" />
            <Button kind="dark" title="Sign in" onPress={signIn} loading={busy} disabled={!email.trim() || !password} />
            <Row2 left="Forgot password?" onLeft={() => go('forgot')} right="Create an account" onRight={() => go('signup')} />
          </>
        ) : null}

        {mode === 'signup' ? (
          <>
            <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
            <Field label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
            <Button kind="dark" title="Create account" onPress={signUp} loading={busy} disabled={!name.trim() || !email.includes('@') || !password} />
            <Row2 left="Already have an account? Sign in" onLeft={() => go('signin')} />
            <T small muted>Barbers and booth renters: use the email your shop owner invited, and you&apos;ll join the shop automatically.</T>
          </>
        ) : null}

        {mode === 'forgot' ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
            <Button kind="dark" title="Email me a reset code" onPress={sendReset} loading={busy} disabled={!email.includes('@')} />
            <Row2 left="Back to sign in" onLeft={() => go('signin')} />
          </>
        ) : null}

        {mode === 'reset' ? (
          <>
            <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} inputStyle={{ fontSize: 24, letterSpacing: 6 }} />
            <Field label="New password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
            <Button kind="dark" title="Save new password" onPress={reset} loading={busy} disabled={code.trim().length < 6 || !password} />
            <Row2 left="Back to sign in" onLeft={() => go('signin')} />
          </>
        ) : null}

        <ErrorText>{error}</ErrorText>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Row2({ left, onLeft, right, onRight }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <Pressable onPress={onLeft} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: C.brassInk, fontWeight: '600' }}>{left}</Text>
      </Pressable>
      {right ? (
        <Pressable onPress={onRight} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: C.brassInk, fontWeight: '600' }}>{right}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
