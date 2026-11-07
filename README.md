# Chair Flow

A barbershop app where owners decide what managers, barbers, booth renters and clients can see. Built with Next.js and Supabase; the access rules live in the database (row-level security), not just the app.

## What's in this version

| Screen | Who | What it does |
| --- | --- | --- |
| `/login` | Everyone | Email sign-in link |
| `/app` | Owner, manager | Set up your shop (first visit), today's numbers, rent status, alerts, booking and kiosk links |
| `/app/day` | Everyone on staff | My appointments (check in, complete, no-show), walk-in line, rest of the shop, my bookable hours |
| `/app/staff` | Everyone on staff | Team list, invites, chairs, licenses, services (renters add their own) |
| `/app/rent` | Owner, renters, managers if allowed | Contracts (send, sign, countersign), rent charges, payments, CSV export |
| `/app/permissions` | Owner | "Who sees what" switches per role |
| `/book/<location id>` | Clients | Public booking: barber, service, day, time, details |
| `/kiosk/<location id>` | Walk-ins | Shop tablet sign-in; shows your place in line |

Booth renters' own clients and sales are never visible to the shop.

## Run it locally

```bash
cp .env.example .env.local   # already points at the chair-flow Supabase project
npm install
npm run dev                  # http://localhost:3000
```

## Supabase setup

The database is live in the `chair-flow` Supabase project (`wujmepphlayugsepqvuv`). Every migration in `supabase/migrations` has already been applied there.

One manual step in the Supabase dashboard: go to **Authentication → URL Configuration** and add your site URL (for example `http://localhost:3000` and your Vercel URL) to **Redirect URLs**, so sign-in links come back to the app.

## Deploy

Import the repo in Vercel, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.example`, and deploy.

## Known limits (next steps)

- Text reminders and "your barber is ready" texts aren't wired up yet (needs Twilio or similar).
- Online deposits and rent payments: planned for Phase 2 via a payment provider such as Stripe Connect.
- Booking times use the visitor's device time zone, so they're right only for clients in the same time zone as the shop.
- Contract text and PDF signatures: the app records sign/countersign status. It doesn't generate the document yet.
