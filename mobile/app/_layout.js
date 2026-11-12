import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ShopProvider } from '../lib/shop';
import { C } from '../components/ui';
import PushRegistrar from '../components/PushRegistrar';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ShopProvider>
        <StatusBar style="dark" />
        <PushRegistrar />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
          <Stack.Screen name="kiosk" options={{ gestureEnabled: false }} />
        </Stack>
      </ShopProvider>
    </SafeAreaProvider>
  );
}
