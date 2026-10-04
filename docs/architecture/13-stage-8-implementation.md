# Stage 8 — Final production completion (implementation record)

Status: **implemented — final V1** (2026-10-04)

The request path is unchanged:

Page / Server Action → `Actor` → permission + workflow service → scoped repository → Mongoose

Every new action uses `authedAction`, which runs the capability check before validation and uses strict Zod schemas. Identity and state fields sent by the browser are rejected.

## 1. Expenses

**Domain** (`src/lib/domain/expenses.ts`)

- Categories: TRAVEL, FOOD, PROPS, EQUIPMENT, MATERIALS, PRINTING, DELIVERY, ACCOMMODATION, MISCELLANEOUS.
- Statuses: DRAFT → SUBMITTED → APPROVED | REJECTED.
- SUBMIT is allowed from DRAFT or REJECTED (resubmit). WITHDRAW moves SUBMITTED back to DRAFT. Only DRAFT and REJECTED can be edited.

**Money** (`src/lib/money.ts`)

- Amounts are integer minor units (paise). Input like "1,234.50" is parsed into paise with string arithmetic, never floats.
- The upper limit is ₹1,00,00,000.
- The model validates that amounts are integers.

**Model** (`expenses`)

- Fields: owner `userId`; optional `brandId` and `shootId`; a receipt link or receipt asset; append-only `reviews[]` holding every decision; `revision`.
- Delete hooks refuse deletion.
- Indexes:
  - by owner and date;
  - by status and date;
  - by brand and date;
  - partial index by shoot;
  - by date.

**Rules** (`expenses.service.ts`)

- STAFF, MANAGER and ADMIN can submit expenses. Staff see only their own. Clients have no access at all (repository scope NONE).
- ADMIN and MANAGER can see every expense and decide on them. Nobody can decide their own expense, and a rejection needs a reason.
- Brand and shoot links must be inside the claimant's scope. A shoot implies its brand, and a mismatch is rejected. The brand must be ACTIVE.
- Receipt assets can only be attached by the person who uploaded them, to their own expense. Receipts are visible only to the claimant and to approvers.
- Every write runs in a transaction together with its audit entry (`expense.*`) and notifications (EXPENSE_SUBMITTED to ops; EXPENSE_APPROVED / EXPENSE_REJECTED to the owner).

**UI**

- `/work/expenses`: list, new, detail, edit.
- `/admin/expenses`: filters for date range, employee, brand, shoot, category and status; totals that follow the filters; detail page with approve or reject.
- `/admin/brands/[id]/expenses`.
- An "Expenses to approve" card on the dashboard.
- Desktop shows a table and mobile shows cards. Below `xl`, category moves under the title and the receipt link is on the detail page.

## 2. Post-publication revisions

- `START_REVISION` applies to POSTED or COMPLETED content, or READY_TO_POST content with at least one posted platform. The status becomes CHANGES_REQUESTED.
- Only ADMIN and MANAGER can start one, and a reason is required. It is refused for archived content and archived brands.
- Starting a revision:
  - increments `revisionCount` and appends to `revisions[]`;
  - sets `changesRequestedBy` with `revision` and `approvalId: null`;
  - sets `clientChangesPending`;
  - resets the ready/posted/completed timestamps.
- **Earlier versions, approvals and postings are not modified.** Integration tests deep-compare them before and after. V1's partially posted platforms stay exactly as they were.
- The new version goes through internal review, then client review, then its own posting round.
- On the admin content page, "Posting history by version" shows earlier rounds as _Historical_. `/work/to-post/[id]` shows "Earlier posting rounds".
- The client sees neutral wording ("A new version of this content is being prepared…"). The internal reason is never sent to the client.
- Audit action: `content.post_publication_revision_started`. Owners, the clients and the uploader are notified.

## 3. Cloudinary media

This part is **not production-verified**. It is tested against a mocked Cloudinary Admin API.

1. **Intent.** `createUploadIntentAction` takes only the purpose, file name, MIME type, size and (for versions) the content id. The server checks the caller's right to add a version or a receipt. It then chooses the `publicId` (`photoxo/<agency>/<purpose>/<random>`) and returns signed upload parameters for `type: authenticated`.
   - Allowed: jpeg, png, webp and pdf up to 25 MB; mp4, mov and webm up to 300 MB.
   - Intents expire after 30 minutes (TTL index).
