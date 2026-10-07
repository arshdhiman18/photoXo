import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { BrandRole, SystemRole, UserStatus } from "@/lib/domain/roles";
import { deleteBrandAction } from "@/features/brands/actions";
import { deleteContentAction } from "@/features/content/actions";
import { deleteUserAction } from "@/features/team/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  BrandMembershipModel,
  BrandModel,
  ContentModel,
  InvitationModel,
  ProductionTaskModel,
  UserModel,
} from "@/server/db/models";
import { addMember } from "@/server/services/brand-team.service";
import { createBrand, deleteBrand, getBrandDeletion } from "@/server/services/brands.service";
import { createBrief, deleteContent, getContentDeletion } from "@/server/services/content.service";
import { assignTask } from "@/server/services/tasks.service";
import { deleteUser, inviteUser } from "@/server/services/users.service";
import { createVersion } from "@/server/services/versions.service";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, staff: TestUser, client: TestUser;
let A: Actor, M: Actor, S: Actor;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const silent = <T,>(p: Promise<T>) => {
  const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  return p.finally(() => spy.mockRestore());
};

const newBrand = async (name: string) =>
  (await createBrand(A, { name, description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
const newContent = async (brandId: string, title = "Mistake") =>
  (
    await createBrief(A, {
      brandId, title, description: null, notes: null, contentType: "GRAPHIC", origin: "ADMIN_BRIEF",
      priority: "NORMAL", dueDate: null, referenceIds: [], referenceUrl: null, targetPlatforms: ["INSTAGRAM"],
    } as never)
  ).id;

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = (await signInActor(admin)).actor;
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Mona Manager");
  staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Dev Designer");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  for (const u of [admin, manager, staff, client]) cookies[u.id] = await signIn(u);
  M = (await signInActor(manager)).actor;
  S = (await signInActor(staff)).actor;
});
beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

describe("deleting content", () => {
  it("empty content is deleted with its tasks; audited", async () => {
    const brandId = await newBrand("Del Content Co");
    const id = await newContent(brandId);
    expect(await ProductionTaskModel.countDocuments({ contentId: id })).toBeGreaterThan(0);
    expect(await getContentDeletion(M, id)).toEqual({ deletable: true, reason: null });
    await deleteContent(M, id);
    expect(await ContentModel.exists({ _id: id })).toBeNull();
    expect(await ProductionTaskModel.countDocuments({ contentId: id })).toBe(0);
    expect(await ActivityLogModel.exists({ action: "content.deleted", "entity.id": id })).not.toBeNull();
  });

  it("content with a version can't be deleted; staff and clients can't delete at all", async () => {
    const brandId = await newBrand("Del Version Co");
    await addMember(A, { brandId, userId: staff.id, role: BrandRole.DESIGNER });
    const id = await newContent(brandId);
    const task = await ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
    await assignTask(A, String(task!._id), staff.id);
    await createVersion(S, { contentId: id, assetIds: [], links: [{ url: "https://www.canva.com/design/x/view", label: "V1" }], caption: "c", hashtags: [], changeNote: null } as never);

    expect(await getContentDeletion(A, id)).toMatchObject({ deletable: false, reason: expect.stringContaining("1 version") });
    await expect(deleteContent(A, id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await ContentModel.exists({ _id: id })).not.toBeNull();

    for (const who of [staff, client]) {
      as(who);
      expect(await deleteContentAction({ contentId: id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
  });
});

describe("deleting brands", () => {
  it("an empty brand is deleted with its team assignments; only ADMIN may do it", async () => {
    const brandId = await newBrand("Del Brand Co");
    await addMember(A, { brandId, userId: staff.id, role: BrandRole.EDITOR });

    as(manager);
    expect(await deleteBrandAction({ brandId })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await getBrandDeletion(M, brandId)).toEqual({ deletable: false, reason: null });

    as(admin);
    expect(await deleteBrandAction({ brandId })).toMatchObject({ ok: true });
    expect(await BrandModel.exists({ _id: brandId })).toBeNull();
    expect(await BrandMembershipModel.countDocuments({ brandId })).toBe(0);
    expect(await ActivityLogModel.exists({ action: "brand.deleted", "entity.id": brandId })).not.toBeNull();
  });

  it("a brand with content must be archived instead", async () => {
    const brandId = await newBrand("Del Busy Co");
    await newContent(brandId);
    expect(await getBrandDeletion(A, brandId)).toMatchObject({ deletable: false, reason: expect.stringContaining("1 content item") });
    await expect(deleteBrand(A, brandId)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("deleting people", () => {
  it("a never-joined invitee is removed with invitations and brand roles", async () => {
    const { user } = await silent(inviteUser(A, { name: "Wrong Email", email: "wrong@example.test", role: SystemRole.STAFF }));
    const brandId = await newBrand("Del People Co");
    await addMember(A, { brandId, userId: user.id, role: BrandRole.EDITOR }).catch(() => undefined);

    as(manager);
    expect(await deleteUserAction({ userId: user.id })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    as(admin);
    expect(await deleteUserAction({ userId: user.id })).toMatchObject({ ok: true });
    expect(await UserModel.exists({ _id: user.id })).toBeNull();
    expect(await InvitationModel.countDocuments({ userId: user.id })).toBe(0);
    expect(await BrandMembershipModel.countDocuments({ userId: user.id })).toBe(0);
    expect(await ActivityLogModel.exists({ action: "user.deleted", "entity.id": user.id })).not.toBeNull();
  });

  it("people who joined, admins and yourself can't be deleted", async () => {
    await expect(deleteUser(A, staff.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await UserModel.findById(staff.id).lean())!.status).toBe(UserStatus.ACTIVE);
    await expect(deleteUser(A, admin.id)).rejects.toThrow();
  });
});
