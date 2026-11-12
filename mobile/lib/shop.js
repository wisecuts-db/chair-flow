import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { unregisterPush } from './push';

const ShopContext = createContext(null);
export const useShop = () => useContext(ShopContext);

const EMPTY = { ready: false, session: null, profile: null, memberships: [], current: null, perms: {} };

export function ShopProvider({ children }) {
  const [state, setState] = useState(EMPTY);

  const load = useCallback(async (session) => {
    if (!session) {
      setState({ ...EMPTY, ready: true });
      return;
    }
    await supabase.rpc('accept_invites');
    const { data: ms } = await supabase
      .from('memberships')
      .select('id, role, status, location_id, chair_id, locations(id, name, address, business_id, timezone)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .order('created_at');
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', session.user.id).maybeSingle();
    const list = ms || [];
    const saved = await AsyncStorage.getItem('cf.loc');
    const current = list.find((m) => m.location_id === saved) || list[0] || null;
    const perms = await loadPerms(current);
    const sa = await supabase.rpc('is_super_admin');
    setState({ ready: true, session, profile, memberships: list, current, perms, superAdmin: sa.data === true });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') load(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const pickLocation = useCallback(async (locId) => {
    await AsyncStorage.setItem('cf.loc', locId);
    const current = state.memberships.find((m) => m.location_id === locId) || null;
    const perms = await loadPerms(current);
    setState((s) => ({ ...s, current, perms }));
  }, [state.memberships]);

  const value = useMemo(() => ({
    ...state,
    sb: supabase,
    user: state.session ? state.session.user : null,
    reload: () => supabase.auth.getSession().then(({ data }) => load(data.session)),
    pickLocation,
    signOut: async () => { await unregisterPush(); await supabase.auth.signOut(); },
    can: (key) => !!state.current && (state.current.role === 'owner' || !!state.perms[key]),
  }), [state, load, pickLocation]);

  return createElement(ShopContext.Provider, { value }, children);
}

async function loadPerms(current) {
  if (!current || current.role === 'owner') return {};
  const { data } = await supabase
    .from('role_permissions')
    .select('permission, allowed')
    .eq('location_id', current.location_id)
    .eq('role', current.role);
  const perms = {};
  (data || []).forEach((r) => { perms[r.permission] = r.allowed; });
  return perms;
}
