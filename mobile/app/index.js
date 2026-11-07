import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useShop } from '../lib/shop';
import { C } from '../components/ui';

export default function Index() {
  const shop = useShop();
  if (!shop.ready) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator /></View>;
  }
  if (!shop.session) return <Redirect href="/login" />;
  if (!shop.current) return <Redirect href="/onboarding" />;
  const staffOnly = shop.current.role === 'barber' || shop.current.role === 'renter';
  return <Redirect href={staffOnly ? '/day' : '/home'} />;
}
