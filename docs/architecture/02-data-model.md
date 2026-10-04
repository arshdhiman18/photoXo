# PhotoXo — Data Model (MongoDB)

Status: **V1 final — as built (Stage 8, 2026-10-04).** This began as the Stage 0 proposal.
Where the build differs, the "As built" notes below take precedence; the per-stage records
(06–13) have the details.

**As built — main differences from the proposal below:**

- `expenses`: `userId`, optional `brandId`/`shootId`, `title`, `category`, `amountMinor`
  (integer), `currency`, `incurredOn` (YYYY-MM-DD), receipt link or `receiptAssetId`,
  `status` DRAFT → SUBMITTED → APPROVED | REJECTED (resubmit from REJECTED, withdraw
  SUBMITTED → DRAFT), append-only `reviews[]`, `revision`. Model hooks refuse deletion.
- `uploadIntents`: server-chosen Cloudinary `publicId` (unique), purpose VERSION_MEDIA |
  RECEIPT, declared type/size, single-use `consumedAt`, TTL on unconsumed `expiresAt`.
- `assets`: kinds include MEDIA and RECEIPT (receipts have no brand); `contentId`, `versionId`,
  `expenseId` links; media metadata (`format`, size, dimensions/duration). No `eagerStatus`.
- `contents`: `revisionCount`, `revisions[]` (number, reason, from version, previous status,
  who/when); `changesRequestedBy` may carry `revision` with `approvalId: null`.
- `notifications` / `emailOutbox` / `notificationPreferences`: see the Stage 7 record;
  retention settings live in `agencySettings.reminders.readNotificationRetentionDays`.
- `activityLogs`: extra partial index `{agencyId, meta.contentId, createdAt}` powers the
  per-content activity timeline.

Conventions

- `_id: ObjectId` everywhere. `createdAt` / `updatedAt` via Mongoose timestamps.
- Every tenant-scoped collection has `agencyId: ObjectId` (indexed, first key of compound indexes).
- References between collections are ObjectIds; small, bounded, always-read-together lists are
  embedded (justified per case below).
- Enums are TypeScript `as const` unions shared by Zod and Mongoose.
- Money: `amountMinor: number` (integer paise) + `currency: "INR"`.
- No hard deletes for business records. Soft lifecycle fields (`status`, `archivedAt`, `deactivatedAt`).

---

## Agency

```
agencies
  name, slug (unique), timezone ("Asia/Kolkata"), currency ("INR"), logoAssetId?
```

## AgencySettings (1 per agency — configurable business rules)

```
agencySettings
  agencyId (unique)
  requireIdeaApproval: boolean                 # team ideas → PROPOSED vs PLANNED
  contentTypes: [{ key, label, defaultRoute, active }]   # REEL, PHOTO, GRAPHIC, STORY, CAROUSEL, POST, AD, OTHER
  productionRoutes: [{ key, label, steps: TaskType[] }]
  expenseCategories: [{ key, label, active }]  # PETROL, FOOD, TRAVEL, PROPS, EQUIPMENT_RENTAL, OTHER…
  platforms: [{ key, label, active }]          # INSTAGRAM, YOUTUBE, TIKTOK, FACEBOOK, LINKEDIN, X, PINTEREST…
  mediaRetentionDays: number | null            # null = keep forever
  reminders: { clientApprovalPendingDays: 3, shootCompletionGraceHours: 2, readyToPostStaleHours: 24 }
```

## User

```
users (also the Better Auth "user" collection — auth fields owned by Better Auth)
  agencyId
  name, email (unique, lowercased), image?
  role: "ADMIN" | "MANAGER" | "STAFF" | "CLIENT"       # system role (see 03-auth-rbac)
  status: "INVITED" | "ACTIVE" | "DEACTIVATED"
  jobTitles: string[]          # e.g. ["VIDEOGRAPHER","EDITOR"] — informational defaults for staff
  phone?
  notificationPrefs: { email: { [eventKey]: boolean } }
  lastLoginAt?, deactivatedAt?
  createdAt, updatedAt
indexes: { email: 1 } unique, { agencyId: 1, role: 1, status: 1 }
```

