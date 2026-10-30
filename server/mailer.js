// Sends via Resend when RESEND_API_KEY is set; otherwise logs (demo mode).
export async function sendEmail({ to, subject, text }, env = process.env) {
  if (!env.RESEND_API_KEY) { console.log(`[email:demo] to=${to} subject="${subject}"`); return { demo: true }; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Slotly <onboarding@resend.dev>', to, subject, text }),
  });
  if (!res.ok) throw new Error(`email failed: ${res.status}`);
  return { demo: false };
}
