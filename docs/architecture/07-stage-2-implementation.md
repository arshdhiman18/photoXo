# Stage 2 — Brands & brand memberships (implementation record)

Status: **implemented, awaiting architect review** (2026-10-03)

## Model

- `brands` — `agencyId, name, nameKey (normalised, unique per agency), slug (unique per
  agency, stable), description, logo {url}, status ACTIVE|ARCHIVED, socialHandles[]
  {platform, url, handle, label}, primaryUploaderId, archivedAt, createdBy`.
- `brandMemberships` — one row per **(agency, brand, user, brand role)**; `status
  ACTIVE|INACTIVE`, `addedBy, activatedAt, deactivatedAt, deactivatedBy`. Never deleted.

## Rules

- **System role ≠ brand role.** Compatibility table in `src/lib/domain/brands.ts`:
  CLIENT↔CLIENT only; BRAND_MANAGER ← STAFF/MANAGER/ADMIN; production + UPLOADER ←
  STAFF/MANAGER. A system-role change that would break an active brand role is refused.
- **Primary uploader** — `Brand.primaryUploaderId`; must hold an ACTIVE UPLOADER membership.
  First uploader becomes primary automatically; removing/re-roling the primary clears it.
- **Visibility** (`brandVisibility`, membership-based, fresh per request):
  ADMIN/MANAGER all agency brands; STAFF active internal memberships; CLIENT active CLIENT
  memberships only. Membership listing: STAFF see active internal rows on their brands
  (coworkers), CLIENT only their own rows.
- **Archived brands** are read-only for team changes and hidden from default lists and
  "My brands".
- **Atomicity** — every brand/membership/user-state mutation and its ActivityLog entry run
  in one MongoDB transaction (`withTransaction` + Mongoose `transactionAsyncLocalStorage`).
- **Permission before validation** — `authedAction(schema, handler, { authorize })`.

## Indexes

brands: `{agencyId, slug}` unique · `{agencyId, nameKey}` unique · `{agencyId, status, name}`
brandMemberships: `{agencyId, brandId, userId, role}` unique · `{agencyId, userId, status, role}`
· `{agencyId, brandId, status, role}`
