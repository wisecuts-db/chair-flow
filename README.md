# ShopBoss (formerly Chair Flow)

A barbershop app where owners decide what managers, barbers, booth renters and clients can see. It also gives the owner a complete, tamper-proof audit trail for every barber.

| Folder | What it is | Who uses it |
| --- | --- | --- |
| `mobile/` | iPhone + Android app (Expo / React Native) | Owners, managers, barbers, booth renters; the walk-in kiosk on the shop tablet |
| `web/` | Next.js website | Clients booking online (`/book/<location id>`); browser kiosk as a backup |
| `supabase/migrations/` | Database schema, security rules and audit trail | Already applied to the `chair-flow` Supabase project |

## The mobile app

- **Home** (owner, manager): today's numbers, booth rent status, alerts, a "Share booking link" button, and a button that starts the walk-in kiosk.
- **Day**: my appointments (check in, complete, no-show), the walk-in line, the rest of the shop's schedule, and my bookable hours.
- **Staff**: team, invites, chairs, licenses, services, a **Report** for each barber, and account settings.
- **Rent**: contracts (send, sign, countersign), charges, payments and ledger export.
- **Access** (owner): "who sees what" switches per role.
- **Kiosk**: full-screen walk-in sign-in for the shop tablet. Hold the shop name for 3 seconds to exit.

### Run it

```bash
cd mobile
cp .env.example .env
npm install
npx expo install --fix   # lines package versions up with your Expo SDK
npx expo start           # scan the QR code with Expo Go, or press i / a
```

For App Store / Google Play builds, use EAS: `npm i -g eas-cli && eas build`.

## Put the iPhone app on TestFlight

You need your Apple Developer account and a free Expo account (expo.dev). It takes one command from any Mac, Windows or Linux computer; Expo builds the app in the cloud.

```bash
cd mobile
npm install
npx testflight
```

It asks you to:
1. sign in to Expo (or create an account),
2. create the Expo project (say yes),
3. sign in to your Apple Developer account (with your two-factor code),
4. let it create the signing certificate, provisioning profile and App Store Connect API key (say yes each time).

About 15–25 minutes later the build is in App Store Connect. After Apple finishes processing it (usually 10–15 more minutes), install **TestFlight** on your iPhone and open the invite.

Later builds don't need the computer: on expo.dev open the project, go to **Workflows → TestFlight → Run**. Each build gets the next build number automatically.

The app's Supabase settings for these builds live in `mobile/eas.json`. Once the booking website is deployed, put its URL in `EXPO_PUBLIC_WEB_URL` there so "Share booking link" works.

## Auditing each barber

Every change to appointments, sales, walk-ins, services, hours, time off, roster records, documents, contracts, rent and memberships goes into `audit_log`. Each entry records:

- **who** made the change (`actor`, `actor_membership_id`)
- **which barber** it's about (`subject_membership_id`)
- **what** changed (`changed`, plus the full before and after copies of the record)

The log is append-only. Nobody can edit or delete it through the app or the API, including the owner.

Two database functions power the in-app **Report** screen:

- `barber_summary(membership, from, to)`: appointments (completed, no-shows, cancelled, hours in the chair, unique clients), walk-ins served, sales (net, tips, average ticket, discounts and refunds), rent for renters, and counts of changes. The owner can view it, managers can view it if the owner allows them to see others' earnings, and each barber can view their own. A booth renter's own sales are visible only to that renter.
- `barber_activity(membership, from, to)`: the full change history (owner only), exportable as CSV from the app. Deleted appointments and edited sales are flagged for review.

## One-time Supabase settings (dashboard)

1. **Authentication → Email Templates → Magic Link**: make sure the email includes `{{ .Token }}`, so the app can sign people in with a 6-digit code. For example: `Your Chair Flow code is {{ .Token }}`.
2. **Authentication → URL Configuration**: add the booking website's URL to Redirect URLs.

## Booking website

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Deploy to Vercel with the root directory set to `web`, then put that URL in `mobile/.env` as `EXPO_PUBLIC_WEB_URL`.

## Not built yet

- Text reminders and "your barber is ready" texts (needs Twilio or similar)
- Online deposits and rent payments (planned for Phase 2 with a payment provider such as Stripe Connect)
- Contract documents/PDFs (the app tracks the sign and countersign status today)
- Push notifications