2. **Upload.** The browser uploads straight to Cloudinary, using XHR so it can show progress.
3. **Finalize.** `finalizeUploadAction` takes only the intent id. The server fetches the resource through the Admin API and requires all of the following:
   - `type === "authenticated"`;
   - the same public id;
   - an allowed format;
   - a size within the declared limit.

   The intent is consumed exactly once. An Asset (MEDIA or RECEIPT) is recorded with its metadata, and the upload is audited (`asset.media_uploaded`).

4. **Use.** A version can include only media that the actor uploaded for that same content and that isn't attached to any version yet.
5. **Delivery.** Signed delivery URLs only (`s--sig--`). Images use `f_auto,q_auto`. Video uses a 720p mp4 rendition (`c_limit,h_720,q_auto,vc_auto`); the original stays available. Clients receive URLs only for versions that have passed internal review, and never the internal file names.
6. **Retention.** `mediaRetentionCandidates` is a dry-run plan that only selects media of archived content and excludes current-version media and receipts. **Nothing is deleted automatically**, and originals are never deleted after processing.

## 4. Activity and history

- `listContentActivity` returns events on the content itself plus events whose `meta.contentId` matches: tasks, versions, approvals, postings, shoots and media. It uses a new partial index `{agencyId, meta.contentId, createdAt}`.
- `getContentActivity` is restricted to ADMIN and MANAGER. It maps actions to readable labels with details (status from → to, version, platform, reason).
- The admin content page has a collapsible "Activity" section, newest first. Staff and clients never receive it (tested).

## 5. Notification retention

`runNotificationRetention` runs from `/api/jobs/tick` and from `npm run jobs:tick`. It removes:

- **Read notifications** older than `readNotificationRetentionDays`. The default is 180, the allowed range is 30–3650, and it is set in Settings.
- **Unread non-critical notifications** older than 365 days.
- **Outbox rows** marked SENT or FAILED that are older than 30 days.

**Unread critical notifications are never removed.**

## 6. Email digest

Deferred by decision. It is not part of V1, and no partial implementation exists.

## 7. Experience, search and archiving

- **Admin dashboard:**
  - "Needs attention": internal review, changes requested, posting problems, overdue content and tasks, unfinished shoots, ideas, expenses.
  - Pipeline counts and posts in the last 7 days.
  - Today's shoots.
- **Brand content tab:** the real list with all filters.
- **Content filters:** added priority, due date (overdue / this week) and assignee.
- **Staff:**
  - `/work/shoots` (upcoming / past) and a SHOOTS nav item.
  - My Day gains a "Review & changes" section.
- **Archiving rules:** archived brands accept no new work (versions, revisions, expenses), and archived content can't be revised. Financial and approval history is never deleted.

## 8. Hardening

- **Environment:**
  - `CRON_SECRET` is required in production and must be at least 24 characters.
  - The Cloudinary variables are all-or-nothing.
  - Resend is required in production.
  - `.env.example` is updated.
- **Security audit:**
  - No `dangerouslySetInnerHTML`.
  - `process.env` is read only in the env module and in the dev-only model guard.
  - No client component imports `@/server`.
  - Every link field accepts only `http(s)` URLs.
  - Every mutation schema is strict.
  - Production client bundles contain no secret values.
- **Lint:** fixed `import()` type annotations (services may not import mongoose).

## 9. Demo data (`npm run seed:demo`)

- Brands: Mamaearth, Adidas and boAt (all "(demo)").
- Placeholder people: staff, uploaders, a client and a manager. They are INVITED and cannot sign in.
- Shoots around today. Re-runs override a collision with an audited reason.
- Items in every review state.
- A posted-then-revised item: V1 is posted on Instagram and Facebook, and a revision has been started.
- Four expenses: approved, submitted, rejected and draft.

Everything goes through the real services, so audit entries and notifications are genuine. No passwords or secrets are created. The script refuses to run in production, and production never depends on it.

## 10. Tests

New test files:

- `expenses.test.ts` (12 tests);
- `revisions.test.ts` (7 tests, including the activity timeline);
- `media.test.ts` (6 tests);
- `retention.test.ts` (1 test);
- `cloudinary-urls.test.ts` (3 tests).

The env tests also cover `CRON_SECRET`. The full suite is **340 tests passing across 21 files**. Typecheck, lint (zero warnings) and the production build are clean.
