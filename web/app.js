import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
const html = htm.bind(React.createElement);

const api = async (path, opts = {}, token) => {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const pretty = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function Booking() {
  const [services, setServices] = useState([]);
  const [svc, setSvc] = useState(null);
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState(null);
  const [time, setTime] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => { api('/api/services').then(setServices).catch((e) => setErr(e.message)); }, []);

  const loadSlots = useCallback(() => {
    if (!svc) return;
    setSlots(null);
    api(`/api/slots?date=${date}&serviceId=${svc.id}`).then((r) => { setSlots(r); setTime(''); }).catch((e) => setErr(e.message));
  }, [svc, date]);
  useEffect(loadSlots, [loadSlots]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { setDone(await api('/api/bookings', { method: 'POST', body: JSON.stringify({ ...form, serviceId: svc.id, date, time }) })); }
    catch (x) { setErr(x.message); loadSlots(); } finally { setBusy(false); }
  };

  if (done) return html`<div class="card"><h1 class="good">You're booked!</h1>
    <p>${done.service} on <b>${pretty(done.date)}</b> at <b>${done.time}</b>.</p>
    <p class="mute">Ref <b>${done.id}</b>. A confirmation was sent to ${done.email}.</p>
    <button class="btn" onClick=${() => { setDone(null); setSvc(null); setTime(''); setForm({ name: '', email: '', phone: '' }); }}>Book another</button></div>`;

  const step = !svc ? 1 : !time ? 2 : 3;
  return html`<div>
    <div class="steps" aria-hidden="true"><i class="on"/><i class=${step > 1 ? 'on' : ''}/><i class=${step > 2 ? 'on' : ''}/></div>
    <div class="card"><h2>1. Choose a service</h2>
      <div class="grid">${services.map((s) => html`<button key=${s.id} class=${'opt' + (svc?.id === s.id ? ' sel' : '')} onClick=${() => setSvc(s)}>
        <b>${s.name}</b><small>${s.minutes} min · ₹${s.price}</small></button>`)}</div></div>
    ${svc && html`<div class="card"><h2>2. Pick a date and time</h2>
      <input type="date" aria-label="Date" min=${today()} value=${date} onChange=${(e) => e.target.value && setDate(e.target.value)} />
      <div style=${{ marginTop: 12 }}>${slots === null ? html`<p class="mute">Checking availability…</p>`
        : slots.closed ? html`<p class="mute">Closed on this day. Please pick another date.</p>`
        : slots.slots.length === 0 ? html`<p class="mute">No free times on ${pretty(date)}. Try another day.</p>`
        : html`<div class="times">${slots.slots.map((t) => html`<button key=${t} class=${'opt' + (time === t ? ' sel' : '')} onClick=${() => setTime(t)}>${t}</button>`)}</div>`}</div></div>`}
    ${svc && time && html`<form class="card" onSubmit=${submit}><h2>3. Your details</h2>
      <label for="n">Name</label><input id="n" required minLength="2" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} />
      <label for="e">Email</label><input id="e" type="email" required value=${form.email} onInput=${(e) => setForm({ ...form, email: e.target.value })} />
      <label for="p">Phone (optional)</label><input id="p" type="tel" value=${form.phone} onInput=${(e) => setForm({ ...form, phone: e.target.value })} />
      <button class="btn" disabled=${busy}>${busy ? 'Booking…' : `Confirm ${svc.name}, ${pretty(date)} ${time}`}</button></form>`}
    ${err && html`<p class="err" role="alert">${err}</p>`}
  </div>`;
}

function Admin() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem('tok') || ''; } catch { return ''; } });
  const [pw, setPw] = useState(''); const [list, setList] = useState([]); const [err, setErr] = useState('');
  const load = useCallback(() => {
    if (!token) return;
    api('/api/admin/bookings', {}, token).then(setList).catch((e) => { setErr(e.message); setToken(''); try { sessionStorage.removeItem('tok'); } catch {} });
  }, [token]);
  useEffect(load, [load]);
  const login = async (e) => {
    e.preventDefault(); setErr('');
    try { const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) }); setToken(r.token); try { sessionStorage.setItem('tok', r.token); } catch {} }
    catch (x) { setErr(x.message); }
  };
  const cancel = async (id) => { try { await api(`/api/admin/bookings/${id}/cancel`, { method: 'POST' }, token); load(); } catch (x) { setErr(x.message); } };

  if (!token) return html`<form class="card" onSubmit=${login}><h1>Admin</h1>
    <p class="mute">Demo password: <b>demo123</b></p>
    <label for="pw">Password</label><input id="pw" type="password" required value=${pw} onInput=${(e) => setPw(e.target.value)} />
    <button class="btn">Sign in</button>${err && html`<p class="err" role="alert">${err}</p>`}</form>`;

  const upcoming = list.filter((b) => b.status === 'confirmed');
  const byDay = upcoming.reduce((m, b) => ((m[b.date] ||= []).push(b), m), {});
  return html`<div><div class="card"><h1>Upcoming bookings</h1>
    <p class="mute">${upcoming.length} confirmed · ₹${upcoming.reduce((s, b) => s + b.price, 0)} expected</p></div>
    ${err && html`<p class="err" role="alert">${err}</p>`}
    ${upcoming.length === 0 && html`<div class="card mute">No upcoming bookings yet.</div>`}
    ${Object.entries(byDay).map(([d, items]) => html`<div class="card" key=${d}><h2>${pretty(d)}</h2>
      ${items.map((b) => html`<div class="row" key=${b.id}><div><b>${b.time}</b> · ${b.service} <span class="tag">${b.minutes} min</span>
        <div class="mute">${b.name} · ${b.email}${b.phone ? ' · ' + b.phone : ''}</div></div>
        <button class="btn ghost" style=${{ marginTop: 0 }} onClick=${() => cancel(b.id)}>Cancel</button></div>`)}</div>`)}
    <button class="link" onClick=${() => { setToken(''); try { sessionStorage.removeItem('tok'); } catch {} }}>Sign out</button></div>`;
}

function App() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => { const f = () => setRoute(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const admin = route === '#/admin';
  return html`<div class="wrap"><header class="top"><div class="logo">Slot<span>ly</span> <span class="mute" style=${{ fontWeight: 400, fontSize: 14 }}>· Glow Salon (demo)</span></div>
    <a class="link" href=${admin ? '#/' : '#/admin'}>${admin ? 'Book an appointment' : 'Owner login'}</a></header>
    ${admin ? html`<${Admin}/>` : html`<${Booking}/>`}</div>`;
}
createRoot(document.getElementById('root')).render(html`<${App}/>`);
