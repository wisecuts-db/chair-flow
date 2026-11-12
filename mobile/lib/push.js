// Push notifications: register this phone with Expo and save its token so the
// shop's server can notify the barber about new bookings and upcoming appointments.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const TOKEN_KEY = 'cf.pushToken';

// Show notifications as banners even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(userId) {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('appointments', {
        name: 'Appointments', importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas
      ? Constants.expoConfig.extra.eas.projectId : undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;
    await supabase.from('push_tokens').upsert({
      token, user_id: userId, platform: Platform.OS, enabled: true, updated_at: new Date().toISOString(),
    });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch (e) {
    // Simulators and devices without push support end up here; the app works without push.
    return null;
  }
}

// Stop sending to this phone (called on sign-out).
export async function unregisterPush() {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) {
    await supabase.from('push_tokens').delete().eq('token', token);
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

export function onNotificationTap(handler) {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    handler(resp.notification.request.content.data || {});
  });
  return () => sub.remove();
}
