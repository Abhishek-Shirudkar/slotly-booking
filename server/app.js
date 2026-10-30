import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICES, SlotTakenError } from './store.js';
import { signToken, verifyToken, safeEqual } from './auth.js';
import { availableStarts, cells, isValidDate, isClosed, shopNow, addDays } from './slots.js';
import { sendEmail } from './mailer.js';

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp({ store, env = process.env, mail = sendEmail, now = Date.now } = {}) {
  const secret = env.JWT_SECRET || 'dev-secret-change-me';
  const adminPassword = env.ADMIN_PASSWORD || 'demo123';
  const offset = Number(env.TZ_OFFSET_MIN ?? 330);
  const hits = new Map(); // ip -> [timestamps]

  const limited = (ip, max = 10, windowMs = 60000) => {
    const t = now(); const arr = (hits.get(ip) || []).filter((x) => t - x < windowMs);
    arr.push(t); hits.set(ip, arr); return arr.length > max;
  };

  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let data = ''; req.on('data', (c) => { data += c; if (data.length > 20000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('bad json')); } });
  });
  const isAdmin = (req) => {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') && !!verifyToken(h.slice(7), secret);
  };

  async function handleApi(req, res, url) {
    const path = url.pathname; const ip = req.socket.remoteAddress || 'x';
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, store: store.kind });
    if (req.method === 'GET' && path === '/api/services') return json(res, 200, SERVICES);

    if (req.method === 'GET' && path === '/api/slots') {
      const date = url.searchParams.get('date') || ''; const svc = SERVICES.find((s) => s.id === url.searchParams.get('serviceId'));
      if (!isValidDate(date) || !svc) return json(res, 400, { error: 'date and serviceId required' });
      const taken = await store.takenSlots(date);
      return json(res, 200, { date, closed: isClosed(date), slots: availableStarts({ date, minutes: svc.minutes, taken, nowLocal: shopNow(offset, now()) }) });
    }

    if (req.method === 'POST' && path === '/api/bookings') {
      if (limited(ip)) return json(res, 429, { error: 'Too many requests, try again in a minute' });
      const b = await readBody(req);
      const svc = SERVICES.find((s) => s.id === b.serviceId);
      const name = String(b.name || '').trim(), email = String(b.email || '').trim(), phone = String(b.phone || '').trim();
      if (!svc) return json(res, 400, { error: 'Unknown service' });
      if (name.length < 2 || name.length > 80) return json(res, 400, { error: 'Please enter your name' });
      if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Please enter a valid email' });
      if (phone.length > 20) return json(res, 400, { error: 'Phone number too long' });
      const date = String(b.date || ''), time = String(b.time || '');
      // Re-check against the live schedule (never trust the client's slot list).
      const taken = await store.takenSlots(date);
      const ok = availableStarts({ date, minutes: svc.minutes, taken, nowLocal: shopNow(offset, now()) }).includes(time);
      if (!ok) return json(res, 409, { error: 'That time is no longer available. Please pick another.' });
      const booking = { id: randomUUID().slice(0, 8), serviceId: svc.id, service: svc.name, minutes: svc.minutes, price: svc.price,
        name, email, phone, date, time, status: 'confirmed', createdAt: new Date(now()).toISOString() };
      try { await store.book(booking, cells(time, svc.minutes)); }
      catch (e) { if (e instanceof SlotTakenError) return json(res, 409, { error: 'Someone just booked that time. Please pick another.' }); throw e; }
      mail({ to: email, subject: `Booking confirmed: ${svc.name} on ${date} at ${time}`,
        text: `Hi ${name}, your ${svc.name} is booked for ${date} at ${time}. Booking ref: ${booking.id}.` }).catch((e) => console.error('mail error', e.message));
      return json(res, 201, booking);
    }

    if (req.method === 'POST' && path === '/api/admin/login') {
      if (limited(ip, 5)) return json(res, 429, { error: 'Too many attempts' });
      const b = await readBody(req);
      if (!safeEqual(b.password || '', adminPassword)) return json(res, 401, { error: 'Wrong password' });
      return json(res, 200, { token: signToken({ role: 'admin' }, secret) });
    }

    if (path.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized' });
      if (req.method === 'GET' && path === '/api/admin/bookings') {
        const list = await store.listBookings(shopNow(offset, now()).date);
        return json(res, 200, list);
      }
      const m = path.match(/^\/api\/admin\/bookings\/([\w-]+)\/cancel$/);
      if (req.method === 'POST' && m) {
        const b = await store.cancel(m[1]);
        if (!b) return json(res, 404, { error: 'Not found or already cancelled' });
        mail({ to: b.email, subject: 'Your booking was cancelled', text: `Your ${b.service} on ${b.date} at ${b.time} was cancelled.` }).catch(() => {});
        return json(res, 200, b);
      }
    }
    return json(res, 404, { error: 'Not found' });
  }

  async function handleStatic(req, res, url) {
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    try {
      const file = await readFile(join(WEB, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(file);
    } catch { res.writeHead(404); res.end('Not found'); }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await handleStatic(req, res, url);
    } catch (e) {
      if (e.message === 'bad json' || e.message === 'too large') return json(res, 400, { error: e.message });
      console.error(e); json(res, 500, { error: 'Server error' });
    }
  });

  // Day-before reminders. Runs hourly; each booking is reminded once.
  async function runReminders() {
    const tomorrow = addDays(shopNow(offset, now()).date, 1);
    for (const b of await store.dueReminders(tomorrow)) {
      try { await mail({ to: b.email, subject: `Reminder: ${b.service} tomorrow at ${b.time}`, text: `Hi ${b.name}, a reminder of your ${b.service} tomorrow (${b.date}) at ${b.time}.` });
        await store.markReminded(b.id); } catch (e) { console.error('reminder failed', e.message); }
    }
  }
  return { server, runReminders };
}