Better Auth also owns `session`, `account` (password hash / OAuth links), `verification`
collections. We do not touch password hashes ourselves.

## Brand

```
brands
  agencyId, name, slug, logoAssetId?
  socialHandles: [{ platform, handle, url }]          # embedded: small, bounded
  status: "ACTIVE" | "PAUSED" | "ARCHIVED"
  codePrefix: "MAM"                                    # human content codes MAM-0142
  defaultTeam?: (derived from memberships — not duplicated)
indexes: { agencyId: 1, slug: 1 } unique
```

## BrandMembership (spec: BrandAssignments + Clients link)

One row per (brand, user, role). Supports **many users per role** and **one user with several
roles** on a brand (e.g. videographer + uploader).

```
brandMemberships
  agencyId, brandId, userId
  role: "BRAND_MANAGER" | "VIDEOGRAPHER" | "PHOTOGRAPHER" | "EDITOR" | "DESIGNER"
      | "ASSISTANT" | "UPLOADER" | "OTHER_PRODUCTION" | "CLIENT"
  isPrimary: boolean            # e.g. primary uploader for notifications ordering
  isDefaultCrew: boolean        # pre-selected when scheduling shoots for this brand
  active: boolean, startedAt, endedAt?
  createdBy
indexes: { agencyId:1, brandId:1, role:1, active:1 }, { agencyId:1, userId:1, active:1 },
         { brandId:1, userId:1, role:1 } unique
```

- **Uploader resolution:** `content.uploaderOverrideIds` if non-empty, otherwise all active
  `UPLOADER` memberships of the brand. Resolved at query time (so changing the brand uploader
  re-routes the existing queue automatically — no per-content assignment).
- Client users: `users.role = CLIENT` **and** `brandMemberships.role = CLIENT` (allows one client
  user to approve for multiple brands of the same client company, if ever needed).

## Campaign (deferred; field reserved)

`content.campaignId?: ObjectId` exists in schema; no collection/UI until requested.

## Content (central entity)

```
contents
  agencyId, brandId, code ("MAM-0142", unique per agency)
  title, type (contentTypes.key)
  origin: "ADMIN_BRIEF" | "REFERENCE" | "TEAM_IDEA"
  brief: string (rich text / markdown)
  internalNotes: string          # NEVER in client DTO
  referenceIds: ObjectId[]       # → references
  productionRoute: route key
  status: "PROPOSED" | "REJECTED" | "PLANNED" | "IN_PRODUCTION" | "INTERNAL_REVIEW"
        | "CLIENT_REVIEW" | "CHANGES_REQUESTED" | "READY_TO_POST" | "POSTED"
        | "COMPLETED" | "CANCELLED"
  changesRequestedGate?: "INTERNAL" | "CLIENT"
  ideaReview?: { decidedBy, decidedAt, decision, note }
  targetPlatforms: platform[]    # completion = every target has a Posting
  plannedPostDate?: Date
  dueDate?: Date
  uploaderOverrideIds: ObjectId[]   # exceptional per-content uploader(s)
  currentVersionId?: ObjectId
  currentVersionNumber: number      # 0 until first submission
  approvalState: {                  # denormalised snapshot for fast queues; source of truth = approvals
    internal: { decision, versionNumber, by, at } | null
    client:   { decision, versionNumber, by, at } | null
  }
  statusChangedAt: Date             # drives "pending for N days" alerts
  readyToPostAt?, postedAt?, completedAt?, archivedAt?, cancelledAt?
  campaignId?
  createdBy
indexes:
  { agencyId:1, brandId:1, status:1, statusChangedAt:-1 }
  { agencyId:1, status:1, statusChangedAt:1 }            # needs-attention scans
  { agencyId:1, code:1 } unique
  text index on title (search)
```

