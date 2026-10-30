import { createApp } from './app.js';
import { createMemoryStore, createMongoStore } from './store.js';

async function makeStore() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try { const s = await createMongoStore(uri); console.log('Using MongoDB'); return s; }
    catch (e) { console.error('MongoDB unavailable, falling back to in-memory storage:', e.message); }
  }
  console.log('Using in-memory storage (data resets on restart)');
  return createMemoryStore();
}

const store = await makeStore();
const { server, runReminders } = createApp({ store });
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Slotly listening on ${port}`));
setInterval(() => runReminders().catch((e) => console.error(e)), 60 * 60 * 1000).unref();
