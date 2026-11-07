import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShop } from '../../lib/shop';
import { C } from '../../components/ui';

export default function TabsLayout() {
  const shop = useShop();
  if (shop.ready && !shop.session) return <Redirect href="/login" />;
  if (shop.ready && !shop.current) return <Redirect href="/onboarding" />;

  const role = shop.current ? shop.current.role : null;
  const isOwner = role === 'owner';
  const staffOnly = role === 'barber' || role === 'renter';
  const showRent = isOwner || role === 'renter' || shop.can('rent.view');
  const icon = (name) => ({ color, size }) => <Ionicons name={name} color={color} size={size} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.ink,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.card, borderTopColor: '#E6E2D8' },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('home-outline'), href: staffOnly ? null : '/home' }} />
      <Tabs.Screen name="day" options={{ title: 'Day', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="staff" options={{ title: 'Staff', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="rent" options={{ title: 'Rent', tabBarIcon: icon('cash-outline'), href: showRent ? '/rent' : null }} />
      <Tabs.Screen name="access" options={{ title: 'Access', tabBarIcon: icon('lock-closed-outline'), href: isOwner ? '/access' : null }} />
    </Tabs>
  );
}
