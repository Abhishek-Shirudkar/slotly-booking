import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createMemoryStore } from '../store.js';
import { availableStarts, cells, startTimes } from '../slots.js';
import { signToken, verifyToken } from '../auth.js';

// Fixed clock: Mon 2030-01-07 06:00 UTC (11:30 shop time), so 2030-01-08 is a Tuesday.
const NOW = Date.UTC(2030, 0, 7, 6, 0);
async function boot(extra = {}) {
  const sent = []; const store = createMemoryStore();
  const { server, runReminders } = createApp({ store, now: () => NOW, mail: async (m) => { sent.push(m); }, env: { ADMIN_PASSWORD: 'pw', JWT_SECRET: 's', ...extra } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, opts = {}) => { const r = await fetch(base + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); return { status: r.status, body: await r.json() }; };
  return { server, call, sent, store, runReminders };
}
const body = (o) => ({ method: 'POST', body: JSON.stringify(o) });
const good = { serviceId: 'haircut', name: 'Asha', email: 'a@b.co', date: '2030-01-08', time: '10:00' };

test('slot grid and cells', () => {
  assert.equal(startTimes(30)[0], '10:00'); assert.equal(startTimes(90).at(-1), '16:30');
  assert.deepEqual(cells('10:00', 90), ['10:00', '10:30', '11:00']);
});
test('closed on Sunday, past slots hidden', () => {
  const nowLocal = { date: '2030-01-07', time: '11:30' };
  assert.deepEqual(availableStarts({ date: '2030-01-13', minutes: 30, taken: new Set(), nowLocal }), []);
  assert.equal(availableStarts({ date: '2030-01-07', minutes: 30, taken: new Set(), nowLocal })[0], '12:00');
  assert.deepEqual(availableStarts({ date: '2030-01-06', minutes: 30, taken: new Set(), nowLocal }), []);
});
test('JWT sign/verify, tamper and expiry', () => {
  const t = signToken({ role: 'admin' }, 's'); assert.equal(verifyToken(t, 's').role, 'admin');
  assert.equal(verifyToken(t, 'other'), null); assert.equal(verifyToken(t + 'x', 's'), null);
  assert.equal(verifyToken(signToken({}, 's', -10), 's'), null);
});
test('book, then slot disappears and double-booking is rejected', async () => {
  const { server, call, sent } = await boot();
  const r = await call('/api/bookings', body(good)); assert.equal(r.status, 201); assert.equal(sent.length, 1);
  const s = await call('/api/slots?date=2030-01-08&serviceId=haircut'); assert.ok(!s.body.slots.includes('10:00'));
  const again = await call('/api/bookings', body({ ...good, name: 'Ravi', email: 'r@b.co' })); assert.equal(again.status, 409);
  server.close();
});
test('overlapping longer service is blocked', async () => {
  const { server, call } = await boot();
  await call('/api/bookings', body({ ...good, serviceId: 'color', time: '10:00' })); // 10:00-11:30
  const r = await call('/api/bookings', body({ ...good, time: '11:00' })); assert.equal(r.status, 409);
  const ok = await call('/api/bookings', body({ ...good, time: '11:30' })); assert.equal(ok.status, 201);
  server.close();
});
test('concurrent requests for one slot: exactly one wins', async () => {
  const { server, call } = await boot({ });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call('/api/bookings', body({ ...good, name: `User ${i}`, time: '14:00' }))));
  const codes = results.map((r) => r.status);
  assert.equal(codes.filter((c) => c === 201).length, 1);
  assert.ok(codes.every((c) => c === 201 || c === 409 || c === 429));
  server.close();
});
test('validation', async () => {
  const { server, call } = await boot();
  assert.equal((await call('/api/bookings', body({ ...good, email: 'nope' }))).status, 400);
  assert.equal((await call('/api/bookings', body({ ...good, serviceId: 'x' }))).status, 400);
  assert.equal((await call('/api/bookings', body({ ...good, date: '2030-01-13' }))).status, 409); // Sunday
  assert.equal((await call('/api/bookings', body({ ...good, date: '2030-01-07', time: '11:00' }))).status, 409); // past
  server.close();
});
test('admin: auth required, list, cancel frees the slot', async () => {
  const { server, call } = await boot();
  const made = (await call('/api/bookings', body(good))).body;
  assert.equal((await call('/api/admin/bookings')).status, 401);
  assert.equal((await call('/api/admin/login', body({ password: 'bad' }))).status, 401);
  const { token } = (await call('/api/admin/login', body({ password: 'pw' }))).body;
  const h = { Authorization: `Bearer ${token}` };
  assert.equal((await call('/api/admin/bookings', { headers: h })).body.length, 1);
  assert.equal((await call(`/api/admin/bookings/${made.id}/cancel`, { method: 'POST', headers: h })).status, 200);
  assert.equal((await call(`/api/admin/bookings/${made.id}/cancel`, { method: 'POST', headers: h })).status, 404);
  assert.ok((await call('/api/slots?date=2030-01-08&serviceId=haircut')).body.slots.includes('10:00'));
  server.close();
});
test('reminders sent once for tomorrow', async () => {
  const { server, call, sent, runReminders } = await boot();
  await call('/api/bookings', body(good)); sent.length = 0;
  await runReminders(); assert.equal(sent.length, 1); await runReminders(); assert.equal(sent.length, 1);
  server.close();
});
