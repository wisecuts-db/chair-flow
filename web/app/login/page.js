'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSupabase().auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/app');
    });
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/app` },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <main className="page" style={{ paddingTop: 48, maxWidth: 440 }}>
      <a className="brand" href="/">ShopBoss</a>
      <h1>Sign in</h1>
      {sent ? (
        <div className="card stack">
          <div className="strong">Check your email</div>
          <div className="muted small">We sent a sign-in link to {email}. Open it on this device.</div>
          <button className="btn sm" onClick={() => setSent(false)}>Use a different email</button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourshop.com" />
          </label>
          <button className="btn dark block" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          {error && <div className="error">{error}</div>}
          <p className="small muted" style={{ margin: 0 }}>
            New owner? Sign in and you&apos;ll set up your shop. Barbers and renters: use the email your owner invited.
          </p>
        </form>
      )}
    </main>
  );
}
