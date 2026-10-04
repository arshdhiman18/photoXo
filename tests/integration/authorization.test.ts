import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions read the session from `next/headers`; route it to the
// cookie of whichever test user is "making the request".
vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { SystemRole, UserStatus, Workspace } from "@/lib/domain/roles";
import { updateProfileAction } from "@/features/account/actions";
import {
  changeUserRoleAction,
  deactivateUserAction,
  inviteUserAction,
  reactivateUserAction,
  suspendUserAction,
} from "@/features/team/actions";
import { requireWorkspaceActor } from "@/server/auth/session";
import { disconnectDb } from "@/server/db/connect";
import { AgencyModel, UserModel } from "@/server/db/models";
import { usersRepo } from "@/server/repositories/users.repo";
import { getOwnAccount } from "@/server/services/account.service";
import { listTeam } from "@/server/services/users.service";
import {
  authRequest,
  bootstrapAgency,
  createActiveUser,
  signIn,
  signInActor,
  type TestUser,
} from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, rahul: TestUser, aman: TestUser, client: TestUser;
const cookies: Record<string, string> = {};

/** Make subsequent Server Action calls as `user` (real session cookie). */
const as = (user: TestUser | null) => setRequestCookie(user ? cookies[user.id]! : null);

beforeAll(async () => {
  admin = await bootstrapAgency();
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Maya Manager");
  rahul = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Rahul");
  aman = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Aman");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Client Carla");
  for (const u of [admin, manager, rahul, aman, client]) cookies[u.id] = await signIn(u);
});

beforeEach(() => as(null));
afterAll(async () => {
  await disconnectDb();
});

const roleOf = async (id: string) => (await UserModel.findById(id).lean())?.role;

/** `redirect()` throws a NEXT_REDIRECT error carrying the target in its digest. */
async function workspaceOutcome(user: TestUser | null, ws: Workspace): Promise<string> {
  as(user);
  try {
    await requireWorkspaceActor(ws);
    return "allowed";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    if (digest.includes("/login")) return "login";
    if (digest.includes("/forbidden")) return "forbidden";
    throw error;
  }
}

// ── Workspace (route) access ───────────────────────────────────────────────
describe("workspace access is enforced server-side", () => {
  it.each([
    ["admin", Workspace.ADMIN, "allowed"],
    ["admin", Workspace.WORK, "allowed"],
    ["admin", Workspace.CLIENT, "forbidden"],
    ["manager", Workspace.ADMIN, "allowed"],
    ["manager", Workspace.WORK, "allowed"],
    ["manager", Workspace.CLIENT, "forbidden"],
    ["staff", Workspace.ADMIN, "forbidden"],
    ["staff", Workspace.WORK, "allowed"],
    ["staff", Workspace.CLIENT, "forbidden"],
    ["client", Workspace.ADMIN, "forbidden"],
    ["client", Workspace.WORK, "forbidden"],
    ["client", Workspace.CLIENT, "allowed"],
  ])("%s → /%s is %s", async (who, ws, expected) => {
    const user = { admin, manager, staff: rahul, client }[who]!;
    expect(await workspaceOutcome(user, ws)).toBe(expected);
  });

  it("anonymous requests are sent to login for every workspace", async () => {
    for (const ws of [Workspace.ADMIN, Workspace.WORK, Workspace.CLIENT]) {
      expect(await workspaceOutcome(null, ws)).toBe("login");
    }
  });
});

