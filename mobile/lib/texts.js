// One-tap client texts (receipt, reminder, review request), sent from the staff
// member's own phone through Messages. Each one is logged so the shop can see
// what went out. Automatic texting (Twilio) can replace sendFromPhone later.
import { Alert } from 'react-native';
import * as SMS from 'expo-sms';
import { money, shortDate, time } from './format';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

export function buildText(kind, { appt, shopName, barberName, reviewUrl }) {
  const client = appt.clients || {};
  const svc = appt.services || {};
  if (kind === 'reminder') {
    return `Hi ${first(client.full_name)}, this is ${shopName}. Reminder: your ${svc.name || 'appointment'}`
      + `${barberName ? ` with ${barberName}` : ''} is ${shortDate(appt.starts_at)} at ${time(appt.starts_at)}.`
      + ' Reply here if you need to change it.';
  }
  if (kind === 'receipt') {
    const price = svc.price_cents != null ? money(svc.price_cents) : '';
    return `${shopName} receipt\n${svc.name || 'Service'}${barberName ? ` with ${barberName}` : ''}\n`
      + `${shortDate(appt.starts_at)} ${time(appt.starts_at)}${price ? `\nTotal: ${price}` : ''}\nThank you, ${first(client.full_name)}!`;
  }
  // review
  return `Thanks for coming to ${shopName}, ${first(client.full_name)}! How was your experience?`
    + (reviewUrl ? ` We'd really appreciate a quick review: ${reviewUrl}` : ' Reply and let us know.');
}

export async function sendFromPhone(sb, kind, { appt, locationId, shopName, barberName, reviewUrl }) {
  const phone = appt.clients && appt.clients.phone;
  if (!phone) {
    Alert.alert('No phone number', 'This client has no mobile number on file.');
    return false;
  }
  if (!(await SMS.isAvailableAsync())) {
    Alert.alert('Texting not available', 'This device can\'t send text messages.');
    return false;
  }
  const body = buildText(kind, { appt, shopName, barberName, reviewUrl });
  const { result } = await SMS.sendSMSAsync([phone], body);
  if (result === 'cancelled') return false;
  await sb.from('message_log').insert({
    location_id: locationId, appointment_id: appt.id, client_id: appt.client_id || null, kind,
  });
  return true;
}
