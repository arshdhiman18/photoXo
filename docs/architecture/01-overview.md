# PhotoXo — Architecture Overview

Status: **V1 final — as built (Stage 8, 2026-10-04).** This began as the Stage 0 proposal.
Where the build differs, the "As built" notes below take precedence; the per-stage records
(06–13) have the details.
Last updated: 2026-10-04

## 0. As built (V1 final)

- **Request path:** Page / Server Action → `Actor` (from the session; never from the browser)
  → permission + workflow service → scoped repository → Mongoose. Strict Zod schemas reject
  identity/state fields (`userId`, `agencyId`, `role`, `brandId` as authority, `uploaderId`,
  `decidedBy`, `recordedBy`, statuses).
- **Dates:** a small in-repo helper module (`src/lib/dates.ts`, Intl-based) instead of
  date-fns. Money is integer minor units (`src/lib/money.ts`); no floating-point arithmetic.
- **Tests:** Vitest unit + integration suites on an in-memory MongoDB replica set. No
  Playwright suite in V1; browser flows were checked manually at each stage.
- **Scheduling:** one secret-protected endpoint, `/api/jobs/tick` (reminders, email outbox,
  notification retention), instead of several cron routes.
- **Media:** Cloudinary is optional. Uploads go straight from the browser to Cloudinary with
  server-signed parameters; finalize verifies through the Admin API. There are no webhooks and
  no eager transforms: previews are signed on-the-fly renditions (video: 720p mp4). Media
  retention is a **dry-run plan only**; nothing is deleted automatically.
- **Notifications:** in-app (bell polls the unread count) + email via an outbox. The optional
  email digest is deferred (not in V1).
- **Revisions:** posted/completed content can get a post-publication revision (ADMIN/MANAGER,
  reason required). Earlier versions, approvals and postings stay unchanged; the new version
  goes through internal + client review and its own posting round.
- **Not in V1:** reports, campaigns, kanban view, PWA install, comments threads beyond
  approval/decision comments, `/work/calendar` (covered by My Day + My shoots).

## 1. Starting point

The repository was empty at Stage 0 (no code, no git history). Everything below is a
greenfield proposal; nothing existing is being replaced.

## 2. Stack

| Concern    | Choice                                                                                 | Notes                                                                                        |
| ---------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Framework  | Next.js (App Router, latest stable at scaffold time, pinned)                           | RSC for reads, Server Actions for mutations, Route Handlers for webhooks/uploads/cron        |
| Language   | TypeScript `strict` + `noUncheckedIndexedAccess`                                       |                                                                                              |
| UI         | Tailwind CSS v4 + shadcn/ui (Radix primitives)                                         | Components are copied into repo and owned by us                                              |
| Database   | MongoDB Atlas (replica set — required for transactions)                                |                                                                                              |
| ODM        | Mongoose                                                                               | Schemas, indexes, typed models. Prisma's MongoDB support is not a safe bet for a new project |
| Validation | Zod (shared client/server schemas)                                                     | Server always re-validates                                                                   |
| Auth       | Better Auth (MongoDB adapter, DB-backed sessions)                                      | See `03-auth-rbac.md`                                                                        |
| Media      | Cloudinary (signed direct uploads, eager/derived transformations)                      | See §6                                                                                       |
| Email      | Resend (transactional)                                                                 | Invites + notification emails; dev logs to console                                           |
| Dates      | date-fns v4 + @date-fns/tz                                                             | All storage UTC; "today" computed in agency timezone                                         |
| Tests      | Vitest (unit + integration with mongodb-memory-server replset), Playwright (e2e/authz) |                                                                                              |
| Deploy     | Vercel + Vercel Cron                                                                   |                                                                                              |

No other runtime dependencies are planned without justification.

## 3. Layered architecture

```
Browser
  │  (RSC payloads / Server Action POSTs / signed direct upload to Cloudinary)
  ▼
app/  (routes, layouts, pages)          ← thin: parse input, call service, render
  ▼
features/<module>/actions.ts, queries.ts ← Server Actions + read functions; Zod-validate input
  ▼
server/services/<module>.service.ts     ← business logic; ALWAYS receives an authenticated `Actor`
  │      ├─ server/authz/   (policies + scoped query builders)
  │      ├─ server/workflow/ (content & shoot state machines — the ONLY place status changes)
  │      ├─ server/notifications/
  │      └─ server/media/   (Cloudinary)
  ▼
server/db/models/ (Mongoose)  →  MongoDB
```

