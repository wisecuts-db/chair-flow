export function money(cents) {
  const n = (cents || 0) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
}

export function toCents(value) {
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function time(d) {
  return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function shortDate(d) {
  return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Local YYYY-MM-DD for a Date.
export function ymd(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

// Start and end of a local day as ISO strings, for range queries.
export function dayBounds(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

export function minutesAgo(d) {
  return Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
}

export const ROLE_LABEL = { owner: 'Owner', partner: 'Managing partner', manager: 'Manager', barber: 'Barber', renter: 'Booth renter' };
