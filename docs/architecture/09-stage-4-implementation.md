# Stage 4 — Shoots, crew, scheduling, My Day & production board (implementation record)

Status: **implemented, awaiting architect review** (2026-10-03)

## Central configuration — `src/lib/domain/shoots.ts`

Shoot statuses (SCHEDULED, IN_PROGRESS, PARTIALLY_COMPLETED, COMPLETED, CANCELLED) with labels
and tones · `ACTIVE_SHOOT_STATUSES` (= editable) · crew statuses (ASSIGNED, IN_PROGRESS,
COMPLETED, CANCELLED) · `SHOOT_CREW_ROLES` (brand roles that may be crew) · `routeHasShoot` /
`shootStepIndex` (driven by `PRODUCTION_ROUTE_DEFS`) · **`evaluateShootProgress(crew)`**, the
only place the completion rule is written · `crewNextAction(shootStatus, myStatus)`, which
drives the My Day buttons.

## Collection — `shoots`

One document per shoot. Brand-owned and agency-scoped. Fields:

- **Schedule:** `date` (agency calendar day) + `startTime`/`endTime` (wall clock), plus derived
  UTC `startAt`/`endAt` (used for overlap checks) and the `timezone` they were computed in.
- **Content and crew:** `location {name, address}`, `notes`, `contentIds[]` (the source of
  truth for shoot ↔ content), embedded `crew[]`.
- **History:** `rescheduleHistory[]`, `revision`.
- **Lifecycle stamps:** `startedAt/By`, `partiallyCompletedAt`, `completedAt`,
  `cancelledAt/By` + `cancellationReason`, `createdBy`.

Embedded crew entry fields: `userId`, `brandRole`, `status`, `required`, `assignedAt/By`,
`startedAt`, `completedAt`/`completedBy` (≠ userId when a manager marks it on someone's
behalf), `cancelledAt`, and `notes`.

`contents.activeShootId` is a **lock**: content can be on at most one active shoot. It is set
and cleared conditionally inside the same transaction as the change to `Shoot.contentIds`.

Indexes: `{agencyId,startAt}`, `{agencyId,brandId,startAt}`, `{agencyId,status,startAt}`,
`{agencyId,"crew.userId",startAt}`, `{agencyId,contentIds}`. (`contents.activeShootId` needs no index: lock updates filter by `_id`.)

## Rules

- **Lifecycle:**
  - Start is done by the crew or a manager. It moves PLANNED content to IN_PRODUCTION; crew
    who start later start only their own part.
  - When every required crew member is done, the shoot becomes COMPLETED automatically. If
    some are done, it is PARTIALLY_COMPLETED.
  - A manager can "mark done on behalf" only with a reason, which is audited. There is no
    force-complete.
  - Cancel requires a reason and keeps the content, tasks and crew history. It frees the
    content lock.
  - Reschedule is allowed only while SCHEDULED. It updates the same document and appends to
    `rescheduleHistory`.
- **Task integration:**
  - No shoot task exists. Route tasks after the SHOOT step are created BLOCKED with
    `waitingOn: "SHOOT"`.
  - Completing the shoot unblocks them, creating a missing next task if needed, with an audit
    entry for each.
  - Content is never approved, posted or completed by a shoot.
- **Conflicts:**
  - Overlap means the same user is on two **active** shoots whose time intervals intersect.
    Touching intervals do not count. The check works across brands and runs on create, add
    crew and reschedule.
  - When a conflict is found, the result is `CONFLICT` with `{conflicts}`. Only managers can
    override, and only with a reason. One `shoot.conflict_override` entry is written per
    conflict.
  - The board and detail pages show only active ↔ active overlaps.
- **Visibility:**
  - Ops (ADMIN/MANAGER) see every shoot in the agency.
  - STAFF see a shoot only if they have a non-cancelled crew entry on it **and** the brand is
    visible to them. Brand membership alone (including BRAND_MANAGER) grants nothing.
  - CLIENT sees no shoots.
  - Out-of-scope requests return 404.
- **Audit:** every mutation and its ActivityLog entry are written in one transaction. Actions:
  `shoot.created`, `updated`, `rescheduled`, `started`, `crew_assigned`, `crew_removed`,
  `crew_started`, `crew_completed`, `partially_completed`, `completed`, `cancelled`,
  `conflict_override`, `content_added`, `content_removed`.

## UI

- `/admin/production`: board grouped by day, with day/week views and filters for brand,
  status, crew and conflicts. Dense grid at `lg` and above; timeline cards below that, with
  filters in a bottom sheet.
- `/admin/shoots`: upcoming and past shoots. `/admin/shoots/new`: create form with the
  conflict override flow. `/admin/brands/[id]/shoots`: the brand's shoots.
- `/admin/shoots/[id]`: header actions (start, edit, reschedule, cancel), conflicts, the
  content and crew panels, and history.
- `/work` (My Day): a date selector (`?date=`) and the actor's crew shoots for that day, each
  showing time, brand, role, content, location, statuses and a next-action button.
- `/work/shoots/[id]`: the crew view. Shows what to shoot (content links only where Stage 3
  content scope allows), references, notes and co-crew names and roles.
- Admin content detail lists the item's shoots. A task waiting on a shoot shows a "Waiting on
  shoot" badge to non-managers.

## Changes to earlier stages

- Stage 3 route tasks after a SHOOT step now start BLOCKED and wait for the shoot. Two Stage 3
  tests were updated.
- `defineScopedRepository.updateById` accepts `arrayFilters`.
- `ActionResult` errors carry optional `details`.
- `seed:demo` adds three demo shoots, including one deliberate audited overlap.
