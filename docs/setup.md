# PhotoXo — Setup & Operations

## Requirements

- Node.js ≥ 22.12 (developed on 24.x), npm 11
- MongoDB **replica set** (Atlas in all hosted environments; local option below)

## 1. Install

```bash
npm install
cp .env.example .env.local   # then fill in values
```

`.env.local` is git-ignored. Every variable is server-only and validated at startup
(`src/lib/env.schema.ts`); the app refuses to boot with a readable list of problems if
anything is missing or malformed.

Generate the auth secret:

```bash
openssl rand -base64 32
```

## 2. Database

**Atlas (recommended):** set `MONGODB_URI` to the cluster's `mongodb+srv://…` string and
`MONGODB_DB_NAME` (defaults to `photoxo`).

**Local, no Atlas yet:** run a persistent single-node replica set (data in `./.data/mongo`):

```bash
npm run dev:db
```

and use `MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true`.

Create indexes (required in production, where Mongoose auto-indexing is disabled):

```bash
npm run db:indexes
```

## 3. Create the first admin

There is no public sign-up and no default account. The first admin is created once, from
the command line, with a password you choose:

```bash
npm run create-admin
```

It prompts for agency name, your name, email and password (hidden, min 12 characters,
confirmed). It creates the agency (timezone/currency from `APP_TIMEZONE` / `APP_CURRENCY`)
and an ACTIVE admin, and records both in the activity log.

The command **refuses to run again** once PhotoXo is initialised (an atomic one-time marker
guards against concurrent runs), so it cannot be used to mint additional admins.

For provisioning scripts it also accepts the five answers on stdin, one per line.

## Optional: demo data (development only)

```bash
npm run seed:demo
```

Creates brands suffixed “(demo)” and placeholder people on `@demo.photoxo.test` (INVITED,
no password — they cannot sign in), plus a manager placeholder. If ACTIVE staff and client
accounts exist (invite them first), it also drives real services to create shoots, items in
each review state, a posted-then-revised item and expenses in every state. Notifications
come from those services, as in production. No passwords or secrets are created. Refuses to
run in production; production never depends on it.

## Scheduled jobs

`/api/jobs/tick` runs reminders, notification email delivery and notification retention
(read notifications after the configured days; unread non-critical after 365 days; unread
critical notifications are never removed; sent/failed outbox rows after 30 days). Call it
every ~15 minutes from any scheduler (e.g. Vercel Cron) with
`Authorization: Bearer <CRON_SECRET>`. `CRON_SECRET` is required in production. Locally,
run `npm run jobs:tick`.

## Media uploads (optional)

Set all three `CLOUDINARY_*` variables to enable direct uploads for versions and receipts.
The server picks each upload's public id, verifies the finished upload through the
Cloudinary Admin API (type `authenticated`, size, format) and serves it through short signed
delivery URLs. This flow is covered by integration tests against a mocked Cloudinary API; check
it against your Cloudinary account before relying on it.

## 4. Run

```bash
npm run dev       # http://localhost:3000
```

Sign in with the admin you created, then invite people from **Team**.

### Email in development

Without `RESEND_API_KEY`, invitation and password-reset emails are **printed to the server
console** (the invite toast says so) instead of being sent. Production refuses to start
without Resend configured, so delivery is never faked there.

## 5. Quality gates

```bash
npm run typecheck
npm run lint
npm test          # unit + integration (in-memory MongoDB replica set)
npm run check     # all three
```

## Environments

|                    | Development                       | Production (Vercel)                      |
| ------------------ | --------------------------------- | ---------------------------------------- |
| Env source         | `.env.local`                      | Vercel project env vars                  |
| Email              | console transport if Resend unset | Resend **required**                      |
| `CRON_SECRET`      | optional (`npm run jobs:tick`)    | **required** (24+ chars)                 |
| Media uploads      | off unless Cloudinary set         | off unless Cloudinary set (links work)   |
| `APP_URL`          | `http://localhost:3000`           | `https://…` **required**                 |
| Auth rate limiting | off                               | on (database-backed)                     |
| Mongoose autoIndex | on                                | off → run `npm run db:indexes` on deploy |
| Secure cookies     | off (http)                        | on                                       |

Vercel preview deployments also run with `NODE_ENV=production` and therefore need the
same variables (use a separate Atlas database and Resend key for previews).

## Optional: Google sign-in

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (both or neither) and add the redirect URI
`${APP_URL}/api/auth/callback/google` in Google Cloud. Google can only sign in people who
were already invited; it never creates accounts.
