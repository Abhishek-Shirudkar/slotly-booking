# Slotly: online appointment booking

A booking system for salons, clinics, tutors and other small businesses. Customers pick a service, a date and a free time slot; the owner sees and manages bookings in an admin dashboard.

**Live demo:** https://slotly-booking.onrender.com (free hosting, so the first load can take ~50 s)
Owner login: open "Owner login", demo password `demo123`.

## Features
- 3-step booking page: service, date and time, details. Only genuinely free slots are shown.
- **No double-booking**, even with simultaneous requests: every 30-minute slot is its own MongoDB document keyed by `date|time`, so taking a slot is an atomic insert. A multi-slot service (e.g. 90 min) either gets all its slots or none.
- Opening hours, closed days and past times are enforced on the server, not just the UI.
- Admin dashboard (JWT login): upcoming bookings by day, expected revenue, cancel with one click (frees the slot).
- Confirmation, cancellation and day-before reminder emails (via Resend when `RESEND_API_KEY` is set, logged in demo mode).
- Rate limiting on booking and login, input validation, timing-safe password check.

## Stack
React 18 (loaded as ES modules, no build step), Node.js (built-in `http`, no framework), MongoDB Atlas, JWT (HS256, `node:crypto`).
Falls back to in-memory storage when `MONGODB_URI` is not set, so it runs locally with zero setup.

## Run locally
```bash
cd server
npm test        # 9 tests: scheduling, JWT, double-booking, concurrency, admin, reminders
npm start       # http://localhost:3000
```
For MongoDB: `npm install` (installs the optional `mongodb` driver) and set `MONGODB_URI`.

## Configuration
| Variable | Purpose | Default |
|---|---|---|
| `MONGODB_URI` | MongoDB connection string | in-memory |
| `ADMIN_PASSWORD` | Owner password | `demo123` |
| `JWT_SECRET` | Token signing secret | dev value, **change in production** |
| `RESEND_API_KEY`, `MAIL_FROM` | Real email sending | demo (logs only) |
| `TZ_OFFSET_MIN` | Shop timezone offset in minutes | `330` (IST) |

## API
`GET /api/services` · `GET /api/slots?date=&serviceId=` · `POST /api/bookings` · `POST /api/admin/login` · `GET /api/admin/bookings` · `POST /api/admin/bookings/:id/cancel`
