import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import {
  addMemberAction,
  archiveBrandAction,
  createBrandAction,
  deactivateMemberAction,
  setPrimaryUploaderAction,
} from "@/features/brands/actions";
import { changeUserRoleAction, inviteUserAction } from "@/features/team/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  AgencyModel,
  BrandMembershipModel,
  BrandModel,
} from "@/server/db/models";
import { membershipsRepo } from "@/server/repositories/memberships.repo";
import {
  addMember,
  changeMemberRole,
  deactivateMember,
  getBrandTeam,
  getCoworkers,
  reactivateMember,
  searchMemberCandidates,
  setPrimaryUploader,
} from "@/server/services/brand-team.service";
import {
  archiveBrand,
  createBrand,
  getBrandForAdmin,
  getBrandPublic,
  getVisibleBrand,
  listBrands,
  listMyBrands,
  reactivateBrand,
  updateBrand,
} from "@/server/services/brands.service";
import { listTeam } from "@/server/services/users.service";
import {
  bootstrapAgency,
  createActiveUser,
  signIn,
  signInActor,
  type TestUser,
} from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser;
let rahul: TestUser,
  karan: TestUser,
  aman: TestUser,
  priya: TestUser,
  neha: TestUser,
  mohit: TestUser;
let amit: TestUser, carla: TestUser;
let A: Actor; // admin actor
let mamaearth: string, adidas: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

async function brand(name: string, actor = A) {
  return (
    await createBrand(actor, {
      name,
      description: null,
      logoUrl: null,
      status: "ACTIVE",
      socialHandles: [],
    })
  ).id;
}

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Maya Manager");
  rahul = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Rahul");
  karan = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Karan");
  aman = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Aman");
  priya = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Priya");
  neha = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Neha");
  mohit = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Mohit");
  amit = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Amit Client");
  carla = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Carla Client");
  for (const u of [admin, manager, rahul, karan, aman, priya, neha, mohit, amit, carla]) {
    cookies[u.id] = await signIn(u);
  }

  mamaearth = await brand("Mamaearth");
  adidas = await brand("Adidas");
  const assign = (userId: string, role: BrandRole, brandId = mamaearth) =>
    addMember(A, { brandId, userId, role });
  await assign(admin.id, BrandRole.BRAND_MANAGER);
  await assign(rahul.id, BrandRole.VIDEOGRAPHER);
  await assign(karan.id, BrandRole.VIDEOGRAPHER);
  await assign(aman.id, BrandRole.EDITOR);
  await assign(priya.id, BrandRole.DESIGNER);
  await assign(neha.id, BrandRole.UPLOADER);
  await assign(mohit.id, BrandRole.UPLOADER);
  await assign(amit.id, BrandRole.CLIENT);
  await assign(carla.id, BrandRole.CLIENT);
  await assign(carla.id, BrandRole.CLIENT, adidas);
  await assign(karan.id, BrandRole.VIDEOGRAPHER, adidas);
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

// ── Brand CRUD ─────────────────────────────────────────────────────────────
describe("brand CRUD", () => {
  it("creates with social handles, a safe agency-unique slug and an audit entry", async () => {
    const id = (
      await createBrand(A, {
        name: "Nike India",
        description: "Sportswear",
        logoUrl: "https://cdn.example.com/nike.png",
        status: "ACTIVE",
        socialHandles: [
          {
            platform: "INSTAGRAM",
            url: "https://instagram.com/nike",
            handle: "@nike",
            label: null,
          },
          { platform: "OTHER", url: "https://threads.net/@nike", handle: null, label: "Threads" },
        ],
      })
    ).id;
    const b = await getBrandForAdmin(A, id);
    expect(b).toMatchObject({
      name: "Nike India",
      slug: "nike-india",
      status: "ACTIVE",
      logoUrl: "https://cdn.example.com/nike.png",
    });
    expect(b.socialHandles).toHaveLength(2);
    expect(
      await ActivityLogModel.exists({ action: "brand.created", "entity.id": id }),
    ).not.toBeNull();
  });

  it("rejects duplicate names case-insensitively, but similar names get distinct slugs", async () => {
    await expect(brand("mamaEARTH")).rejects.toMatchObject({ code: "CONFLICT" });
    const a = await brand("Boat");
    const b = await brand("Boat!");
    const slugs = (await BrandModel.find({ _id: { $in: [a, b] } }).lean())
      .map((x) => x.slug)
      .sort();
    expect(slugs).toEqual(["boat", "boat-2"]);
  });

  it("updates and logs changed fields", async () => {
    const id = await brand("Lakme");
    await updateBrand(A, {
      brandId: id,
      name: "Lakmé",
      description: "Beauty",
      logoUrl: null,
      socialHandles: [
        { platform: "YOUTUBE", url: "https://youtube.com/@lakme", handle: null, label: null },
      ],
    });
    const log = await ActivityLogModel.findOne({ action: "brand.updated", "entity.id": id }).lean();
    expect(log?.meta).toMatchObject({
      fields: expect.arrayContaining(["name", "description", "socialHandles"]),
    });
  });

  it("archives (kept, hidden from the default list) and reactivates", async () => {
    const id = await brand("Old Brand");
    await archiveBrand(A, id);
    expect((await listBrands(A, {})).items.map((b) => b.id)).not.toContain(id);
    expect((await listBrands(A, { status: "ARCHIVED" })).items.map((b) => b.id)).toContain(id);
    expect(await BrandModel.exists({ _id: id })).not.toBeNull();
    await expect(archiveBrand(A, id)).rejects.toMatchObject({ code: "CONFLICT" });
    await reactivateBrand(A, id);
    expect((await getBrandForAdmin(A, id)).status).toBe("ACTIVE");
    const actions = await ActivityLogModel.find({ "entity.id": id }).distinct("action");
    expect(actions).toEqual(expect.arrayContaining(["brand.archived", "brand.reactivated"]));
  });

  it("manager (operational role) can manage brands", async () => {
    const id = await brand("Manager Brand", await actorOf(manager));
    expect((await getBrandForAdmin(await actorOf(manager), id)).name).toBe("Manager Brand");
  });
});

