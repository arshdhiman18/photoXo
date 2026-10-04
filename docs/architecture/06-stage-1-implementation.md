# Stage 1 — Implementation record

Status: **implemented, awaiting architect review** (2026-10-03)

## Pinned stack

next 16.3.8 · react 19.2.8 · typescript 5.9.3 · better-auth 1.7.7 · mongoose 9.10.4 ·
mongodb 7.6.0 (single driver shared by Mongoose and Better Auth) · zod 4.6.5 ·
tailwindcss 4.3.3 · shadcn (radix-nova) · vitest 4.1.11 · mongodb-memory-server 11.3.0 ·
eslint 9.39.5. All versions exact (`.npmrc save-exact=true`).

TypeScript 7 / ESLint 10 / Vitest 5 exist but were not adopted: `create-next-app@16.3.8`
pins TS 5 / ESLint 9 and the Next/typescript-eslint toolchain is validated against them.

## Changes vs. Stage 0 design

| Area             | Stage 0                        | Stage 1                                                              | Why                                           |
| ---------------- | ------------------------------ | -------------------------------------------------------------------- | --------------------------------------------- |
| User status      | INVITED / ACTIVE / DEACTIVATED | + **SUSPENDED**                                                      | Temporary block vs. person left               |
| Invitations      | Better Auth verification table | Own `invitations` collection (hashed token, single-use, revocable)   | Admin-driven onboarding, resend/revoke, audit |
| Admin creation   | CLI                            | CLI only; UI can never assign ADMIN                                  | Controlled privileged-account creation        |
| Agency           | collection planned             | `agencies` + one-time `system.bootstrap` marker                      | Prevents a second "first admin"               |
| Middleware       | `middleware.ts`                | `src/proxy.ts` (Next 16 rename), optimistic only                     | Not a security boundary                       |
| Brand visibility | design                         | `brandVisibility()` primitive, fail-closed until Stage 2 memberships | Repositories can adopt it immediately         |

## Security model (summary)

1. **Identity** — Better Auth DB sessions (30-day rolling, cookie cache disabled). The
   Actor is built from the session + a fresh `users` read on every request, so role changes
   and suspensions take effect on the next request.
2. **No self-registration** — `disableSignUp`, Google `disableImplicitSignUp`, and a
   `databaseHooks.user.create.before` that rejects any user creation through Better Auth.
3. **Sessions only for ACTIVE users** — `databaseHooks.session.create.before`.
4. **Authorization fields are invisible to Better Auth** — role/status/agencyId are not
   registered as Better Auth fields, so `/update-user` cannot write them (tested).
5. **Server Actions** — only via `authedAction(schema, handler)`: actor from session →
   `.strict()` Zod parse (unknown keys like `userId`/`role`/`agencyId` rejected) → service.
6. **Data access** — `defineScopedRepository` combines `{agencyId} ∧ visibility(actor) ∧
callerFilter` with `$and`; caller filters can only narrow. Out-of-scope ids → 404.
   ESLint forbids importing models/drivers outside the data layer.
7. **Workspace gates** — each layout _and_ page calls `requireWorkspaceActor()`.
8. **Audit** — `activityLogs` append-only entries for bootstrap, invite, resend, revoke,
   activate, suspend, reactivate, deactivate, role change, profile update.
9. **Headers** — X-Frame-Options DENY, nosniff, Referrer-Policy (no-referrer on token pages),
   Permissions-Policy, HSTS in production, no X-Powered-By. Dev Server Function argument
   logging disabled (it printed passwords).

## Test suite

`tests/unit` — permission matrix, workspace mapping, admin rules, env validation, token
generation, Cloudinary signature (documented vector), input schemas.

`tests/integration` (real in-memory replica set, real Better Auth HTTP handler, real session
cookies) — bootstrap & re-run refusal, sign-up disabled, login/logout, forged cookies,
invite → accept → login, single-use & resend-revokes links, suspension revokes live sessions,
DB status honoured for existing cookies, workspace matrix (12 cases), manager boundaries,
staff/client admin-action denial, role escalation (5 vectors), IDOR on user ids, session
identity, cross-agency isolation, brand-scoped visibility & filter-injection resistance.
