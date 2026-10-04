# Stage 5 — Internal review & client approvals (implementation record)

Status: **implemented, awaiting architect review** (2026-10-03)

## State machine — `src/lib/domain/approvals.ts`

Approval moves are kept separate from the general content transitions.

- `CONTENT_TRANSITIONS` (renamed from `STAGE3_TRANSITIONS`) holds planning, production start
  and cancellation only. It can never enter a review status or reach READY_TO_POST.
- `APPROVAL_TRANSITIONS` is the only path into or out of review. Only
  `approvals.service.ts` uses it, and every move happens in the same transaction as the
  submission or approval record that justifies it.

| Event | From | To |
|---|---|---|
| SUBMIT_INTERNAL | IN_PRODUCTION, CHANGES_REQUESTED | INTERNAL_REVIEW |
| INTERNAL_APPROVED | INTERNAL_REVIEW | CLIENT_REVIEW |
| INTERNAL_CHANGES_REQUESTED | INTERNAL_REVIEW | CHANGES_REQUESTED |
| CLIENT_APPROVED | CLIENT_REVIEW | READY_TO_POST |
| CLIENT_CHANGES_REQUESTED | CLIENT_REVIEW | CHANGES_REQUESTED |

Other rules:

- Cancelling is allowed from every review status. Approval never moves content to POSTED or
  COMPLETED.
- The route REVIEW step now declares `gates: ["INTERNAL", "CLIENT"]`, read through
  `routeReviewGates`. The service refuses any gate the route doesn't declare.

## Data

**`approvals`** (new, append-only). Schema hooks refuse every update, replace, delete and
re-save. Each record holds:

- `agencyId`, `brandId`, `contentId`
- `contentVersionId` and `versionNumber`
- `stage` (INTERNAL or CLIENT), `decision` (APPROVED or CHANGES_REQUESTED)
- `comment` and `commentVisibility` (INTERNAL or CLIENT, fixed when the record is written)
- `source` (REVIEWER, CLIENT_USER or RECORDED_BY_ADMIN)
- `decidedBy`, `decidedAt`

Approval indexes:

- `{agencyId, contentId, decidedAt}`
- `{agencyId, contentVersionId, stage}`
- `{agencyId, brandId, decidedAt}`
- `{agencyId, stage, decision, decidedAt}`

**`contents`** gains these fields:

- `reviewSubmission {versionId, versionNumber, submittedBy, submittedAt}`: which version is
  under review. The server checks the browser's version ID against it.
- `internalApprovedVersionId`, `clientApprovedVersionId`: both cleared on every new
  submission.
- `changesRequestedBy`: now an object `{stage, source, approvalId, versionId, versionNumber,
  comment, decidedBy, decidedAt}`. Previously it was a reserved string.
- `clientChangesPending`: true while the team works on changes the client asked for.
- `readyToPostAt`.

New content indexes: `{agencyId, status, statusChangedAt}` and
`{agencyId, brandId, status, statusChangedAt}`, used by the review queues and the client
inbox.

## Rules

**Submit for internal review**
- Who can submit: a manager, or the assignee of a version-producing task. This is the same
  rule that governs adding versions.
- What can be submitted: the content's **current** version, only if it has never been
  reviewed before.
- When: while the content is IN_PRODUCTION or CHANGES_REQUESTED.
- No new versions can be added while content is in review (existing Stage 3 rule), so the
  version under review can't be swapped out.

**Each decision** checks, in order:
1. Scope (otherwise 404).
2. The route has the gate.
3. The content's status matches the gate.
4. The submitted version ID equals `reviewSubmission.versionId` (a stale or foreign version
   is refused with CONFLICT).
5. The version belongs to this content, agency and brand.
6. For the client gate: the version passed the internal gate.
7. The version hasn't already been decided at this gate.

The content update is also conditional on status and version, so concurrent decisions roll
back.

**Changes requested** requires a comment. No version is created automatically.

**Client changes** are visible to the client as "Changes in progress" (through
`clientChangesPending`) while the revision is in CHANGES_REQUESTED or INTERNAL_REVIEW.

**Admin recording a client approval** (ADMIN only):
- The note is mandatory.
- `decidedBy` is the admin, `source` is RECORDED_BY_ADMIN, and the note is stored as an
  INTERNAL comment.
- The client sees "Your agency team (recorded on your behalf)" without the note.

**Client view** is built from allow-list serializers (`server/dto/approvals.ts`):
- The client sees only versions that passed the internal gate.
- History contains CLIENT-gate decisions only, and only CLIENT-visible comments.
- No staff names appear.

## Permissions

| | ADMIN | MANAGER | STAFF | CLIENT |
|---|---|---|---|---|
| Submit for internal review | ✓ | ✓ | assigned creator only | — |
| Decide the internal gate | ✓ | ✓ | — | — |
| Decide the client gate | — | — | — | ✓ own brands, CLIENT_REVIEW only |
| Record a client approval on the client's behalf | ✓ (note required) | — | — | — |
| Review queues and recent decisions | ✓ | ✓ | — | — |
| Approval history | full | full | full, for content they can see | own CLIENT-gate history only |

## UI

- `/admin/approvals` and `/admin/brands/[id]/approvals`: tabs for Internal review, With
  client, Changes requested and Recent decisions, oldest-waiting first.
- Admin and staff content pages get a **Review** panel (the exact version, actions, the
  change request) and an **Approval history** section.
- `/client` now redirects to `/client/approvals`, an inbox with Awaiting approval, Changes
  requested and Approved tabs.
- `/client/content/[id]` shows the media links, caption and hashtags, a sticky Approve /
  Request changes bar, and the client's history.
- `/client/library` lists approved content.

## Changes to earlier stages

- `STAGE3_TRANSITIONS` is now `CONTENT_TRANSITIONS`, extended with cancellation from the
  review statuses.
- The client content visibility rule uses `clientChangesPending` instead of the reserved
  string field.
- `toContentClientDTO` uses `clientStatusLabel`.
- The route REVIEW step gains `gates`.
- `seed:demo` adds four demo items, one in each review state.
