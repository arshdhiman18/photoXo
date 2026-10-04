# PhotoXo

Content Production & Approval Management System for a social media / content production agency.

**Status:** V1 complete (Stage 8 — final production completion). Brands & teams, content
pipeline, production routes & tasks, shoots, versions with link or uploaded media, internal +
client approvals, posting & completion, post-publication revisions, expenses, notifications
(in-app + email) and reminders.

Configuration-dependent pieces — **not production-verified** from this repository; verify them
in your own deployment:

- **Email (Resend):** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (required in production) and a
  verified sending domain.
- **Media (Cloudinary, optional):** `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET`. Without
  them, versions use external links only. With them, uploads are stored as `authenticated`
  assets and delivered through signed URLs. Tested here against a mocked Cloudinary API only.
- **Scheduled jobs:** call `GET /api/jobs/tick` every ~15 min with
  `Authorization: Bearer $CRON_SECRET` (required in production). It runs reminders, email
  delivery and notification retention.
- **Domain / HTTPS:** `APP_URL` must be `https://…` in production.

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in MONGODB_URI, BETTER_AUTH_SECRET, APP_URL
npm run dev:db                  # optional: local MongoDB replica set (no Atlas needed)
npm run db:indexes
npm run create-admin            # one-time: agency + first admin
npm run dev
```

Full instructions: [docs/setup.md](docs/setup.md).

## Scripts

| Script                                  | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `dev` / `build` / `start`               | Next.js                                                  |
| `dev:db`                                | Local persistent MongoDB replica set (development only)  |
| `db:indexes`                            | Create/update indexes (run on deploy)                    |
| `create-admin`                          | One-time first-admin bootstrap                           |
| `jobs:tick`                             | Run reminders, email delivery and retention once (local) |
| `seed:demo`                             | Demo data — development only, refuses production         |
| `typecheck` · `lint` · `test` · `check` | Quality gates                                            |

## Architecture docs

1. [Overview](docs/architecture/01-overview.md)
2. [Data model](docs/architecture/02-data-model.md)
3. [Auth & RBAC](docs/architecture/03-auth-rbac.md)
4. [Routes & UI](docs/architecture/04-routes-and-ui.md)
5. [Decisions & risks](docs/architecture/05-decisions-and-risks.md)
6. [Stage 1 implementation record](docs/architecture/06-stage-1-implementation.md)
7. [Stage 2 implementation record](docs/architecture/07-stage-2-implementation.md)
8. [Stage 3 implementation record](docs/architecture/08-stage-3-implementation.md)
9. [Stage 4 implementation record](docs/architecture/09-stage-4-implementation.md)
10. [Stage 5 implementation record](docs/architecture/10-stage-5-implementation.md)
11. [Stage 6 implementation record](docs/architecture/11-stage-6-implementation.md)
12. [Stage 7 implementation record](docs/architecture/12-stage-7-implementation.md)
13. [Stage 8 implementation record — final V1](docs/architecture/13-stage-8-implementation.md)