Rules:

1. **No route, action or query touches a model directly.** Everything goes through a service
   that takes `actor: Actor` (built from the verified session — never from request input).
2. **Every read is scoped.** Services build queries via `scope.<entity>(actor)` which injects
   `agencyId` and the role-specific visibility filter. An ID supplied by the client is only ever
   used _in addition to_ the scope filter (`{ _id: id, ...scope }`), so tampered IDs return 404.
3. **Every response is serialized through a DTO** for the actor's audience
   (`toAdminDTO`, `toStaffDTO`, `toClientDTO`). Client DTOs are allow-lists — new fields on a
   model are invisible to clients by default.
4. **Status changes only happen inside `server/workflow`**, using conditional updates
   (`updateOne({ _id, status: expected }, …)`) so double-clicks / races cannot double-transition,
   and every transition writes an `ActivityLog` entry.
5. All `server/**` modules import `server-only`.

## 4. Major modules

| Module          | Responsibility                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| `auth`          | Sessions, invite acceptance, password reset, `getActor()`                           |
| `users`         | Admin user management (create/invite, deactivate, role)                             |
| `brands`        | Brands, handles, logo, memberships (staff roles, uploaders, client users)           |
| `content`       | Content CRUD, ideas, briefs, references, versions, production tasks                 |
| `references`    | Multi-platform references, embed resolution                                         |
| `shoots`        | Scheduling, crew, linked content, start/complete, conflict detection                |
| `tasks`         | Production tasks (shoot / raw upload / edit / design / upload asset)                |
| `media`         | Signed uploads, asset finalisation, delivery URLs, retention                        |
| `approvals`     | Internal + client gates, versioned, append-only                                     |
| `comments`      | Threaded comments with INTERNAL / CLIENT visibility                                 |
| `posting`       | Ready-to-Post queue, Mark as Posted, completion                                     |
| `expenses`      | Submission, review, filters, aggregates                                             |
| `notifications` | In-app inbox; email outbox                                                          |
| `dashboard`     | Admin command center, Needs Attention, production board, My Day                     |
| `settings`      | Agency-configurable rules (idea approval, categories, routes, retention, reminders) |

## 5. Content lifecycle (state machine)

Content `status` is the coarse pipeline stage. Fine-grained "who does what next" lives in
`ProductionTask`s generated from the content's **production route**.

```
PROPOSED ──(manager approves idea)──► PLANNED            (team ideas, if settings.requireIdeaApproval)
   └──(reject)──► REJECTED
ADMIN_BRIEF / REFERENCE origin ─────► PLANNED
PLANNED ──(first task starts / shoot scheduled)──► IN_PRODUCTION
IN_PRODUCTION ──(version submitted for review)──► INTERNAL_REVIEW
INTERNAL_REVIEW ──approve──► CLIENT_REVIEW
INTERNAL_REVIEW ──request changes──► CHANGES_REQUESTED (gate=INTERNAL)
CLIENT_REVIEW ──approve──► READY_TO_POST
CLIENT_REVIEW ──request changes──► CHANGES_REQUESTED (gate=CLIENT)
CHANGES_REQUESTED ──new version submitted──► INTERNAL_REVIEW   (new version resets BOTH gates)
READY_TO_POST ──uploader marks a platform posted──► POSTED
POSTED ──all target platforms posted──► COMPLETED
any non-terminal ──cancel──► CANCELLED
archivedAt (orthogonal flag) — set on COMPLETED/CANCELLED/REJECTED items; never deletes
```

Invariants enforced in `server/workflow/content.ts`:

- `READY_TO_POST` requires an INTERNAL approval **and** a CLIENT approval on the **same
  current version**.
- Only the resolved uploader(s) (or admin) can create a Posting.
- `COMPLETED` is reachable **only** via Posting records. No admin "mark complete" shortcut
  (open question D-7).
- Content is never hard-deleted once it has left `PROPOSED`/`PLANNED`; it is cancelled/archived.

### Production routes (configurable templates, not hardcoded)

A route is an ordered list of task types stored in `AgencySettings.productionRoutes`.
Seeded defaults:

| Route key         | Tasks generated                                  |
| ----------------- | ------------------------------------------------ |
| `SHOOT_AND_EDIT`  | SHOOT → UPLOAD_CREATION (same person by default) |
| `SHOOT_THEN_EDIT` | SHOOT → UPLOAD_RAW → EDIT (editor)               |
| `DESIGN`          | DESIGN                                           |
| `EXISTING_ASSET`  | UPLOAD_ASSET                                     |

