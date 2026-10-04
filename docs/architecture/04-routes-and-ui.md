# PhotoXo — Routes, Folder Structure & UI System

Status: **V1 final — as built (Stage 8, 2026-10-04).** This began as the Stage 0 proposal.
Where the build differs, the "As built" notes below take precedence; the per-stage records
(06–13) have the details.

As built, the folder layout is `src/app`, `src/components/{ui,shell,common}`,
`src/features/<module>/{actions,schemas,types,components}`, `src/lib/{domain,…}` and
`src/server/{auth,authz,activity,db,dto,media,notifications,repositories,services}`. Section 2
below is the original sketch.

## 1. Route map (as built, V1)

Three persona workspaces with separate layouts. Each layout requires an actor of the right
workspace; every page and Server Action re-authorizes in the service layer.

### Public / auth

| Route                                 | Purpose                                          |
| ------------------------------------- | ------------------------------------------------ |
| `/login`                              | Email + password (optional Google, invited only) |
| `/invite/[token]`                     | Accept invite, set password                      |
| `/forgot-password`, `/reset-password` | Reset flow                                       |
| `/`                                   | Redirects by role → `/admin`, `/work`, `/client` |
| `/forbidden`                          | Wrong workspace                                  |

### Admin workspace — `/admin` (ADMIN, MANAGER)

| Route                                         | Purpose                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `/admin`                                      | Dashboard: needs attention, pipeline counts, today's shoots          |
| `/admin/content`, `/admin/content/[id]`       | Content list + filters; detail (versions, review, posting, activity) |
| `/admin/approvals`                            | Internal review, with client, changes requested                      |
| `/admin/ready-to-post`                        | Posting oversight (uploader / platform problems, history)            |
| `/admin/production`                           | Production board                                                     |
| `/admin/shoots`, `/admin/shoots/new`, `/[id]` | Shoots, crew, conflicts                                              |
| `/admin/expenses`, `/admin/expenses/[id]`     | Expense ledger with filters and totals; approve / reject             |
| `/admin/brands`, `/admin/brands/[id]/…`       | Brand overview, team, content, shoots, approvals, expenses           |
| `/admin/team`                                 | Users, roles, invites (ADMIN for role/account changes)               |
| `/admin/inbox`                                | Notifications                                                        |
| `/admin/settings`                             | Agency, reminder and retention settings (ADMIN)                      |

### Staff workspace — `/work` (STAFF; ADMIN/MANAGER may open it for their own work)

| Route                                           | Purpose                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| `/work`                                         | My Day: today's shoots, review & changes, tasks      |
| `/work/tasks`                                   | My production tasks                                  |
| `/work/content`, `/work/content/[id]`           | Scoped content; add version (links / uploads), ideas |
| `/work/shoots`, `/work/shoots/[id]`             | My crew shoots (upcoming / past); shoot day          |
| `/work/to-post`, `/work/to-post/[id]`           | Uploader queue; confirm posts per platform           |
| `/work/expenses`, `/new`, `/[id]`, `/[id]/edit` | My expenses: draft, submit, withdraw, resubmit       |
| `/work/brands`, `/work/brands/[id]`             | Brands I work on                                     |
| `/work/inbox`                                   | Notifications                                        |

### Client workspace — `/client` (CLIENT)

| Route                                     | Purpose                                                           |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `/client`, `/client/approvals`            | Awaiting your approval                                            |
| `/client/content`, `/client/content/[id]` | Viewer: media, caption, approve / request changes, history, posts |
| `/client/library`                         | Approved / posted creations                                       |
| `/client/notifications`                   | Notifications                                                     |

### Route handlers (`/api`)

| Route                | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `/api/auth/[...all]` | Better Auth                                                            |
| `/api/jobs/tick`     | Reminders, email outbox, notification retention (`Bearer CRON_SECRET`) |

Everything else (including upload signing and finalization) is a Server Action in
`src/features/*/actions.ts`.

## 2. Folder structure

