import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SystemRole, UserStatus } from "@/lib/domain/roles";
import { disconnectDb } from "@/server/db/connect";
import { AgencyModel, ActivityLogModel, UserModel } from "@/server/db/models";
import { acceptInvitation, previewInvitation } from "@/server/services/invitations.service";
import { initializeAgencyWithFirstAdmin } from "@/server/services/bootstrap.service";
import {
  deactivateUser,
  inviteUser,
  reactivateUser,
  resendInvitation,
  suspendUser,
} from "@/server/services/users.service";
import {
  actorFromCookie,
  authRequest,
  bootstrapAgency,
  createActiveUser,
  signIn,
  signInActor,
  strongPassword,
  type TestUser,
} from "../support/fixtures";

/** Captures the invitation link printed by the dev email transport. */
async function inviteAndCaptureToken(run: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    await run();
    const output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    const match = output.match(/\/invite\/([A-Za-z0-9_-]{43})/);
    if (!match?.[1]) throw new Error("no invitation link was emitted");
    return match[1];
  } finally {
    spy.mockRestore();
  }
}

let admin: TestUser;

beforeAll(async () => {
  admin = await bootstrapAgency();
});

afterAll(async () => {
  await disconnectDb();
});

describe("first admin bootstrap", () => {
  it("creates exactly one agency and an ACTIVE admin who can sign in", async () => {
    expect(await AgencyModel.countDocuments()).toBe(1);
    const user = await UserModel.findById(admin.id).lean();
    expect(user).toMatchObject({ role: SystemRole.ADMIN, status: UserStatus.ACTIVE });
    const cookie = await signIn(admin);
    const actor = await actorFromCookie(cookie);
    expect(actor).toMatchObject({
      userId: admin.id,
      systemRole: SystemRole.ADMIN,
      agencyId: admin.agencyId,
    });
  });

  it("refuses to run a second time (no additional first-admins)", async () => {
    await expect(
      initializeAgencyWithFirstAdmin({
        agencyName: "Another",
        adminName: "Mallory",
        adminEmail: "mallory@example.test",
        adminPassword: strongPassword(),
        timezone: "Asia/Kolkata",
        currency: "INR",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await UserModel.countDocuments({ email: "mallory@example.test" })).toBe(0);
    expect(await AgencyModel.countDocuments()).toBe(1);
  });

  it("records the bootstrap in the activity log", async () => {
    const actions = await ActivityLogModel.find({ agencyId: admin.agencyId }).distinct("action");
    expect(actions).toEqual(expect.arrayContaining(["agency.initialized", "user.activated"]));
  });
});

describe("public registration is impossible", () => {
  it("rejects the email sign-up endpoint", async () => {
    const res = await authRequest("/sign-up/email", {
      email: "walk-in@example.test",
      password: strongPassword(),
      name: "Walk In",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await UserModel.countDocuments({ email: "walk-in@example.test" })).toBe(0);
  });
});

describe("login / logout", () => {
  it("rejects a wrong password", async () => {
    const res = await authRequest("/sign-in/email", {
      email: admin.email,
      password: "wrong-password-123",
    });
    expect(res.status).toBe(401);
  });

  it("sign-out invalidates the session server-side", async () => {
    const cookie = await signIn(admin);
    expect(await actorFromCookie(cookie)).not.toBeNull();
    const res = await authRequest("/sign-out", {}, cookie);
    expect(res.status).toBe(200);
    expect(await actorFromCookie(cookie)).toBeNull();
  });

  it("a forged/garbage session cookie yields no actor", async () => {
    expect(await actorFromCookie("photoxo.session_token=forged.value")).toBeNull();
  });
});

describe("invitation flow", () => {
  it("invite → user cannot sign in → accept → ACTIVE and signed in", async () => {
    const { actor } = await signInActor(admin);
    const email = "rahul@example.test";

    const token = await inviteAndCaptureToken(() =>
      inviteUser(actor, { name: "Rahul", email, role: SystemRole.STAFF }),
    );
    const invited = await UserModel.findOne({ email }).lean();
    expect(invited).toMatchObject({
      status: UserStatus.INVITED,
      role: SystemRole.STAFF,
      agencyId: invited!.agencyId,
    });
    expect(String(invited!.agencyId)).toBe(admin.agencyId);

    // An invited user has no password and cannot obtain a session.
    const early = await authRequest("/sign-in/email", { email, password: strongPassword() });
    expect(early.status).toBeGreaterThanOrEqual(400);

    expect(await previewInvitation(token)).toMatchObject({
      state: "valid",
      email,
      roleLabel: "Staff",
    });

    const password = strongPassword();
    await acceptInvitation({ token, name: "Rahul Sharma", password });

    const active = await UserModel.findOne({ email }).lean();
    expect(active).toMatchObject({
      status: UserStatus.ACTIVE,
      name: "Rahul Sharma",
      emailVerified: true,
    });

    const cookie = await signIn({ email, password });
    expect(await actorFromCookie(cookie)).toMatchObject({ systemRole: SystemRole.STAFF });
  });

  it("an invitation link can be used only once", async () => {
    const { actor } = await signInActor(admin);
    const token = await inviteAndCaptureToken(() =>
      inviteUser(actor, { name: "Once Only", email: "once@example.test", role: SystemRole.STAFF }),
    );
    await acceptInvitation({ token, name: "Once Only", password: strongPassword() });
    await expect(
      acceptInvitation({ token, name: "Replay", password: strongPassword() }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await previewInvitation(token)).toEqual({ state: "used" });
  });

  it("resending revokes the previous link", async () => {
    const { actor } = await signInActor(admin);
    const first = await inviteAndCaptureToken(() =>
      inviteUser(actor, { name: "Priya", email: "priya@example.test", role: SystemRole.STAFF }),
    );
    const user = await UserModel.findOne({ email: "priya@example.test" }).lean();
    const second = await inviteAndCaptureToken(() => resendInvitation(actor, String(user!._id)));

    expect(await previewInvitation(first)).toEqual({ state: "invalid" });
    await expect(
      acceptInvitation({ token: first, name: "Priya", password: strongPassword() }),
    ).rejects.toThrow();
    await acceptInvitation({ token: second, name: "Priya", password: strongPassword() });
  });

  it("garbage and unknown tokens are rejected without detail", async () => {
    expect(await previewInvitation("not-a-token")).toEqual({ state: "invalid" });
    expect(await previewInvitation("A".repeat(43))).toEqual({ state: "invalid" });
  });

  it("a duplicate email cannot be invited", async () => {
    const { actor } = await signInActor(admin);
    await expect(
      inviteUser(actor, { name: "Dup", email: admin.email, role: SystemRole.STAFF }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("suspension & deactivation", () => {
  it("suspending revokes live sessions immediately and blocks new sign-ins", async () => {
    const staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Karan");
    const staffCookie = await signIn(staff);
    expect(await actorFromCookie(staffCookie)).not.toBeNull();

    const { actor } = await signInActor(admin);
    await suspendUser(actor, staff.id);

    expect(await actorFromCookie(staffCookie)).toBeNull();
    const res = await authRequest("/sign-in/email", {
      email: staff.email,
      password: staff.password,
    });
    expect(res.status).toBe(403);

    const log = await ActivityLogModel.findOne({
      action: "user.suspended",
      "entity.id": staff.id,
    }).lean();
    expect(String(log?.actorId)).toBe(admin.id);

    await reactivateUser(actor, staff.id);
    expect(await actorFromCookie(await signIn(staff))).not.toBeNull();
  });

  it("a deactivated user cannot sign in", async () => {
    const staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Leaver");
    const { actor } = await signInActor(admin);
    await deactivateUser(actor, staff.id);
    const res = await authRequest("/sign-in/email", {
      email: staff.email,
      password: staff.password,
    });
    expect(res.status).toBe(403);
  });

  it("a status change in the database is honoured even for an existing session cookie", async () => {
    const staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Direct");
    const cookie = await signIn(staff);
    await UserModel.updateOne({ _id: staff.id }, { $set: { status: UserStatus.SUSPENDED } });
    expect(await actorFromCookie(cookie)).toBeNull();
  });
});

describe("audit atomicity (account state)", () => {
  it("a failed audit write rolls back a suspension", async () => {
    const staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Atomic");
    const { actor } = await signInActor(admin);
    const spy = vi
      .spyOn(ActivityLogModel, "create")
      .mockRejectedValueOnce(new Error("audit store down"));
    await expect(suspendUser(actor, staff.id)).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect((await UserModel.findById(staff.id).lean())?.status).toBe(UserStatus.ACTIVE);
  });
});
