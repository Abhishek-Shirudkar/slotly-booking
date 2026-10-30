// Pure scheduling logic (easy to test).
export const OPEN = '10:00';
export const CLOSE = '18:00';
export const STEP = 30;
export const CLOSED_DAYS = [0]; // Sunday

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isClosed(date) { return CLOSED_DAYS.includes(new Date(`${date}T00:00:00Z`).getUTCDay()); }

// All start times that fit a service of `minutes` inside opening hours.
export function startTimes(minutes) {
  const out = [];
  for (let m = toMin(OPEN); m + minutes <= toMin(CLOSE); m += STEP) out.push(toTime(m));
  return out;
}

// The 30-min grid cells a booking occupies.
export function cells(start, minutes) {
  const out = [];
  for (let m = toMin(start); m < toMin(start) + minutes; m += STEP) out.push(toTime(m));
  return out;
}

// nowLocal = { date:'YYYY-MM-DD', time:'HH:MM' } in the shop's timezone.
export function availableStarts({ date, minutes, taken, nowLocal }) {
  if (!isValidDate(date) || isClosed(date)) return [];
  return startTimes(minutes).filter((t) => {
    if (date < nowLocal.date) return false;
    if (date === nowLocal.date && toMin(t) <= toMin(nowLocal.time)) return false;
    return cells(t, minutes).every((c) => !taken.has(c));
  });
}

export function shopNow(offsetMinutes = 330, nowMs = Date.now()) {
  const iso = new Date(nowMs + offsetMinutes * 60000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