// ── Manager is operational, not administrative ─────────────────────────────
describe("manager boundaries", () => {
  it("manager cannot invite users", async () => {
    as(manager);
    const res = await inviteUserAction({
      name: "Sneaky",
      email: "sneaky@example.test",
      role: SystemRole.STAFF,
    });
    expect(res).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await UserModel.countDocuments({ email: "sneaky@example.test" })).toBe(0);
  });

  it("manager cannot suspend users or change roles", async () => {
    as(manager);
    expect(await suspendUserAction({ userId: rahul.id })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await changeUserRoleAction({ userId: rahul.id, role: SystemRole.MANAGER }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await roleOf(rahul.id)).toBe(SystemRole.STAFF);
  });

  it("manager cannot open user administration (team list)", async () => {
    const { actor } = await signInActor(manager);
    await expect(listTeam(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── Staff & client cannot reach admin capabilities ─────────────────────────
describe("staff and client cannot use admin actions", () => {
  it.each([
    ["staff", () => rahul],
    ["client", () => client],
  ])("%s cannot invite, suspend, or list the team", async (_label, who) => {
    as(who());
    expect(
      await inviteUserAction({ name: "Xavier", email: "x@example.test", role: SystemRole.STAFF }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await suspendUserAction({ userId: aman.id })).toMatchObject({ ok: false });
    const { actor } = await signInActor(who());
    await expect(listTeam(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await UserModel.findById(aman.id).lean())?.status).toBe(UserStatus.ACTIVE);
  });

  it("anonymous callers are rejected before validation", async () => {
    as(null);
    expect(
      await inviteUserAction({ name: "Anon", email: "anon@example.test", role: SystemRole.STAFF }),
    ).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

// ── Role escalation ────────────────────────────────────────────────────────
describe("role escalation is impossible", () => {
  it("staff cannot set their own role via the profile action (extra keys rejected)", async () => {
    as(rahul);
    const res = await updateProfileAction({ name: "Rahul", role: SystemRole.ADMIN } as never);
    expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await roleOf(rahul.id)).toBe(SystemRole.STAFF);
  });

  it("staff cannot change their own role through the role action", async () => {
    as(rahul);
    const res = await changeUserRoleAction({ userId: rahul.id, role: SystemRole.MANAGER });
    expect(res.ok).toBe(false);
    expect(await roleOf(rahul.id)).toBe(SystemRole.STAFF);
  });

  it("no one can assign ADMIN through the UI actions — not even an admin", async () => {
    as(admin);
    const invite = await inviteUserAction({
      name: "Eve",
      email: "eve@example.test",
      role: SystemRole.ADMIN as never,
    });
    expect(invite).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    const promote = await changeUserRoleAction({
      userId: rahul.id,
      role: SystemRole.ADMIN as never,
    });
    expect(promote).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await roleOf(rahul.id)).toBe(SystemRole.STAFF);
  });

  it("Better Auth's own /update-user endpoint cannot write role, status or agency", async () => {
    const res = await authRequest(
      "/update-user",
      {
        name: "Rahul",
        role: SystemRole.ADMIN,
        status: UserStatus.ACTIVE,
        agencyId: "000000000000000000000000",
      },
      cookies[rahul.id],
    );
    const user = await UserModel.findById(rahul.id).lean();
    expect(user?.role).toBe(SystemRole.STAFF);
    expect(String(user?.agencyId)).toBe(admin.agencyId);
    expect(res.status).toBeLessThan(500);
  });

  it("users cannot change their own agency", async () => {
    as(rahul);
    const res = await updateProfileAction({
      name: "Rahul",
      agencyId: "000000000000000000000000",
    } as never);
    expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(String((await UserModel.findById(rahul.id).lean())?.agencyId)).toBe(admin.agencyId);
  });

  it("admins cannot administer themselves or other admins from the UI", async () => {
    as(admin);
    expect(await suspendUserAction({ userId: admin.id })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await deactivateUserAction({ userId: admin.id })).toMatchObject({ ok: false });
  });
});

// ── User targeting (IDOR) ──────────────────────────────────────────────────
describe("user targeting: request-provided ids never widen access", () => {
  it("profile updates always target the session user, never a supplied id", async () => {
    as(rahul);
    const res = await updateProfileAction({ name: "Rahul Updated", userId: aman.id } as never);
    expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect((await UserModel.findById(aman.id).lean())?.name).toBe("Aman");

    const ok = await updateProfileAction({ name: "Rahul Updated" });
    expect(ok).toMatchObject({ ok: true, data: { id: rahul.id, name: "Rahul Updated" } });
    expect((await UserModel.findById(aman.id).lean())?.name).toBe("Aman");
  });

  it("staff cannot read another employee's record by id (404, not 403)", async () => {
    const { actor } = await signInActor(rahul);
    expect(await usersRepo.findById(actor, aman.id)).toBeNull();
    await expect(usersRepo.getById(actor, aman.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await usersRepo.findById(actor, rahul.id)).not.toBeNull();
  });

  it("staff listing users with someone else's id in the filter gets nothing", async () => {
    const { actor } = await signInActor(rahul);
    const rows = await usersRepo.find(actor, { _id: aman.id });
    expect(rows).toEqual([]);
    const all = await usersRepo.find(actor, {});
    expect(all.map((u) => String(u._id))).toEqual([rahul.id]);
  });

  it("client cannot read internal employees", async () => {
    const { actor } = await signInActor(client);
    expect(await usersRepo.find(actor, {})).toHaveLength(1);
    expect(await usersRepo.findById(actor, admin.id)).toBeNull();
    expect(await usersRepo.findById(actor, rahul.id)).toBeNull();
  });

  it("getOwnAccount returns the session user only", async () => {
    const { actor } = await signInActor(aman);
    expect((await getOwnAccount(actor)).id).toBe(aman.id);
  });
});

// ── Session identity ───────────────────────────────────────────────────────
describe("server uses the authenticated session identity", () => {
  it("the same action resolves to whoever's cookie is presented", async () => {
    as(aman);
    expect(await updateProfileAction({ name: "Aman K" })).toMatchObject({
      ok: true,
      data: { id: aman.id },
    });
    as(rahul);
    expect(await updateProfileAction({ name: "Rahul K" })).toMatchObject({
      ok: true,
      data: { id: rahul.id },
    });
  });

  it("a revoked session cannot call actions", async () => {
    const temp = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Temp");
    cookies[temp.id] = await signIn(temp);
    as(admin);
    expect(await suspendUserAction({ userId: temp.id })).toMatchObject({ ok: true });
    as(temp);
    expect(await updateProfileAction({ name: "Still here?" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    as(admin);
    expect(await reactivateUserAction({ userId: temp.id })).toMatchObject({
      ok: true,
      data: { status: "ACTIVE" },
    });
  });

  it("role changes take effect on the very next request", async () => {
    const promoted = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Promoted");
    cookies[promoted.id] = await signIn(promoted);
    expect(await workspaceOutcome(promoted, Workspace.ADMIN)).toBe("forbidden");
    as(admin);
    expect(
      await changeUserRoleAction({ userId: promoted.id, role: SystemRole.MANAGER }),
    ).toMatchObject({ ok: true });
    expect(await workspaceOutcome(promoted, Workspace.ADMIN)).toBe("allowed");
  });
});

// ── Tenant isolation ───────────────────────────────────────────────────────
describe("agency isolation", () => {
  it("an admin of another agency cannot see or administer this agency's users", async () => {
    const other = await AgencyModel.create({
      name: "Other Agency",
      slug: "other",
      timezone: "UTC",
      currency: "USD",
    });
    const foreignAdmin = await createActiveUser(
      String(other._id),
      SystemRole.ADMIN,
      "Foreign Admin",
    );
    cookies[foreignAdmin.id] = await signIn(foreignAdmin);

    const { actor } = await signInActor(foreignAdmin);
    const team = await listTeam(actor, {});
    expect(team.items.map((u) => u.id)).toEqual([foreignAdmin.id]);
    expect(await usersRepo.findById(actor, rahul.id)).toBeNull();

    as(foreignAdmin);
    expect(await suspendUserAction({ userId: rahul.id })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await UserModel.findById(rahul.id).lean())?.status).toBe(UserStatus.ACTIVE);
  });
});
