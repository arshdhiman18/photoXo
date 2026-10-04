# Stage 7 — Notifications & reminders (implementation record)

Status: **implemented, awaiting architect review** (2026-10-03)

## Architect decisions applied (from the Stage 6 handoff)

1. **Sending approved content back for changes** now sets `clientChangesPending`. The client
   sees "Changes in progress" and gets a "Your content is being revised" notification,
   instead of the item disappearing.
2. **Already-posted content** still can't be sent back. The refusal message now explains why.
   No new "fresh round" mechanism was built: Stage 7 forbids new approval and posting
   behaviour (see handoff decision 1).
3. **Posting corrections** remain ADMIN only. Unchanged.

## Domain — `src/lib/domain/notifications.ts`

- `NotificationType`: 17 types. Each has a category, allowed audiences (INTERNAL and/or
  CLIENT), a `critical` flag and an `email` flag.
- Email goes only to:
  - `CONTENT_READY_FOR_CLIENT_APPROVAL`
  - `CHANGES_REQUESTED_CLIENT`
  - `CONTENT_READY_TO_POST`
  - `UPLOADER_ASSIGNMENT_PROBLEM`
  - `OVERDUE_ITEM`
- `notificationHref` derives the in-app link from type, entity and the viewer's role. Ids
  are validated, so the result is always an internal path; links are never stored.
- `reminderWindow` is the deterministic reminder window.
- `DEFAULT_REMINDER_SETTINGS` holds the defaults.

## Data

**`notifications`**
- Fields: `agencyId`, `recipientUserId`, `audience`, `type`, `title`, `message`,
  `entityType`, `entityId`, `contentId?`, `brandId?`, `eventKey`, `reminder`, `readAt`,
  `createdAt`.
- Indexes: `{agencyId, recipientUserId, createdAt}`,
  `{agencyId, recipientUserId, readAt, createdAt}`, and a unique
  `{agencyId, recipientUserId, eventKey}` that enforces idempotency.

**`emailOutbox`**
- Fields: rendered `subject`/`text`/`html`, `dedupeKey`, `status`
  (PENDING, SENDING, SENT or FAILED), `attempts`, `nextAttemptAt`, `lockedUntil` (a lease),
  `lastError`, `sentAt`, `providerId`.
- Indexes: `{status, nextAttemptAt}`, `{agencyId, createdAt}`, and a unique
  `{agencyId, dedupeKey}`.

**`agencySettings`** (the Stage 0 collection, created now)
- `reminders {approvalWaitingHours 72, readyToPostHours 24, overdueGraceHours 2,
  repeatEveryHours 24}`.
- Created lazily: a missing document means the defaults.

**`notificationPreferences`**
- `{agencyId, userId, inAppEnabled, emailEnabled}`. A missing document means both are on.

**Reminder scan indexes**
- tasks `{agencyId, status, dueDate}`
- contents `{agencyId, dueDate}` (partial)
- shoots `{agencyId, status, endAt}`

## Flow

1. A service mutation runs inside `withTransaction`.
2. Its audit entries are written.
3. An event emitter (`server/notifications/events.ts`) resolves recipients from server data.
4. `notify()` filters the recipients again, renders the copy for each audience, and
   bulk-upserts the notifications plus their outbox rows **in the same transaction**.
5. After the response, `after()` kicks the dispatcher.
6. The dispatcher claims rows one at a time with a lease and sends them outside any
   transaction, retrying with backoff (up to 5 attempts) before marking a row FAILED and
   logging it.

`notify()` filters every recipient:
- ACTIVE users of the same agency only.
- The type's audiences must allow the user; a client's copy exists only for client types.
- Non-ops users need an ACTIVE membership on the brand (a CLIENT membership for clients).
- Archived brands generate nothing new.
- The person who caused the event is excluded.
- Users who turned off in-app notifications still receive critical ones.

## Recipients

| Event | Recipients |
|---|---|
| Submitted for internal review | ADMIN/MANAGER |
| Internal approved | the brand's active CLIENT users |
| Internal changes requested | production owners (version-task assignees and the submitter) |
| Client changes requested | production owners and the internal approver(s) |
| Client approved | internal approver(s) and production owners. Then: the effective uploader, or ADMIN/MANAGER as `UPLOADER_ASSIGNMENT_PROBLEM` |
| Sent back after approval | owners (changes), clients (being revised), uploader (posting problem) |
| All platforms posted | owners, approvers and clients (client copy) |
| Shoot created / crew added | each assigned crew member |
| Shoot rescheduled / cancelled | active crew |
| Shoot completed (`SHOOT_READY`) | assignees of tasks that were waiting on it |
| Task assigned | the assignee |
| UPLOAD_RAW completed | open EDIT task assignees |

## Reminders — `server/notifications/reminders.ts`

They run from `GET/POST /api/jobs/tick` (`Bearer CRON_SECRET`; returns 404 when the secret
is unset) or `npm run jobs:tick`.

| Reminder | Recipients | When |
|---|---|---|
| Internal review waiting | ops | after `approvalWaitingHours` |
| Client review waiting | clients | after `approvalWaitingHours` |
| Ready to post | effective uploader | after `readyToPostHours` |
| Uploader problem | ops | immediately |
| Overdue task | its assignee | after `overdueGraceHours` |
| Overdue shoot | unfinished crew | after `overdueGraceHours` |
| Overdue content | ops | after `overdueGraceHours` |

Each repeats at most once per `repeatEveryHours` while the item is unresolved. The event key
is `TYPE:entity:R:<anchor>:<window>`, so any number of runs in the same window produce one
reminder.

## UI

- The bell appears in all three shells. Its unread count comes from the layout (server),
  then refreshes by polling every 60s, on window focus, and when the menu opens.
- Inboxes: `/work/inbox`, `/admin/inbox` and `/client/notifications`. They paginate 20 per
  page, filter all/unread, toggle read/unread, offer "mark all read", and include
  preferences.
- Reminder settings live in `/admin/settings` (ADMIN).
