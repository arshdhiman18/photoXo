# Stage 6 — Posting & uploader workflow (implementation record)

Status: **implemented, awaiting architect review** (2026-10-03)

## Lifecycle — `src/lib/domain/postings.ts`

**Per platform:** pending → POSTING → POSTED.
- "Pending" means no live record exists yet.
- POSTING is optional: the uploader may tap Start first. It claims nothing.
- POSTED requires an explicit confirmation with a URL and a time.

**Content:** READY_TO_POST → POSTED → COMPLETED, using `POSTING_TRANSITIONS`.
- This happens only when every required platform is POSTED for the client-approved
  version.
- Both moves happen in the same transaction (`content.posted` and `content.completed` are
  both audited).
- A partially posted item stays READY_TO_POST and shows its progress (e.g. 1/3).
- No other path reaches POSTED or COMPLETED: `canTransition` refuses both, and approvals
  never reach them.

**Changes after approval:** `APPROVAL_TRANSITIONS.REOPEN_FOR_CHANGES` moves READY_TO_POST →
CHANGES_REQUESTED.
- ADMIN or MANAGER only, reason required, and only while no platform is POSTED.
- It is recorded as an INTERNAL "changes requested" decision on the approved version, so
  that version can't be resubmitted and a new version must pass both gates again.
- Platforms that were started but not confirmed become CANCELLED and stay in history.

## Data

**`postings`** (new). One record per approved version and platform. Fields:
- `agencyId`, `brandId`, `contentId`, `contentVersionId`, `versionNumber`, `platform`
- `status` (POSTING, POSTED or CANCELLED) and `live`
- `postUrl` (normalised), `postedAt`, `screenshotAssetId` (an Asset of kind POSTING_PROOF,
  an external link today), `note`
- `postedBy` (the effective uploader) and `recordedBy` (who actually recorded it)
- `source` (UPLOADER or RECORDED_BY_ADMIN) and `adminReason`
- `startedBy/At`, `confirmedAt`
- `corrections[]`, each holding the previous values, reason, who and when
- `cancelledAt/By`, `cancelReason`, timestamps

Records are never deleted (schema hooks refuse delete operations). The only writes are
insert, the conditional confirm, correction and cancellation, all inside service
transactions.

**`contents`** gains `targetPlatforms[]`, `postedAt` and `completedAt`.
- `targetPlatforms` is the single source of truth for where content must be posted. ADMIN or
  MANAGER set it, on the brief or through the "Post to" control.
- It is required before internal approval.
- It can't be emptied after internal approval, and it is locked once posting starts.
- Documents created before Stage 6 have no field; they are read as `[]` via
  `targetPlatformsOf()`.

## Uploader resolution — `resolveEffectiveUploader`

The rule: use `content.uploaderOverrideId`; if there is none, use `brand.primaryUploaderId`.
The person must be an ACTIVE account in the same agency with an ACTIVE UPLOADER membership
on the brand.

If they aren't, the content is flagged as NO_UPLOADER, INACTIVE_ACCOUNT or NOT_AN_UPLOADER.
It is never re-routed automatically. ADMIN or MANAGER fix it through the existing override
(a backup uploader) or the brand primary.

## Posting checks (every command)

1. Content scope (404 otherwise).
2. The brand is ACTIVE.
3. The content isn't archived.
4. Status is READY_TO_POST.
5. `clientApprovedVersionId` equals `internalApprovedVersionId`, and equals the submitted
   `versionId`.
6. The version belongs to the content.
7. Both approval records still exist.
8. The platform is one of the target platforms.
9. The actor is the effective, valid uploader. The ADMIN on-behalf path checks
   `canRecordPostingOnBehalf` instead.

Other rules:
- Post URLs are host-checked per platform (OTHER accepts any https link) and normalised.
  `postedAt` can't be in the future.
- Each transaction first "touches" the content row, so concurrent confirmations on the same
  content serialise.

## Permissions

| | ADMIN | MANAGER | Assigned uploader | Other staff | CLIENT |
|---|---|---|---|---|---|
| View queues and posting records | ✓ | ✓ | own queue; records for brands where they are UPLOADER | — | confirmed posts on own brands (platform, URL, date only) |
| Start or confirm a platform | — | — | ✓ | — | — |
| Record on the uploader's behalf (reason required) | ✓ | — | — | — | — |
| Correct a post (reason required, history kept) | ✓ | — | — | — | — |
| Set target platforms | ✓ | ✓ | — | — | — |
| Send approved content back for changes | ✓ | ✓ | — | — | — |

## UI

- `/work/to-post`: the uploader's queue, plus a "Posted by me" tab.
- `/work/to-post/[id]`: the approved version (links, caption and hashtags, Copy caption) and
  one card per platform (Start, Mark posted).
- `/admin/ready-to-post`: tabs for Ready, Needs attention (uploader problems or missing
  platforms) and Posted (history, including corrections).
- Admin content detail gets a **Posting** section (per-platform state, record on behalf,
  correct, send back for changes) and a **Post to** control.
- The brief form gains a "Post to" picker.
- The client review page shows a **Live on** list.

## Changes to earlier stages

- Internal approval now requires `targetPlatforms`. The client sees a neutral message if
  legacy content without platforms reaches them.
- The Stage 5 approval tests set platforms on their fixtures.
- Asset `kind` gains POSTING_PROOF.
- The content index `{agencyId, uploaderOverrideId}` is replaced by
  `{agencyId, uploaderOverrideId, status}` (partial). **Existing databases:** drop
  `agencyId_1_uploaderOverrideId_1` manually; `createIndexes` does not drop indexes.
- Grid lists use `grid-cols-1`. This fixes a clipped-overflow bug with long truncating
  subtitles in the posting queue and both client lists.
