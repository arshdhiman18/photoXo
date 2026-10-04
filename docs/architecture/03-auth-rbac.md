# PhotoXo — Authentication & Authorization

Status: **V1 final — as built (Stage 8, 2026-10-04).** This began as the Stage 0 proposal.
Where the build differs, the "As built" notes below take precedence; the per-stage records
(06–13) have the details.

**As built — additions:** expenses (`canSubmitExpenses` for STAFF/MANAGER/ADMIN — staff see
only their own; `canViewAllExpenses` / `canApproveExpenses` for ADMIN/MANAGER; nobody decides
their own expense; clients have no access), `canStartRevision` (ADMIN/MANAGER), uploads
(only people who may add a version to that content, or the expense owner for receipts), and
the content activity timeline (ADMIN/MANAGER only). Sessions of suspended or deactivated
users resolve to no actor. No Playwright suite: authorization is covered by integration tests
calling services and Server Actions directly, including forged identity fields.

## 1. Authentication

**Library: Better Auth** (MongoDB adapter, database-backed sessions).

Why:

- Open-source, self-hosted, data stays in our MongoDB; first-class Mongo adapter.
- Database sessions (not stateless JWT) → deactivating a user or changing their role takes
  effect **immediately** (we revoke their sessions). Important for staff turnover and clients.
- Built-in email/password (secure hashing, rate limiting, CSRF protection), password reset,
  email verification, optional OAuth (Google), optional 2FA for admins later.
- Auth.js is now in maintenance mode and its Credentials provider can't use DB sessions;
  Clerk/Auth0 are viable but add per-user cost and an external user store for an internal tool.

Configuration:

- **Public sign-up disabled.** Accounts exist only because an admin created them.
- **Invite flow:** Admin creates user (name, email, role) → `status: INVITED` → invite email with
  single-use, expiring token → user sets password → `ACTIVE`.
- **Login:** email + password. Optional "Sign in with Google" linked only to an _existing_ user
  with the same verified email (no auto-provisioning). (Decision D-2.)
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`; 30-day rolling for staff, shorter
  configurable for admins.
- Login and reset endpoints rate limited.
- Deactivation: `status = DEACTIVATED` + delete all sessions. `getActor()` rejects non-ACTIVE users
  on every request even if a session somehow survives.

## 2. The Actor

Every server entry point starts with:

```ts
const actor = await requireActor(); // server/auth/actor.ts
// {
//   userId, agencyId, role: "ADMIN"|"MANAGER"|"STAFF"|"CLIENT",
//   brandRoles: Map<brandId, MembershipRole[]>   // active memberships, loaded once per request (React cache)
// }
```

- Built **only** from the verified session cookie → DB lookup. Never from body/query/headers.
- Memoised per request with React `cache()`.
- `requireActor({ roles: [...] })` used by layouts as a first gate; services re-check.

Next.js `proxy`/middleware performs only an optimistic "has session cookie → else redirect to
/login". It is **not** a security boundary (cf. CVE-2025-29927); every layout, Server Action and
Route Handler authorizes independently.

## 3. Two-level role model

### System role (on `users.role`) — what part of the product you can enter

| Role      | Purpose                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADMIN`   | Everything, including users, roles, agency settings                                                                                        |
| `MANAGER` | All operational data & actions (brands, content, shoots, approvals, expenses, reports); **cannot** manage admins, roles or agency settings |
| `STAFF`   | Production employees **and** content uploaders                                                                                             |
| `CLIENT`  | External brand users                                                                                                                       |

### Brand role (on `brandMemberships.role`) — what you do for a given brand

`BRAND_MANAGER, VIDEOGRAPHER, PHOTOGRAPHER, EDITOR, DESIGNER, ASSISTANT, UPLOADER,
OTHER_PRODUCTION, CLIENT`

