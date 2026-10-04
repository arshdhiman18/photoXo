# PhotoXo — Open Decisions & Risks

Status: **V1 final — as built (Stage 8, 2026-10-04).** This began as the Stage 0 proposal.
Where the build differs, the "As built" notes below take precedence; the per-stage records
(06–13) have the details.

Each decision lists the Stage 0 recommendation. Resolutions as built: D-1/D-2 Better Auth,
invite-only, optional Google for invited users. D-3 scoped staff visibility. D-4 internal approval
by ADMIN/MANAGER only. D-5 authenticated Cloudinary assets + signed URLs (not production-verified).
D-6 POSTED/COMPLETED per platform with append-only postings. D-7 no completion without posting
records. D-8 admin may record a client decision with a note. D-9 caption on the version.
D-10 one version = ordered assets/links. D-11 conflicts warn and need a reason. D-12 many-to-many
memberships. D-13 two system roles. D-14 no websockets; unread-count polling. D-15 PWA not built.
D-16/D-17 as proposed.

## Decisions

| ID     | Decision                                                                    | Recommendation                                                                                                                   | Why it matters                                                                           |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D-1 ⚠️ | Auth library                                                                | **Better Auth** with DB sessions, invite-only                                                                                    | Instant revocation, self-hosted, Mongo adapter                                           |
| D-2 ⚠️ | Login methods                                                               | Email + password via invite; optional Google OAuth linked only to existing users                                                 | Affects Stage 1 invite/email work                                                        |
| D-3    | Staff content visibility                                                    | Scoped to _assigned_ work (tasks, shoots, created, uploader queue) + full brand view only for BRAND_MANAGER                      | "Employees should not see entire company data"; brand-wide visibility is the alternative |
| D-4    | Can a staff BRAND_MANAGER give internal approval?                           | V1: only ADMIN/MANAGER system roles; revisit                                                                                     | Spec says "Manager approval"; brand has a "Manager"                                      |
| D-5    | Media privacy level                                                         | Authenticated Cloudinary assets + signed URLs + random IDs. Expiring token URLs need a Cloudinary plan feature — confirm plan    | Unapproved client content / receipts are sensitive                                       |
| D-6    | POSTED vs COMPLETED                                                         | POSTED = ≥1 target platform posted; COMPLETED = all target platforms posted (single-platform content goes straight to COMPLETED) | Spec lists both states                                                                   |
| D-7    | Admin override to complete without posting record                           | No. Only via Posting (admin may create a Posting on behalf of uploader, logged)                                                  | "Approval ≠ completion" invariant                                                        |
| D-8    | Can admin approve on behalf of a client (e.g. approval came over WhatsApp)? | Allow as "Recorded on behalf of client" with mandatory note, clearly labelled in history                                         | Very common in agencies; otherwise work blocks                                           |
| D-9    | Caption & hashtags location                                                 | On `ContentVersion` — client approves media **and** caption together; uploader gets the approved caption                         | Avoids posting unapproved copy                                                           |
| D-10   | Version scope                                                               | One version = ordered set of assets (carousel/photo set)                                                                         | A "Product Photo Set" is one content item with many files                                |
| D-11   | Shoot conflicts                                                             | Warn + require reason to override; never silently block                                                                          | Real schedules have deliberate overlaps                                                  |
| D-12   | Client user ↔ brand cardinality                                             | Many-to-many via memberships (usually one)                                                                                       | Same client company may own multiple brands                                              |
| D-13   | ADMIN vs MANAGER split                                                      | Two system roles; MANAGER = all ops, no user-role/settings admin                                                                 | Spec lists "Admin / Manager" as one; split is cheap now                                  |
| D-14   | Realtime                                                                    | No websockets in V1; navigation refresh + 30–60s unread-count poll                                                               | Vercel serverless; keeps infra simple                                                    |
| D-15   | PWA                                                                         | Installable PWA manifest for staff (home-screen icon, no offline sync in V1)                                                     | Field staff on phones                                                                    |
| D-16   | ProductionTask, ContentVersion, ActivityLog, Counter, EmailOutbox           | Added beyond the spec's entity list                                                                                              | Needed for routes, carousels, audit, codes, email reliability                            |
| D-17   | ShootContent/ShootCrew                                                      | Embedded arrays in `shoots`, not separate collections                                                                            | Bounded, read together, atomic updates                                                   |

## Risks

| Risk                                                   | Mitigation                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Authorization leak through a forgotten scope           | Single service layer, `scope.*` builders, 404-on-miss, DTO allow-lists, cross-tenant integration test suite required per stage |
| Server Actions treated as "internal"                   | Every action: `requireActor` → Zod → service. Checklist + tests                                                                |
| Large video uploads on mobile networks                 | Direct-to-Cloudinary chunked uploads, retry, never through Vercel                                                              |
| Cloudinary cost (video transcoding / storage)          | Eager transforms limited to one preview rendition; retention cron; monitor usage                                               |
| Instagram embeds failing (private posts, API changes)  | Official embed script only, always a fallback "Open original" card                                                             |
| Timezone bugs in My Day / daily totals                 | UTC storage, agency timezone helpers in one module, tests around midnight boundaries                                           |
| MongoDB transactions require replica set               | Atlas in all envs; mongodb-memory-server in replset mode for tests                                                             |
| Denormalized `approvalState` drifting from `approvals` | Written only inside workflow transitions in the same transaction                                                               |
| Scope creep (reports, campaigns, profitability)        | Fields reserved, features deferred until explicitly staged                                                                     |

## Prerequisites needed from the business before/at Stage 1

- MongoDB Atlas cluster (or permission to create one) + connection string.
- Cloudinary account (cloud name, API key/secret, plan tier — affects D-5).
- Resend (or other) API key + sending domain for invite emails.
- First admin's name/email (bootstrap via a one-off `scripts/create-admin.ts`, not a public signup).
- Confirmation of agency timezone & currency (assumed Asia/Kolkata, INR).

## Delivered stages (V1 complete)

1. **Stage 1:** foundation, auth, actor, user management, shells.
2. **Stage 2:** brands and memberships.
3. **Stage 3:** content, ideas, references, production routes and tasks.
4. **Stage 4:** shoots, crew, conflicts, My Day, production board.
5. **Stage 5:** versions, internal and client approvals, client portal.
6. **Stage 6:** Ready to Post, posting, completion, archive.
7. **Stage 7:** notifications (in-app and email) and reminders.
8. **Stage 8:** final production completion:
   - expenses;
   - post-publication revisions;
   - Cloudinary uploads;
   - activity timeline;
   - notification retention;
   - dashboard;
   - hardening, demo data and docs.

Deferred by decision (not part of V1):

- email digest;
- automatic media deletion (retention is a dry-run plan);
- reports;
- campaigns;
- Playwright end-to-end suite;
- PWA.