// ── Memberships ────────────────────────────────────────────────────────────
describe("memberships", () => {
  it("supports many people per role and groups the team by role", async () => {
    const team = await getBrandTeam(A, mamaearth);
    const names = (role: BrandRole) =>
      team.groups
        .find((g) => g.role === role)!
        .members.map((m) => m.name)
        .sort();
    expect(names(BrandRole.VIDEOGRAPHER)).toEqual(["Karan", "Rahul"]);
    expect(names(BrandRole.UPLOADER).sort()).toEqual(["Mohit", "Neha"]);
    expect(names(BrandRole.CLIENT)).toEqual(["Amit Client", "Carla Client"]);
    expect(names(BrandRole.BRAND_MANAGER)).toEqual(["Ada Admin"]);
  });

  it("supports multiple roles per person and blocks duplicate assignment", async () => {
    await addMember(A, { brandId: mamaearth, userId: rahul.id, role: BrandRole.EDITOR });
    const roles = await BrandMembershipModel.find({
      brandId: mamaearth,
      userId: rahul.id,
      status: "ACTIVE",
    }).distinct("role");
    expect(roles.sort()).toEqual(["EDITOR", "VIDEOGRAPHER"]);
    await expect(
      addMember(A, { brandId: mamaearth, userId: rahul.id, role: BrandRole.EDITOR }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await BrandMembershipModel.countDocuments({
        brandId: mamaearth,
        userId: rahul.id,
        role: "EDITOR",
      }),
    ).toBe(1);
  });

  it("enforces explicit system-role ↔ brand-role compatibility", async () => {
    await expect(
      addMember(A, { brandId: adidas, userId: amit.id, role: BrandRole.VIDEOGRAPHER }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      addMember(A, { brandId: adidas, userId: amit.id, role: BrandRole.EDITOR }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      addMember(A, { brandId: adidas, userId: rahul.id, role: BrandRole.CLIENT }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      addMember(A, { brandId: adidas, userId: admin.id, role: BrandRole.VIDEOGRAPHER }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Intentional: managers may do hands-on work, admins may run a brand.
    await addMember(A, { brandId: adidas, userId: manager.id, role: BrandRole.PHOTOGRAPHER });
    await addMember(A, { brandId: adidas, userId: admin.id, role: BrandRole.BRAND_MANAGER });
  });

  it("candidate search only offers compatible, not-yet-assigned people", async () => {
    const forClient = await searchMemberCandidates(A, {
      brandId: mamaearth,
      role: BrandRole.CLIENT,
      q: "",
    });
    expect(forClient.every((c) => c.systemRole === SystemRole.CLIENT)).toBe(true);
    expect(forClient.map((c) => c.id)).not.toContain(amit.id); // already a client here
    const forVideo = await searchMemberCandidates(A, {
      brandId: mamaearth,
      role: BrandRole.VIDEOGRAPHER,
      q: "",
    });
    expect(
      forVideo.every(
        (c) => c.systemRole === SystemRole.STAFF || c.systemRole === SystemRole.MANAGER,
      ),
    ).toBe(true);
    expect(forVideo.map((c) => c.id)).not.toContain(rahul.id);
  });

  it("removal deactivates (history kept) and reactivation reuses the same row", async () => {
    const m = await BrandMembershipModel.findOne({
      brandId: mamaearth,
      userId: priya.id,
      role: "DESIGNER",
    }).lean();
    await deactivateMember(A, { brandId: mamaearth, membershipId: String(m!._id) });
    const after = await BrandMembershipModel.findById(m!._id).lean();
    expect(after).toMatchObject({ status: "INACTIVE" });
    expect(String(after!.deactivatedBy)).toBe(admin.id);
    await reactivateMember(A, { brandId: mamaearth, membershipId: String(m!._id) });
    expect(
      await BrandMembershipModel.countDocuments({
        brandId: mamaearth,
        userId: priya.id,
        role: "DESIGNER",
      }),
    ).toBe(1);
    expect((await BrandMembershipModel.findById(m!._id).lean())?.status).toBe("ACTIVE");
  });

  it("role change deactivates the old role row and activates the new one", async () => {
    const id = await brand("Role Change Brand");
    const { membershipId } = await addMember(A, {
      brandId: id,
      userId: aman.id,
      role: BrandRole.ASSISTANT,
    });
    const res = await changeMemberRole(A, { brandId: id, membershipId, role: BrandRole.EDITOR });
    expect((await BrandMembershipModel.findById(membershipId).lean())?.status).toBe("INACTIVE");
    expect(await BrandMembershipModel.findById(res.membershipId).lean()).toMatchObject({
      role: "EDITOR",
      status: "ACTIVE",
    });
    const log = await ActivityLogModel.findOne({
      action: "membership.role_changed",
      brandId: id,
    }).lean();
    expect(log?.meta).toMatchObject({ from: "ASSISTANT", to: "EDITOR" });
  });

  it("archived brands are read-only for team changes", async () => {
    const id = await brand("Archived Team Brand");
    await archiveBrand(A, id);
    await expect(
      addMember(A, { brandId: id, userId: rahul.id, role: BrandRole.EDITOR }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ── Primary uploader ───────────────────────────────────────────────────────
describe("primary uploader", () => {
  it("the first uploader becomes primary automatically; later ones are backups", async () => {
    const b = await getBrandForAdmin(A, mamaearth);
    expect(b.primaryUploaderId).toBe(neha.id);
    const team = await getBrandTeam(A, mamaearth);
    const uploaders = team.groups.find((g) => g.role === BrandRole.UPLOADER)!.members;
    expect(uploaders.find((m) => m.isPrimaryUploader)?.name).toBe("Neha");
    expect(uploaders.find((m) => m.name === "Mohit")?.isPrimaryUploader).toBe(false);
  });

  it("only an active uploader on the brand can be primary", async () => {
    await expect(
      setPrimaryUploader(A, { brandId: mamaearth, userId: rahul.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await setPrimaryUploader(A, { brandId: mamaearth, userId: mohit.id });
    expect((await getBrandForAdmin(A, mamaearth)).primaryUploaderId).toBe(mohit.id);
    await setPrimaryUploader(A, { brandId: mamaearth, userId: neha.id });
  });

  it("deactivating the primary uploader clears the default (audited)", async () => {
    const id = await brand("Uploader Brand");
    const { membershipId } = await addMember(A, {
      brandId: id,
      userId: neha.id,
      role: BrandRole.UPLOADER,
    });
    expect((await getBrandForAdmin(A, id)).primaryUploaderId).toBe(neha.id);
    await deactivateMember(A, { brandId: id, membershipId });
    expect((await getBrandForAdmin(A, id)).primaryUploaderId).toBeNull();
    const reasons = (
      await ActivityLogModel.find({ action: "brand.primary_uploader_changed", brandId: id }).lean()
    ).map((l) => l.meta.reason);
    expect(reasons).toEqual(["auto_first_uploader", "uploader_removed"]);
  });
});

// ── Visibility ─────────────────────────────────────────────────────────────
describe("brand visibility (server-side)", () => {
  it("a Mamaearth-only client cannot access Adidas (404)", async () => {
    const c = await actorOf(amit);
    expect((await getBrandPublic(c, mamaearth)).name).toBe("Mamaearth");
    await expect(getVisibleBrand(c, adidas)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listMyBrands(c)).map((b) => b.name)).toEqual(["Mamaearth"]);
  });

  it("a client on two brands can access both", async () => {
    const c = await actorOf(carla);
    expect((await listMyBrands(c)).map((b) => b.name)).toEqual(["Adidas", "Mamaearth"]);
    expect((await getBrandPublic(c, adidas)).name).toBe("Adidas");
  });

  it("staff see only brands they belong to", async () => {
    const r = await actorOf(rahul);
    expect((await listMyBrands(r)).map((b) => b.name)).toEqual(["Mamaearth"]);
    await expect(getVisibleBrand(r, adidas)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const k = await actorOf(karan);
    expect((await listMyBrands(k)).map((b) => b.name)).toEqual(["Adidas", "Mamaearth"]);
  });

  it("deactivating a membership revokes access immediately (same session)", async () => {
    const id = await brand("Revocation Brand");
    const { membershipId } = await addMember(A, {
      brandId: id,
      userId: priya.id,
      role: BrandRole.DESIGNER,
    });
    const p = await actorOf(priya);
    expect((await getBrandPublic(p, id)).name).toBe("Revocation Brand");
    await deactivateMember(A, { brandId: id, membershipId });
    await expect(getVisibleBrand(p, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admin and manager see every brand in their agency", async () => {
    for (const u of [admin, manager]) {
      const names = (await listBrands(await actorOf(u), { status: "ALL" })).items.map(
        (b) => b.name,
      );
      expect(names).toEqual(expect.arrayContaining(["Adidas", "Mamaearth"]));
    }
  });

  it("staff membership listing exposes coworkers only on own brands, never client rows", async () => {
    const r = await actorOf(rahul);
    const rows = await membershipsRepo.find(r, {}, { limit: 200 });
    expect(rows.every((m) => String(m.brandId) === mamaearth)).toBe(true);
    expect(rows.some((m) => m.role === BrandRole.CLIENT)).toBe(false);
    expect(await membershipsRepo.find(r, { brandId: new Types.ObjectId(adidas) })).toEqual([]);
  });

  it("client membership listing exposes only their own rows", async () => {
    const c = await actorOf(amit);
    const rows = await membershipsRepo.find(c, {}, { limit: 200 });
    expect(rows.every((m) => String(m.userId) === amit.id)).toBe(true);
  });
});

// ── Agency isolation & URL / action manipulation ──────────────────────────
describe("agency isolation and id manipulation", () => {
  let foreignAdmin: TestUser;
  let foreignBrand: string;

  beforeAll(async () => {
    const other = await AgencyModel.create({
      name: "Agency B",
      slug: "agency-b",
      timezone: "UTC",
      currency: "USD",
    });
    foreignAdmin = await createActiveUser(String(other._id), SystemRole.ADMIN, "Foreign Admin");
    cookies[foreignAdmin.id] = await signIn(foreignAdmin);
    foreignBrand = await brand("Agency B Brand", await actorOf(foreignAdmin));
  });

  it("agency A cannot see agency B brands, and vice versa", async () => {
    await expect(getBrandForAdmin(A, foreignBrand)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const f = await actorOf(foreignAdmin);
    await expect(getBrandForAdmin(f, mamaearth)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listBrands(f, { status: "ALL" })).items.map((b) => b.name)).toEqual([
      "Agency B Brand",
    ]);
  });

  it("a foreign brandId in a Server Action is NOT_FOUND (no write happens)", async () => {
    as(admin);
    expect(await archiveBrandAction({ brandId: foreignBrand })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      await addMemberAction({ brandId: foreignBrand, userId: rahul.id, role: BrandRole.EDITOR }),
    ).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await BrandModel.findById(foreignBrand).lean())?.status).toBe("ACTIVE");
  });

  it("a foreign user cannot be assigned to my brand", async () => {
    await expect(
      addMember(A, { brandId: mamaearth, userId: foreignAdmin.id, role: BrandRole.BRAND_MANAGER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a membership id from another brand cannot be acted on via a different brandId", async () => {
    const adidasRow = await BrandMembershipModel.findOne({
      brandId: adidas,
      userId: karan.id,
    }).lean();
    as(admin);
    const res = await deactivateMemberAction({
      brandId: mamaearth,
      membershipId: String(adidasRow!._id),
    });
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await BrandMembershipModel.findById(adidasRow!._id).lean())?.status).toBe("ACTIVE");
  });

  it("staff opening an admin brand URL (any brand id) is refused", async () => {
    const r = await actorOf(rahul);
    await expect(getBrandForAdmin(r, mamaearth)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getBrandForAdmin(r, adidas)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getBrandTeam(r, mamaearth)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── Role manipulation & client restrictions ───────────────────────────────
describe("role manipulation and client restrictions", () => {
  it("staff cannot create or modify their own memberships", async () => {
    as(rahul);
    expect(
      await addMemberAction({ brandId: adidas, userId: rahul.id, role: BrandRole.BRAND_MANAGER }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await addMemberAction({
        brandId: mamaearth,
        userId: rahul.id,
        role: BrandRole.BRAND_MANAGER,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await setPrimaryUploaderAction({ brandId: mamaearth, userId: rahul.id })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await BrandMembershipModel.countDocuments({ userId: rahul.id, role: "BRAND_MANAGER" }),
    ).toBe(0);
  });

  it("unauthorized callers get FORBIDDEN, never validation details (permission before validation)", async () => {
    as(rahul);
    const bad = await createBrandAction({
      name: "",
      socialHandles: [{ platform: "NOPE" }],
    } as never);
    expect(bad).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((bad as { error: { fieldErrors?: unknown } }).error.fieldErrors).toBeUndefined();
    const badInvite = await inviteUserAction({ name: "", email: "nope", role: "ADMIN" } as never);
    expect(badInvite).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("clients cannot create brands, assign people, or change memberships", async () => {
    as(amit);
    expect(await createBrandAction({ name: "Client Brand" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await addMemberAction({ brandId: mamaearth, userId: amit.id, role: BrandRole.CLIENT }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const row = await BrandMembershipModel.findOne({ userId: amit.id }).lean();
    expect(
      await deactivateMemberAction({ brandId: mamaearth, membershipId: String(row!._id) }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("clients cannot see the internal team", async () => {
    await expect(getCoworkers(await actorOf(amit), mamaearth)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("a system-role change that would conflict with brand roles is refused", async () => {
    as(admin);
    expect(await changeUserRoleAction({ userId: rahul.id, role: SystemRole.CLIENT })).toMatchObject(
      {
        ok: false,
        error: { code: "CONFLICT" },
      },
    );
  });
});

// ── Coworker view ──────────────────────────────────────────────────────────
describe("coworker view", () => {
  it("shows teammates with collaboration fields only", async () => {
    const r = await actorOf(rahul);
    const team = await getCoworkers(r, mamaearth);
    const byName = Object.fromEntries(team.map((c) => [c.name, c]));
    expect(byName.Aman?.roles).toEqual([BrandRole.EDITOR]);
    expect(byName.Neha?.roles).toEqual([BrandRole.UPLOADER]);
    expect(byName.Rahul?.isYou).toBe(true);
    for (const c of team) {
      expect(Object.keys(c).sort()).toEqual(["image", "isYou", "name", "roles", "userId"]);
    }
    expect(team.map((c) => c.name)).not.toContain("Amit Client");
  });

  it("is limited to brands the staff member belongs to", async () => {
    await expect(getCoworkers(await actorOf(rahul), adidas)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ── Team page brand chips ──────────────────────────────────────────────────
describe("admin team page", () => {
  it("shows each person's brands with roles", async () => {
    const team = await listTeam(A, { q: "Karan" });
    expect(team.items[0]?.brands.map((b) => b.name)).toEqual(["Adidas", "Mamaearth"]);
    expect(team.items[0]?.brands[0]?.roles).toEqual([BrandRole.VIDEOGRAPHER]);
  });
});

// ── Audit atomicity ───────────────────────────────────────────────────────
describe("changes and their audit entries are atomic", () => {
  it("if the audit write fails, the membership change is rolled back", async () => {
    const id = await brand("Atomic Brand");
    const spy = vi
      .spyOn(ActivityLogModel, "create")
      .mockRejectedValueOnce(new Error("audit store down"));
    await expect(
      addMember(A, { brandId: id, userId: neha.id, role: BrandRole.UPLOADER }),
    ).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect(await BrandMembershipModel.countDocuments({ brandId: id })).toBe(0);
    expect((await getBrandForAdmin(A, id)).primaryUploaderId).toBeNull();
    // and a retry then succeeds normally
    await addMember(A, { brandId: id, userId: neha.id, role: BrandRole.UPLOADER });
    expect((await getBrandForAdmin(A, id)).primaryUploaderId).toBe(neha.id);
  });

  it("if the audit write fails, a brand is not created", async () => {
    const spy = vi
      .spyOn(ActivityLogModel, "create")
      .mockRejectedValueOnce(new Error("audit store down"));
    await expect(brand("Ghost Brand")).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect(await BrandModel.exists({ name: "Ghost Brand" })).toBeNull();
  });
});
