// Storage layer. Memory store for dev/tests, Mongo store when MONGODB_URI is set.
// Double-booking protection: every 30-min slot is its own document keyed by "date|time".
// The _id uniqueness makes taking a slot atomic, even with concurrent requests.

export class SlotTakenError extends Error {}

export const SERVICES = [
  { id: 'haircut', name: 'Haircut', minutes: 30, price: 300 },
  { id: 'beard', name: 'Beard trim', minutes: 30, price: 150 },
  { id: 'facial', name: 'Facial', minutes: 60, price: 800 },
  { id: 'color', name: 'Hair colour', minutes: 90, price: 1500 },
];

export function createMemoryStore() {
  const slots = new Map();      // "date|time" -> bookingId
  const bookings = new Map();   // id -> booking
  return {
    kind: 'memory',
    async takenSlots(date) {
      const out = new Set();
      for (const k of slots.keys()) { const [d, t] = k.split('|'); if (d === date) out.add(t); }
      return out;
    },
    async book(b, slotTimes) {
      const keys = slotTimes.map((t) => `${b.date}|${t}`);
      if (keys.some((k) => slots.has(k))) throw new SlotTakenError('slot taken');
      keys.forEach((k) => slots.set(k, b.id));
      bookings.set(b.id, { ...b });
      return b;
    },
    async listBookings(fromDate) {
      return [...bookings.values()].filter((b) => b.date >= fromDate)
        .sort((a, c) => (a.date + a.time).localeCompare(c.date + c.time));
    },
    async cancel(id) {
      const b = bookings.get(id);
      if (!b || b.status === 'cancelled') return null;
      b.status = 'cancelled';
      for (const [k, v] of slots) if (v === id) slots.delete(k);
      return { ...b };
    },
    async dueReminders(date) {
      return [...bookings.values()].filter((b) => b.date === date && b.status === 'confirmed' && !b.reminded);
    },
    async markReminded(id) { const b = bookings.get(id); if (b) b.reminded = true; },
  };
}

export async function createMongoStore(uri, dbName = 'slotly') {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  const slots = db.collection('slots');       // _id = "date|time"
  const bookings = db.collection('bookings'); // _id = booking id
  await bookings.createIndex({ date: 1, time: 1 });
  await slots.createIndex({ bookingId: 1 });
  const clean = (d) => { if (!d) return null; const { _id, ...rest } = d; return { id: _id, ...rest }; };
  return {
    kind: 'mongo',
    async takenSlots(date) {
      const docs = await slots.find({ date }).project({ time: 1 }).toArray();
      return new Set(docs.map((d) => d.time));
    },
    async book(b, slotTimes) {
      const docs = slotTimes.map((t) => ({ _id: `${b.date}|${t}`, date: b.date, time: t, bookingId: b.id }));
      try {
        await slots.insertMany(docs, { ordered: true });
      } catch (e) {
        await slots.deleteMany({ bookingId: b.id }); // roll back any slots we did get
        if (e && (e.code === 11000 || e.writeErrors)) throw new SlotTakenError('slot taken');
        throw e;
      }
      const { id, ...rest } = b;
      await bookings.insertOne({ _id: id, ...rest });
      return b;
    },
    async listBookings(fromDate) {
      const docs = await bookings.find({ date: { $gte: fromDate } }).sort({ date: 1, time: 1 }).toArray();
      return docs.map(clean);
    },
    async cancel(id) {
      const r = await bookings.findOneAndUpdate({ _id: id, status: 'confirmed' },
        { $set: { status: 'cancelled' } }, { returnDocument: 'after' });
      if (!r) return null;
      await slots.deleteMany({ bookingId: id });
      return clean(r);
    },
    async dueReminders(date) {
      const docs = await bookings.find({ date, status: 'confirmed', reminded: { $ne: true } }).toArray();
      return docs.map(clean);
    },
    async markReminded(id) { await bookings.updateOne({ _id: id }, { $set: { reminded: true } }); },
  };
}
