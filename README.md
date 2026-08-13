# Easyroom

Room and booking management for small hotels. Built first for The Greek
Club in Dahab, but nothing about that property is in the code — logo,
colours, room types, rates and policies are all rows in the database.
Onboarding a second hotel is data entry, not a fork.

## Why it's built this way

**Double-booking is impossible, not unlikely.** Every reason a room is
unavailable — a guest, maintenance, a hold — lives in one table with a
single Postgres exclusion constraint. Two receptionists tapping confirm
in the same millisecond cannot both succeed.

**Tenant isolation is in the database, not the code.** Every table has
Row Level Security. A bug in the frontend cannot leak one hotel's data to
another, which is why the app can talk to Supabase directly with no
backend of its own.

**Occupancy and housekeeping are separate axes.** A room can be empty and
dirty, or occupied and clean. Collapsing them into one status column is
the mistake that makes housekeeping unusable.

**Prices are a matrix, not a number.** `rate = f(room_type, occupancy,
rate_plan, date)`. A room costs one thing for one guest, another for
three, and different again on a corporate contract.

## Stack

- Next.js 16.2.11 + React 19 (App Router), pinned for reproducible builds
- `next-intl` with Arabic `/ar` and English `/en` routes, RTL/LTR and per-user preference
- Supabase: Postgres, Auth, RLS, Edge Functions
- Deployed on Vercel

## Layout

```
app/                  screens (today board, new booking, bookings, housekeeping, reports, settings)
components/Shell.jsx  auth guard, role-based nav, clock, offline strip
lib/supabase.js       client + helpers
lib/offline.js        cache, write queue, sync
messages/             Arabic and English interface dictionaries
public/sw.js          service worker (app shell only, never API data)
supabase/migrations/  exact production history + additive bilingual/security hardening
supabase/functions/   staff-admin (needs the service key, so it runs server-side)
```

## Running locally

```bash
npm install
npm run dev
```

Use Node.js 22 LTS. Validation commands are `npm test`, `npm run lint`,
`npm run test:e2e`, and `npm run build`.

The Supabase URL and publishable key are in `lib/supabase.js`. The
publishable key is meant to be public — all protection is in RLS. The
`service_role` key must never appear in this repository.

## Offline

Reads and housekeeping updates work with no connection. Check-in and
check-out queue and replay. **Creating a booking does not work offline by
design**: two disconnected devices cannot agree on who got room 103, so
confirming a booking that might later fail would be worse than waiting.

## Reports

Revenue is recognised per night, not per booking: a stay crossing a month
boundary belongs partly to each month. Counting the whole total in the
month it was booked makes every period report wrong at the edges.

## Manager PIN

Cancellations, no-shows, early departures and rate changes need a PIN
beyond the login — cancellation is the money-losing action in a hotel.
It is enforced in Postgres, so bypassing the UI achieves nothing, and the
hash lives in a table with RLS on and no policies, unreadable even to an
owner. Five wrong attempts lock it for fifteen minutes.

## Roles

| Role | Sees |
|---|---|
| `owner` | everything, including staff and rates |
| `manager` | everything except deleting financial records |
| `reception` | bookings, guests, rooms, payments |
| `housekeeping` | room cleaning status only — no money, no guest details |