**Content Uploader is a brand role, not a system role.** Neha is `STAFF` globally and `UPLOADER`
on Mamaearth. That lets one person be a videographer for Adidas and the uploader for
Mamaearth, and lets a brand have several uploaders, with no per-reel assignment.
The "Ready to Post" area appears for any staff user who holds at least one active
`UPLOADER` membership (or is named in a content's `uploaderOverrideIds`).

## 4. Permission matrix (V1)

Legend: ✅ full · 🔸 scoped (see §5) · ❌ none

| Capability                   | ADMIN             | MANAGER                     | STAFF                                  | CLIENT                           |
| ---------------------------- | ----------------- | --------------------------- | -------------------------------------- | -------------------------------- |
| Manage users / roles         | ✅                | 🔸 create STAFF/CLIENT only | ❌                                     | ❌                               |
| Agency settings              | ✅                | ❌                          | ❌                                     | ❌                               |
| Brands & memberships         | ✅                | ✅                          | ❌ (read assigned brands)              | ❌ (read own brand basics)       |
| Create content (brief)       | ✅                | ✅                          | ❌                                     | ❌                               |
| Add idea (TEAM_IDEA)         | ✅                | ✅                          | 🔸 assigned brands                     | ❌                               |
| Approve idea                 | ✅                | ✅                          | ❌                                     | ❌                               |
| Read content                 | ✅                | ✅                          | 🔸                                     | 🔸 client-visible states only    |
| Schedule/edit/cancel shoots  | ✅                | ✅                          | ❌                                     | ❌                               |
| Start / complete shoot       | ✅                | ✅                          | 🔸 crew only                           | ❌                               |
| Upload raw / creation        | ✅                | ✅                          | 🔸 assignee of the active task         | ❌                               |
| Internal approval            | ✅                | ✅                          | ❌ (D-4: BRAND_MANAGER?)               | ❌                               |
| Client approval              | ❌ (D-8)          | ❌                          | ❌                                     | 🔸 own brand, CLIENT_REVIEW only |
| Comments                     | ✅ any visibility | ✅                          | 🔸 INTERNAL/CLIENT on readable content | 🔸 CLIENT only                   |
| Mark as posted               | ✅                | ✅                          | 🔸 resolved uploader                   | ❌                               |
| Submit expense               | ✅                | ✅                          | ✅ (self only)                         | ❌                               |
| Review expenses              | ✅                | ✅                          | ❌                                     | ❌                               |
| See others' expenses         | ✅                | ✅                          | ❌                                     | ❌                               |
| Dashboard / production board | ✅                | ✅                          | ❌ (My Day instead)                    | ❌                               |

## 5. Scope rules (implemented as query builders in `server/authz/scopes.ts`)

All scopes include `{ agencyId: actor.agencyId }`.

**STAFF**

- Brands: brands with an active membership.
- Shoots: `crew.userId = me` (any brand) — plus read-only view of shoots for brands where I'm
  `BRAND_MANAGER`.
- Content: content where I'm a task assignee, OR in a shoot I'm crew on, OR I created it, OR
  I'm a resolved uploader and status ∈ {READY_TO_POST, POSTED, COMPLETED}, OR I'm
  `BRAND_MANAGER` of its brand. (D-3: should all brand members see the brand's full content list?)
- References: those linked to readable content, plus brand library for my brands.
- Tasks: `assigneeIds ∋ me`.
- Expenses: `userId = me`. No exceptions.
- Other users: only name/avatar/brand role of people sharing a shoot or brand with me. No email,
  phone, expenses, workload.

**CLIENT**

- Brands: only brands with an active `CLIENT` membership.
- Content: own brand AND status ∈ {CLIENT_REVIEW, CHANGES_REQUESTED(gate=CLIENT), READY_TO_POST,
  POSTED, COMPLETED}. Never PROPOSED/PLANNED/IN_PRODUCTION/INTERNAL_REVIEW.
- Versions: only versions that passed internal approval.
- Comments: `visibility = CLIENT` only.
- Never returned: internalNotes, tasks, shoots, crew, expenses, internal approvals' comments,
  raw footage, activity log, staff emails. Staff authors are shown as "<First name> · <Agency>".

## 6. Enforcement mechanics

```ts
// server/authz/policies.ts — pure, unit-testable
can(actor, "content.submitVersion", { content, activeTask }) → boolean
// server/authz/scopes.ts
scope.content(actor) → FilterQuery<Content>
// usage inside a service
const content = await Content.findOne({ _id: id, ...scope.content(actor) });
if (!content) throw new NotFoundError();     // 404, not 403 — don't leak existence
assertCan(actor, "content.submitVersion", { content, activeTask });
```

- Server Actions are public HTTP endpoints: every action does `requireActor()` → Zod parse →
  service call. A lint rule / code review checklist enforces that pattern.
- Input IDs are validated as ObjectIds and always combined with scope filters.
- Fields like `userId`, `agencyId`, `uploaderId`, `decidedBy`, `submittedBy` are **always set
  server-side from the actor**, never accepted from input.
- DTO serializers per audience; client DTOs are explicit allow-lists.
- Media URLs signed only after authz.

## 7. Testing authorization

- Unit: policy table tests for every capability × role × relationship.
- Integration (mongodb-memory-server): seeded fixture with two brands, two staff, one client per
  brand; asserts cross-brand / cross-user requests return 404 for every read and mutation.
- E2E (Playwright): proposed; not built in V1 (integration tests call the Server Actions directly with forged inputs instead).
  These tests are part of the Definition of Done for every stage that adds an endpoint.
