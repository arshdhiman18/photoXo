# Stage 3 — Content, ideas, references, routes & tasks (implementation record)

Status: **implemented, awaiting architect review** (2026-10-03)

## Central configuration — `src/lib/domain/content.ts`

Content types (label, default route, media family) · origins · lifecycle statuses, labels,
tones · **Stage 3 transition table** (`STAGE3_TRANSITIONS`) · client-visible statuses and
client wording · priorities · idea decisions · task types with **eligible brand roles** and
"produces version" · task statuses + assignee transitions · **production routes** (ordered
SHOOT / TASK / REVIEW steps) · external asset providers. Reference URL classification lives in
`src/lib/domain/references.ts` (pure, no network).

## Collections

| Collection | Notes |
|---|---|
| `contents` | brand-owned; human `code` (MAM-0142, unique per agency via `counters` + unique brand `codePrefix`); `route`; `referenceIds[]`; `uploaderOverrideId`; `ideaReview`; `versionCount`/`currentVersionId`; reserved `changesRequestedBy` |
| `productionTasks` | single `assignedTo`; `source` ROUTE/MANUAL; `routeStep`; never a Shoot |
| `references` | brand library; platform + url + externalId (+ Instagram variant, YouTube thumbnail); `fileAssetId` reserved for uploads |
| `contentVersions` | immutable (schema hooks refuse update/replace/delete); unique `{agencyId, contentId, versionNumber}` |
| `assets` | EXTERNAL_LINK now (Canva/Figma/Drive/Dropbox/Frame.io); MEDIA shape defined for Cloudinary |
| `counters` | atomic per-brand content sequences |

## Lifecycle implemented in Stage 3

`TEAM_IDEA → PROPOSED → (accept) PLANNED | (reject) REJECTED`, changes-requested keeps
PROPOSED until the author resubmits · briefs start `PLANNED` · `PLANNED → IN_PRODUCTION`
automatically on first task start or first version · `→ CANCELLED` (cancels open tasks) ·
archive only from COMPLETED/REJECTED/CANCELLED. Review/approval/posting transitions are
**refused** until their stages exist.

## Visibility

Content: ops → agency; STAFF → their brands minus other people's unaccepted ideas (creator +
brand managers excepted); CLIENT → their CLIENT brands in client-facing statuses only.
Tasks/references/versions: ops → agency; STAFF → their brands; CLIENT → nothing.

## Fixes made to earlier stages

`scripts/ensure-indexes.ts` now indexes **every exported model** automatically (Stage 2's
brand/membership indexes were missing from the production script).
