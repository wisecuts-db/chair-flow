import { useEffect } from 'react';
import { router } from 'expo-router';
import { useShop } from '../lib/shop';
import { onNotificationTap, registerForPush } from '../lib/push';

// Registers the signed-in staff member's phone for push, and opens the
// Schedule when they tap a booking notification.
export default function PushRegistrar() {
  const { ready, session, current } = useShop();
  const userId = session ? session.user.id : null;

  useEffect(() => {
    if (ready && userId && current) registerForPush(userId);
  }, [ready, userId, current]);

  useEffect(() => onNotificationTap((data) => {
    if (data && (data.type === 'new_booking' || data.type === 'reminder')) router.push('/day');
  }), []);

  return null;
}