## Reference

Brand-level, so a reference can be reused across content items (brand reference library).

```
references
  agencyId, brandId
  platform: "INSTAGRAM" | "YOUTUBE" | "TIKTOK" | "PINTEREST" | "WEBSITE" | "FILE" | "OTHER"
  url?, externalId?            # IG shortcode, YT video id, TikTok id…
  fileAssetId?                 # when platform = FILE
  title?, notes?
  embed: { provider, html?, thumbnailUrl?, fetchedAt?, status: "OK"|"UNAVAILABLE" }
  addedBy
indexes: { agencyId:1, brandId:1, createdAt:-1 }, { brandId:1, platform:1, externalId:1 }
```

## ProductionTask (added — not in the spec list, required by production routes)

```
productionTasks
  agencyId, brandId, contentId
  type: "SHOOT" | "UPLOAD_RAW" | "EDIT" | "DESIGN" | "UPLOAD_ASSET" | "UPLOAD_CREATION"
  sequence: number
  assigneeIds: ObjectId[]
  shootId?                     # for SHOOT tasks
  status: "BLOCKED" | "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED"
  dueAt?, startedAt?, completedAt?, completedBy?
  notes?
indexes: { agencyId:1, assigneeIds:1, status:1, dueAt:1 }, { contentId:1, sequence:1 }
```

## Shoot (physical production event; ShootContent + ShootCrew embedded)

```
shoots
  agencyId, brandId
  title
  startAt, endAt (UTC)
  location: { name, address?, mapsUrl?, lat?, lng? }
  notes?                       # internal
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  contents: [{ contentId, order, notes? }]              # = ShootContent
  crew: [{ userId, role (membership role), notified: boolean }]  # = ShootCrew
  startedAt?, startedBy?, completedAt?, completedBy?
  cancelledAt?, cancelReason?
  rescheduleHistory: [{ fromStartAt, fromEndAt, at, by, reason? }]
  createdBy
indexes:
  { agencyId:1, startAt:1 }
  { agencyId:1, "crew.userId":1, startAt:1 }            # My Day + conflict detection
  { agencyId:1, brandId:1, startAt:-1 }
  { "contents.contentId":1 }
```

Embedding rationale: crew (≤ ~10) and content list (≤ ~30) are bounded, always read with the
shoot, and edited atomically with it. Multikey indexes cover "my shoots" and "shoots for content".
A content item may appear in several shoots (reshoots).

**Conflict** = same `crew.userId` in two non-cancelled shoots with overlapping `[startAt, endAt)`.
Detected on save (warning, not a hard block — overridable with reason) and listed in Needs Attention.

## ContentVersion (added — one submission may contain many files, e.g. a carousel)

```
contentVersions
  agencyId, brandId, contentId
  versionNumber: 1,2,3…        # unique per content
  assetIds: ObjectId[]          # ordered (carousel order)
  caption?, hashtags: string[], platformNotes?   # approved together with the media
  submittedBy, submittedAt
  changeSummary?               # "what changed since V1"
indexes: { contentId:1, versionNumber:1 } unique
```

Files are never overwritten: a new upload always creates a new version.

## Asset

```
assets
  agencyId, brandId?, ownerType: "CONTENT" | "REFERENCE" | "EXPENSE" | "POSTING" | "BRAND" | "USER"
  ownerId
  kind: "RAW" | "CREATION" | "REFERENCE_FILE" | "RECEIPT" | "POST_SCREENSHOT" | "LOGO" | "AVATAR"
  storage: "CLOUDINARY" | "EXTERNAL_LINK"
  cloudinary?: { publicId, resourceType, type: "authenticated", format, bytes, width?, height?,
                 durationSec?, pages? , eagerStatus: "PENDING"|"READY"|"FAILED" }
  externalUrl?, externalProvider?: "CANVA" | "FIGMA" | "DRIVE" | "OTHER"
  originalFilename, mimeType
  uploadedBy
  mediaPurgedAt?               # retention removed bytes; metadata kept
indexes: { ownerType:1, ownerId:1 }, { agencyId:1, kind:1, createdAt:-1 }
```

