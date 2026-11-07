'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { ROLE_LABEL } from '@/lib/format';

const ShopContext = createContext(null);
export const useShop = () => useContext(ShopContext);

export default function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState({ loading: true, memberships: [], perms: {} });

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const session = data.session;
    if (!session) {
      router.replace('/login');
      return;
    }
    await sb.rpc('accept_invites');
    const { data: ms, error } = await sb
      .from('memberships')
      .select('id, role, status, location_id, chair_id, locations(id, name, address, business_id, timezone)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .order('created_at');
    const { data: profile } = await sb.from('profiles').select('full_name, email').eq('id', session.user.id).maybeSingle();
    const list = ms || [];
    let saved = null;
    try { saved = window.localStorage.getItem('cf.loc'); } catch (e) { /* storage unavailable */ }
    const current = list.find((m) => m.location_id === saved) || list[0] || null;
    const perms = await loadPerms(sb, current);
    setState({ loading: false, user: session.user, profile, memberships: list, current, perms, error: error ? error.message : '' });
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const pickLocation = useCallback(async (locId) => {
    try { window.localStorage.setItem('cf.loc', locId); } catch (e) { /* ignore */ }
    const current = state.memberships.find((m) => m.location_id === locId) || null;
    const perms = await loadPerms(getSupabase(), current);
    setState((s) => ({ ...s, current, perms }));
  }, [state.memberships]);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }, [router]);

  const value = useMemo(() => ({
    ...state,
    sb: state.loading ? null : getSupabase(),
    reload: load,
    pickLocation,
    signOut,
    can: (key) => !!state.current && (state.current.role === 'owner' || !!state.perms[key]),
  }), [state, load, pickLocation, signOut]);

  if (state.loading) {
    return <main className="page"><div className="muted">Loading…</div></main>;
  }

  const cur = state.current;
  const isOwner = cur && cur.role === 'owner';
  const nav = cur ? [
    { href: '/app', label: 'Home' },
    { href: '/app/day', label: 'Day' },
    { href: '/app/staff', label: 'Staff' },
    (isOwner || state.perms['rent.view'] || cur.role === 'renter') && { href: '/app/rent', label: 'Rent' },
    isOwner && { href: '/app/permissions', label: 'Access' },
  ].filter(Boolean) : [];

  return (
    <ShopContext.Provider value={value}>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/app">Chair Flow</Link>
          <div className="row">
            {state.memberships.length > 1 && (
              <select
                aria-label="Location"
                value={cur ? cur.location_id : ''}
                onChange={(e) => pickLocation(e.target.value)}
                style={{ minHeight: 40, borderRadius: 10, border: '1px solid var(--line)', background: '#fff', padding: '0 8px', fontWeight: 600 }}
              >
                {state.memberships.map((m) => (
                  <option key={m.id} value={m.location_id}>{m.locations ? m.locations.name : 'Location'} · {ROLE_LABEL[m.role]}</option>
                ))}
              </select>
            )}
            {state.memberships.length === 1 && cur && (
              <span className="small muted">{cur.locations ? cur.locations.name : ''} · {ROLE_LABEL[cur.role]}</span>
            )}
            <button className="btn sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>
      {state.error && <div className="page"><div className="error">{state.error}</div></div>}
      {children}
      {nav.length > 0 && (
        <nav className="bottomnav" aria-label="Main">
          <div className="bottomnav-inner">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={pathname === n.href ? 'page' : undefined}>{n.label}</Link>
            ))}
          </div>
        </nav>
      )}
    </ShopContext.Provider>
  );
}

async function loadPerms(sb, current) {
  if (!current || current.role === 'owner') return {};
  const { data } = await sb
    .from('role_permissions')
    .select('permission, allowed')
    .eq('location_id', current.location_id)
    .eq('role', current.role);
  const perms = {};
  (data || []).forEach((r) => { perms[r.permission] = r.allowed; });
  return perms;
}