`SHOOT` tasks complete when the linked Shoot is marked complete. Completing a task unlocks the
next one and notifies its assignee (e.g. "Raw footage ready" → editor). The last production task
completes by submitting a `ContentVersion`, which moves content to `INTERNAL_REVIEW`.
Each content type has a default route (settings), overridable per content item.

## 6. Media pipeline

- **Upload:** browser requests a signature from `POST /api/uploads/sign` (authz-checked:
  actor may upload to that content/expense/etc.). Browser uploads the original **directly to
  Cloudinary** (chunked for large video). Vercel never proxies media bytes (function body limits).
- **Finalize:** browser calls a `finalizeAsset` action with the returned `public_id`; the server
  verifies it via the Cloudinary Admin API (exists, matches the signed folder/context) before
  creating the `Asset` record. Cloudinary notification webhook (`/api/webhooks/cloudinary`)
  marks async eager transforms (video previews) as READY.
- **Derived versions:** eager transformations at upload — image: `f_auto,q_auto,w_1600` preview
  and `w_400` thumb; video: 720p MP4 (`q_auto`) + poster frame, generated async; PDF: page-1
  thumbnail. Dashboards always render derived URLs; originals are only served on explicit
  "Download original".
- **Privacy:** assets uploaded with `type: authenticated` and random public IDs; delivery URLs
  are signed server-side _after_ the authz check. (See decision D-5 on expiring URLs.)
- **External sources:** Canva/Figma/Drive links stored as `Asset { storage: EXTERNAL_LINK }` —
  no forced upload.
- **Retention:** a daily cron deletes Cloudinary originals/derivatives for content archived longer
  than `settings.mediaRetentionDays`, setting `asset.mediaPurgedAt`. Metadata, approvals,
  comments, postings and activity history are retained permanently.

## 7. References & embeds

`Reference { platform, url, externalId }` — platform detected from URL on save.

- **YouTube:** privacy-enhanced iframe (`youtube-nocookie.com`) from video ID.
- **Instagram:** official `blockquote.instagram-media` + `embed.js` (public posts only). Optional
  Meta oEmbed (requires app token) for thumbnails later. Never download IG media.
- **TikTok:** public oEmbed endpoint / official embed script.
- **Pinterest:** official pin widget.
- **Website / unsupported / embed failure:** link card with "Open original" fallback.
- **Uploaded file:** `Asset` via normal media pipeline.

Embeds load lazily (click-to-load on mobile to save data) and always show the fallback link.

## 8. Notifications

`notify(event, payload)` in `server/notifications` resolves recipients (e.g. brand uploaders on
READY_TO_POST), writes `Notification` docs (in-app) and, per user preference, `EmailOutbox`
rows. A Vercel cron drains the outbox via Resend. V1 delivers in-app; email events wired for
invites first. In-app updates are fetched on navigation + light polling (no websockets in V1).

## 9. Time & money

- All instants stored as UTC `Date`. Agency has an IANA `timezone` (default `Asia/Kolkata`);
  "today", My Day and daily aggregates are computed in that zone.
- Money stored as **integer minor units** (paise) + ISO currency code. Never floats.

## 10. Multi-tenancy readiness

Single agency in V1, but every tenant-scoped collection carries `agencyId` from day one, every
index is prefixed with `agencyId`, and the scope builder injects it. Converting to SaaS later
becomes: agency onboarding + per-agency settings UI + billing — not a data migration.
`Actor` already carries `agencyId`. Users belong to exactly one agency in V1.

## 11. Responsive strategy (summary — detail in `04-routes-and-ui.md`)

Three persona shells, each designed for its primary device:

- **Admin shell** — desktop-first: collapsible sidebar (icon rail at 768–1279px, sheet drawer
  < 768px), dense tables that become card lists < 768px.
- **Staff shell** — mobile-first: bottom tab bar < 1024px (My Day · Tasks · + · Expenses · Inbox),
  sidebar ≥ 1024px. Bottom sheets for Add Expense / Add Idea / Mark Posted. `capture` inputs for
  camera & receipt uploads.
- **Client shell** — minimal top bar, single column, large approve / request-changes actions.

Global rules: `min-w-0` on flex children, no fixed widths > viewport, tables wrapped in their
own scroll container only when a card transform isn't appropriate, 44px minimum touch targets,
tested at 1440 / 1024 / 768 / 390 / 375.