## Approval (append-only; never updated or deleted)

```
approvals
  agencyId, brandId, contentId, versionId, versionNumber
  gate: "INTERNAL" | "CLIENT"
  decision: "APPROVED" | "CHANGES_REQUESTED"
  comment?
  decidedBy, decidedAt
indexes: { contentId:1, decidedAt:-1 }
```

## Comment

```
comments
  agencyId, brandId, contentId, versionId?
  parentId?                     # one level of threading
  authorId
  body
  visibility: "INTERNAL" | "CLIENT"     # client authors always CLIENT; staff choose, default INTERNAL
  timecodeSec?                  # reserved for frame-accurate video notes (later)
  editedAt?, deletedAt?         # soft delete shows "comment removed"
indexes: { contentId:1, createdAt:1 }
```

## Posting

```
postings
  agencyId, brandId, contentId, versionId
  platform, postUrl, postedAt (default now, editable), uploaderId
  screenshotAssetId?
  createdAt
indexes: { contentId:1, platform:1 } unique   # one live post per platform per content
```

Correction of a wrong URL = admin edit with ActivityLog entry (no delete).

## Expense

```
expenses
  agencyId, userId (submitter — always from session)
  brandId?, shootId?, contentId?
  amountMinor, currency
  title, description?, category, incurredOn: Date (agency-local date at 00:00 UTC-normalised)
  receiptAssetId?
  status: "SUBMITTED" | "APPROVED" | "REJECTED"        # "REIMBURSED" reserved
  reviewedBy?, reviewedAt?, reviewNote?
indexes: { agencyId:1, userId:1, incurredOn:-1 }, { agencyId:1, status:1, incurredOn:-1 },
         { agencyId:1, brandId:1, incurredOn:-1 }, { agencyId:1, shootId:1 }
```

Submitter may edit/withdraw only while `SUBMITTED`.

## Notification

```
notifications
  agencyId, recipientId, type (event key), title, body?, href,
  entity: { kind, id }, readAt?, createdAt
indexes: { recipientId:1, readAt:1, createdAt:-1 }; TTL on read notifications after 180 days
```

## EmailOutbox

```
emailOutbox
  agencyId, to, template, payload, status: "PENDING"|"SENT"|"FAILED", attempts, lastError?, sendAfter
```

## ActivityLog (added — audit trail for every state change and sensitive admin action)

```
activityLogs
  agencyId, actorId, entity: { kind, id }, brandId?
  action ("content.status_changed", "shoot.rescheduled", "membership.added", "expense.approved" …)
  from?, to?, meta?
  createdAt
indexes: { agencyId:1, "entity.kind":1, "entity.id":1, createdAt:-1 }, { agencyId:1, createdAt:-1 }
```

Client-facing "approval history" is built from `approvals` + client-visible comments, not this log.

## Counter

```
counters  { _id: "<agencyId>:<brandId>:content", seq }   # atomic $inc for human codes
```

---

## Entity relationship summary

```
Agency 1─* User, Brand, Content, Shoot, Expense …
Brand 1─* BrandMembership *─1 User          (staff roles incl. UPLOADER, BRAND_MANAGER, CLIENT)
Brand 1─* Content 1─* ProductionTask
Content *─* Reference (content.referenceIds; references are brand-scoped)
Shoot *─* Content (shoot.contents[]), Shoot *─* User (shoot.crew[])
Content 1─* ContentVersion 1─* Asset
ContentVersion 1─* Approval (gate INTERNAL|CLIENT)
Content 1─* Comment, Content 1─* Posting
Expense *─1 User, ?─1 Brand, ?─1 Shoot, ?─1 Asset(receipt)
```