```
photoxo/
├─ docs/architecture/                 # these documents + ADRs
├─ scripts/
│  └─ seed.ts                         # DEMO data, clearly labelled, never runs in production
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login, invite/[token], forgot-password, reset-password/[token]
│  │  ├─ admin/                       # layout.tsx = admin shell + role gate
│  │  ├─ work/                        # layout.tsx = staff shell (bottom nav on mobile)
│  │  ├─ client/                      # layout.tsx = client shell
│  │  ├─ api/
│  │  ├─ layout.tsx, globals.css, not-found.tsx, error.tsx
│  │  └─ page.tsx                     # role redirect
│  ├─ components/
│  │  ├─ ui/                          # shadcn primitives (owned)
│  │  ├─ shell/                       # Sidebar, BottomNav, TopBar, PageHeader, MobileSheet
│  │  └─ common/                      # StatusBadge, EmptyState, DataTable(+card mode), UserChip,
│  │                                  # BrandChip, MediaPreview, Money, RelativeTime, FileDrop
│  ├─ features/                       # one folder per module
│  │  ├─ brands/   { components/, actions.ts, queries.ts, schemas.ts }
│  │  ├─ content/  …
│  │  ├─ shoots/   …
│  │  ├─ expenses/ …
│  │  └─ …
│  ├─ server/                         # server-only
│  │  ├─ db/ { connect.ts, models/*.ts }
│  │  ├─ auth/ { auth.ts (Better Auth), actor.ts }
│  │  ├─ authz/ { policies.ts, scopes.ts, errors.ts }
│  │  ├─ services/ *.service.ts
│  │  ├─ workflow/ { content.ts, shoot.ts, tasks.ts }
│  │  ├─ dto/ { admin.ts, staff.ts, client.ts }
│  │  ├─ media/ cloudinary.ts
│  │  ├─ notifications/ { notify.ts, recipients.ts, email/ }
│  │  └─ activity.ts
│  ├─ lib/ { env.ts (Zod-validated env), dates.ts, money.ts, ids.ts, utils.ts }
│  └─ types/
├─ tests/ { unit/, integration/, e2e/ }
└─ .env.example
```

## 3. Design system

- **Tokens:** CSS variables on `:root`/`.dark` via Tailwind v4 `@theme` — neutral zinc-based
  surfaces, one brand accent, semantic colors reserved strictly for status
  (info / warning / success / danger / neutral). Status → color mapping is defined once in
  `StatusBadge` and reused everywhere (no ad-hoc colors).
- **Type:** Inter (or Geist) — 13/14px dense table text on admin, 15/16px base on mobile.
- **Density:** admin tables use compact rows (36–40px); mobile cards use 44px+ touch targets.
- **No** gradients, glassmorphism, decorative illustrations or gratuitous animation. Motion
  limited to 150ms transitions for sheets/popovers; respects `prefers-reduced-motion`.
- Every list has designed loading (skeleton matching layout), empty and error states.
- Dark mode supported from the token level (cheap now, expensive later); light is default.
- Accessibility: Radix primitives, visible focus rings, labelled icon buttons, color is never the
  only status signal (badge text + icon).

## 4. Responsive layouts per workspace

| Breakpoint | Admin shell                                                                                                                          | Staff shell                                                                                                                                                        | Client shell                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| ≥1280      | Full sidebar (240px), multi-column dashboard, full tables                                                                            | Sidebar + 2-column (My Day timeline + side panel)                                                                                                                  | Centered 960px column                                  |
| 1024       | Sidebar collapses to icon rail; dashboard 2 columns                                                                                  | Sidebar                                                                                                                                                            | Same                                                   |
| 768        | Icon rail; tables keep key columns, others move into row expansion; production board scrolls horizontally _inside its own container_ | Bottom tab bar, single column                                                                                                                                      | Single column                                          |
| 390 / 375  | Drawer nav (sheet); tables → card lists; filters in a bottom sheet                                                                   | Bottom tab bar with center **+** (Add Expense / Add Idea / Upload); bottom sheets for forms; sticky primary action ("Start shoot", "Mark complete") at thumb reach | Full-width media, sticky Approve / Request changes bar |

Mobile specifics: `<input type="file" accept="image/*,video/*" capture>` for shoot uploads and
receipts; resumable chunked upload with progress and background-safe retry; tap-to-load embeds;
`tel:` and Maps links for shoot locations; safe-area insets for bottom bars.
