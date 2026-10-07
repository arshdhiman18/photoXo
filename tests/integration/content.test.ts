import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import {
  assignTaskAction,
  createIdeaAction,
  createTaskAction,
  createVersionAction,
  decideIdeaAction,
  setUploaderOverrideAction,
  updateContentAction,
  updateTaskStatusAction,
} from "@/features/content/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  AgencyModel,
  BrandMembershipModel,
  ContentModel,
  ContentVersionModel,
  ProductionTaskModel,
  ReferenceModel,
} from "@/server/db/models";
import { contentRepo } from "@/server/repositories/content.repo";
import { addMember, deactivateMember } from "@/server/services/brand-team.service";
import { createBrand } from "@/server/services/brands.service";
import {
  changeRoute,
  createBrief,
  createIdea,
  decideIdea,
  getContentForAdmin,
  getContentForClient,
  getContentForStaff,
  listContentAdmin,
  listContentForClient,
  listContentForStaff,
  resubmitIdea,
  setUploaderOverride,
} from "@/server/services/content.service";
import {
  assignTask,
  createTask,
  listMyTasks,
  updateTaskStatus,
} from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import {
  bootstrapAgency,
  createActiveUser,
  signIn,
  signInActor,
  type TestUser,
} from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser,
  manager: TestUser,
  rahul: TestUser,
  karan: TestUser,
  priya: TestUser,
  neha: TestUser,
  mohit: TestUser;
let amit: TestUser, carla: TestUser, dana: TestUser, foreignAdmin: TestUser;
let A: Actor;
let mamaearth: string, adidas: string, foreignContent: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

const brief = (brandId: string, extra: Record<string, unknown> = {}, actor = A) =>
  createBrief(actor, {
    brandId,
    title: "Summer launch reel",
    description: "Brief: hero product, warm tones",
    notes: "INTERNAL-NOTE-do-not-leak",
    contentType: "REEL",
    origin: "ADMIN_BRIEF",
    priority: "NORMAL",
    dueDate: null,
    referenceIds: [],
    referenceUrl: null,
    ...extra,
  } as never);

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Maya Manager");
  rahul = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Rahul");
  karan = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Karan");
  priya = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Priya");
  neha = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Neha");
  mohit = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Mohit");
  amit = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Amit Client");
  carla = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Carla Client");
  dana = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Dana Client");
  for (const u of [admin, manager, rahul, karan, priya, neha, mohit, amit, carla, dana])
    cookies[u.id] = await signIn(u);

  mamaearth = (
    await createBrand(A, {
      name: "Mamaearth",
      description: null,
      logoUrl: null,
      status: "ACTIVE",
      socialHandles: [],
    })
  ).id;
  adidas = (
    await createBrand(A, {
      name: "Adidas",
      description: null,
      logoUrl: null,
      status: "ACTIVE",
      socialHandles: [],
    })
  ).id;
  const add = (userId: string, role: BrandRole, brandId = mamaearth) =>
    addMember(A, { brandId, userId, role });
  await add(rahul.id, BrandRole.VIDEOGRAPHER);
  await add(karan.id, BrandRole.VIDEOGRAPHER);
  await add(karan.id, BrandRole.VIDEOGRAPHER, adidas);
  await add(priya.id, BrandRole.DESIGNER, adidas);
  await add(neha.id, BrandRole.UPLOADER); // primary
  await add(mohit.id, BrandRole.UPLOADER); // backup
  await add(amit.id, BrandRole.CLIENT);
  await add(carla.id, BrandRole.CLIENT);
  await add(carla.id, BrandRole.CLIENT, adidas);
  await add(dana.id, BrandRole.CLIENT, adidas);

  const other = await AgencyModel.create({
    name: "Agency B",
    slug: "agency-b",
    timezone: "UTC",
    currency: "USD",
  });
  foreignAdmin = await createActiveUser(String(other._id), SystemRole.ADMIN, "Foreign Admin");
  const F = await actorOf(foreignAdmin);
  const fb = await createBrand(F, {
    name: "Foreign Brand",
    description: null,
    logoUrl: null,
    status: "ACTIVE",
    socialHandles: [],
  });
  foreignContent = (await brief(fb.id, {}, F)).id;
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

/** Force a lifecycle state that later stages will reach (approval/posting not built yet). */
const forceStatus = (id: string, status: string) =>
  ContentModel.updateOne({ _id: id }, { $set: { status } });

// ── Creation, codes, routes ───────────────────────────────────────────────
describe("content creation", () => {
  it("brief → PLANNED with a human code and route tasks generated", async () => {
    const { id, code } = await brief(mamaearth);
    expect(code).toMatch(/^MAM-\d{4}$/);
    const c = await getContentForAdmin(A, id);
    expect(c).toMatchObject({ status: "PLANNED", origin: "ADMIN_BRIEF", route: "SHOOT_AND_EDIT" });
    expect(c.tasks.map((t) => t.taskType)).toEqual(["UPLOAD_FINAL"]); // SHOOT step creates no task
    expect(
      await ActivityLogModel.exists({ action: "content.created", "entity.id": id }),
    ).not.toBeNull();
  });

  it("codes are unique per agency even for brands with similar names", async () => {
    const twin = (
      await createBrand(A, {
        name: "Mama Earth Baby",
        description: null,
        logoUrl: null,
        status: "ACTIVE",
        socialHandles: [],
      })
    ).id;
    const a = await brief(mamaearth);
    const b = await brief(twin);
    expect(a.code.split("-")[0]).not.toBe(b.code.split("-")[0]);
  });

  it("REFERENCE origin requires a reference; the URL is classified, never downloaded", async () => {
    await expect(brief(mamaearth, { origin: "REFERENCE" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const { id } = await brief(mamaearth, {
      origin: "REFERENCE",
      referenceUrl: "https://www.instagram.com/reel/C1a2B3c4D5e/",
    });
    const c = await getContentForAdmin(A, id);
    expect(c.references[0]).toMatchObject({
      platform: "INSTAGRAM",
      externalId: "C1a2B3c4D5e",
      variant: "reel",
    });
  });

  it("route change before production cancels old route tasks and generates new ones", async () => {
    const { id } = await brief(mamaearth);
    await changeRoute(A, { contentId: id, route: "SHOOT_THEN_EDIT" });
    const tasks = await ProductionTaskModel.find({ contentId: id }).lean();
    expect(tasks.filter((t) => t.status === "CANCELLED").map((t) => t.taskType)).toEqual([
      "UPLOAD_FINAL",
    ]);
    // Stage 4: tasks after the route's SHOOT step wait for the shoot.
    expect(
      tasks.filter((t) => t.status === "BLOCKED" && t.waitingOn === "SHOOT").map((t) => t.taskType),
    ).toEqual(["UPLOAD_RAW", "EDIT"]);
    const raw = tasks.find((t) => t.taskType === "UPLOAD_RAW")!;
    await assignTask(A, String(raw._id), rahul.id);
    // A manager may override the wait (e.g. footage already exists) but never starts
    // someone's work for them; the assignee starting it begins production.
    await expect(updateTaskStatus(A, String(raw._id), "IN_PROGRESS")).rejects.toMatchObject({ code: "CONFLICT" });
    await updateTaskStatus(A, String(raw._id), "TODO");
    await updateTaskStatus(await actorOf(rahul), String(raw._id), "IN_PROGRESS");
    await expect(changeRoute(A, { contentId: id, route: "DESIGN" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

// ── Ideas ──────────────────────────────────────────────────────────────────
describe("team ideas", () => {
  it("staff can create an idea for their brand without any reference", async () => {
    const r = await actorOf(rahul);
    const { id } = await createIdea(r, {
      brandId: mamaearth,
      title: "Summer transition reel",
      description: "Outfit swap on beat",
      notes: null,
      contentType: "REEL",
      priority: "NORMAL",
      referenceIds: [],
      referenceUrl: null,
    } as never);
    const doc = await ContentModel.findById(id).lean();
    expect(doc).toMatchObject({ status: "PROPOSED", origin: "TEAM_IDEA", referenceIds: [] });
    expect(String(doc!.createdBy)).toBe(rahul.id);
    expect(await ProductionTaskModel.countDocuments({ contentId: id })).toBe(0);
  });

  it("staff cannot create an idea for a brand they don't belong to (404)", async () => {
    as(rahul);
    const res = await createIdeaAction({
      brandId: adidas,
      title: "Sneaky idea",
      contentType: "REEL",
    });
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("clients cannot create ideas; identity fields cannot be injected", async () => {
    as(amit);
    expect(
      await createIdeaAction({ brandId: mamaearth, title: "Client idea", contentType: "REEL" }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    as(rahul);
    const spoof = await createIdeaAction({
      brandId: mamaearth,
      title: "Spoofed idea",
      contentType: "REEL",
      createdBy: karan.id,
      agencyId: new Types.ObjectId().toHexString(),
    } as never);
    expect(spoof).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await ContentModel.countDocuments({ title: "Spoofed idea" })).toBe(0);
  });

  it("accept → PLANNED with tasks; reject → REJECTED; changes requested → author resubmits", async () => {
    const r = await actorOf(rahul);
    const mk = (title: string) =>
      createIdea(r, {
        brandId: mamaearth,
        title,
        contentType: "GRAPHIC",
        priority: "NORMAL",
        referenceIds: [],
        referenceUrl: null,
        description: null,
        notes: null,
      } as never);
    const a = await mk("Idea to accept");
    await decideIdea(A, { contentId: a.id, decision: "ACCEPTED", note: null });
    expect((await ContentModel.findById(a.id).lean())?.status).toBe("PLANNED");
    expect(
      (await ProductionTaskModel.find({ contentId: a.id }).lean()).map((t) => t.taskType),
    ).toEqual(["DESIGN"]);

    const b = await mk("Idea to reject");
    await decideIdea(A, { contentId: b.id, decision: "REJECTED", note: "Off-brand" });
    expect((await ContentModel.findById(b.id).lean())?.status).toBe("REJECTED");

    const c = await mk("Idea to rework");
    await decideIdea(A, { contentId: c.id, decision: "CHANGES_REQUESTED", note: "Add a hook" });
    expect(await ContentModel.findById(c.id).lean()).toMatchObject({
      status: "PROPOSED",
      ideaReview: { decision: "CHANGES_REQUESTED" },
    });
    // Another staff member cannot even see an unaccepted idea → 404, not 403.
    await expect(resubmitIdea(await actorOf(karan), c.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await resubmitIdea(r, c.id);
    expect((await ContentModel.findById(c.id).lean())?.ideaReview).toBeNull();

    const actions = await ActivityLogModel.find({ brandId: mamaearth }).distinct("action");
    expect(actions).toEqual(
      expect.arrayContaining([
        "content.idea_accepted",
        "content.idea_rejected",
        "content.idea_changes_requested",
        "content.idea_resubmitted",
      ]),
    );
  });

  it("staff cannot decide ideas", async () => {
    const idea = await createIdea(await actorOf(rahul), {
      brandId: mamaearth,
      title: "Decide me",
      contentType: "REEL",
      priority: "NORMAL",
      referenceIds: [],
      referenceUrl: null,
      description: null,
      notes: null,
    } as never);
    as(rahul);
    expect(await decideIdeaAction({ contentId: idea.id, decision: "ACCEPTED" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("other staff can't see someone's unaccepted idea; the author and managers can", async () => {
    const idea = await createIdea(await actorOf(rahul), {
      brandId: mamaearth,
      title: "Private idea",
      contentType: "REEL",
      priority: "NORMAL",
      referenceIds: [],
      referenceUrl: null,
      description: null,
      notes: null,
    } as never);
    await expect(getContentForStaff(await actorOf(karan), idea.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await getContentForStaff(await actorOf(rahul), idea.id)).title).toBe("Private idea");
    expect((await getContentForAdmin(await actorOf(manager), idea.id)).title).toBe("Private idea");
  });
});

// ── Scope ──────────────────────────────────────────────────────────────────
describe("content scope", () => {
  let mamaContent: string, adidasContent: string;
  beforeAll(async () => {
    mamaContent = (await brief(mamaearth)).id;
    adidasContent = (await brief(adidas)).id;
  });

  it("staff cannot access another brand's content", async () => {
    await expect(getContentForStaff(await actorOf(rahul), adidasContent)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("staff on multiple brands can access both", async () => {
    const k = await actorOf(karan);
    expect((await getContentForStaff(k, mamaContent)).id).toBe(mamaContent);
    expect((await getContentForStaff(k, adidasContent)).id).toBe(adidasContent);
  });

  it("clients see nothing in internal statuses, even for their own brand", async () => {
    await expect(getContentForClient(await actorOf(amit), mamaContent)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await listContentForClient(await actorOf(amit))).toEqual([]);
  });

  it("clients only reach their own brands' client-facing content", async () => {
    await forceStatus(mamaContent, "CLIENT_REVIEW");
    await forceStatus(adidasContent, "CLIENT_REVIEW");
    expect((await getContentForClient(await actorOf(amit), mamaContent)).id).toBe(mamaContent);
    await expect(getContentForClient(await actorOf(amit), adidasContent)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getContentForClient(await actorOf(dana), mamaContent)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const both = (await listContentForClient(await actorOf(carla))).map((c) => c.id);
    expect(both).toEqual(expect.arrayContaining([mamaContent, adidasContent]));
    await forceStatus(mamaContent, "PLANNED");
    await forceStatus(adidasContent, "PLANNED");
  });

  it("cross-agency and manipulated ids are NOT_FOUND (service and action)", async () => {
    await expect(getContentForAdmin(A, foreignContent)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getContentForAdmin(A, "not-an-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
    as(admin);
    const res = await updateContentAction({
      contentId: foreignContent,
      title: "Hijacked",
      contentType: "REEL",
      priority: "NORMAL",
    });
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await ContentModel.findById(foreignContent).lean())?.title).toBe("Summer launch reel");
  });

  it("staff opening the admin content URL is refused", async () => {
    await expect(getContentForAdmin(await actorOf(rahul), mamaContent)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admin list is agency-scoped and filterable", async () => {
    const list = await listContentAdmin(A, { brand: adidas });
    expect(list.items.every((i) => i.brand.id === adidas)).toBe(true);
    expect(list.items.map((i) => i.id)).not.toContain(foreignContent);
  });

  it("staff without edit rights cannot edit content fields", async () => {
    as(karan);
    const res = await updateContentAction({
      contentId: mamaContent,
      title: "Renamed by staff",
      contentType: "REEL",
      priority: "NORMAL",
    });
    expect(res).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

// ── Tasks ──────────────────────────────────────────────────────────────────
describe("production tasks", () => {
  let contentId: string, taskId: string;
  beforeAll(async () => {
    // A route without a shoot, so the assignee flow is not gated by a shoot (Stage 4).
    contentId = (await brief(mamaearth, { route: "EXISTING_ASSET" })).id;
    taskId = String((await ProductionTaskModel.findOne({ contentId }).lean())!._id);
  });

  it("staff cannot assign tasks — not to others, not to themselves", async () => {
    as(rahul);
    expect(await assignTaskAction({ taskId, assignedTo: rahul.id })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(
      await createTaskAction({ contentId, taskType: "OTHER", assignedTo: rahul.id }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("clients cannot create or update tasks", async () => {
    as(amit);
    expect(await createTaskAction({ contentId, taskType: "OTHER" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await updateTaskStatusAction({ taskId, status: "IN_PROGRESS" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("rejects ineligible assignees: other agency, no brand membership, client, wrong brand role", async () => {
    await expect(assignTask(A, taskId, foreignAdmin.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(assignTask(A, taskId, priya.id)).rejects.toMatchObject({ code: "VALIDATION" }); // Adidas only
    await expect(assignTask(A, taskId, amit.id)).rejects.toMatchObject({ code: "VALIDATION" }); // client
    await expect(assignTask(A, taskId, neha.id)).rejects.toMatchObject({ code: "VALIDATION" }); // uploader ≠ UPLOAD_FINAL
    await expect(assignTask(A, taskId, new Types.ObjectId().toHexString())).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("assigns an eligible member; only the assignee moves their task; content enters production", async () => {
    await assignTask(A, taskId, rahul.id);
    await expect(
      updateTaskStatus(await actorOf(karan), taskId, "IN_PROGRESS"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateTaskStatus(await actorOf(rahul), taskId, "IN_PROGRESS");
    expect((await ContentModel.findById(contentId).lean())?.status).toBe("IN_PRODUCTION");
    await expect(updateTaskStatus(await actorOf(rahul), taskId, "CANCELLED")).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    const mine = await listMyTasks(await actorOf(rahul));
    expect(mine.map((t) => t.id)).toContain(taskId);
    const log = await ActivityLogModel.findOne({
      action: "production_task.assigned",
      "entity.id": taskId,
    }).lean();
    expect(log?.meta).toMatchObject({ to: rahul.id });
  });

  it("a removed membership makes the person ineligible for future assignment", async () => {
    const m = await BrandMembershipModel.findOne({ brandId: mamaearth, userId: karan.id }).lean();
    const { id } = await createTask(A, {
      contentId,
      taskType: "OTHER",
      title: null,
      assignedTo: null,
      dueDate: null,
    });
    await deactivateMember(A, { brandId: mamaearth, membershipId: String(m!._id) });
    await expect(assignTask(A, id, karan.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await addMember(A, { brandId: mamaearth, userId: karan.id, role: BrandRole.VIDEOGRAPHER });
  });
});

// ── Uploader override ─────────────────────────────────────────────────────
describe("uploader override", () => {
  let contentId: string;
  beforeAll(async () => {
    contentId = (await brief(mamaearth)).id;
  });

  it("defaults to the brand primary uploader", async () => {
    expect((await getContentForAdmin(A, contentId)).uploader).toMatchObject({
      source: "BRAND_PRIMARY",
      effective: { id: neha.id },
    });
  });

  it("must be an active UPLOADER on the brand; arbitrary ids are rejected", async () => {
    await expect(setUploaderOverride(A, contentId, rahul.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      setUploaderOverride(A, contentId, new Types.ObjectId().toHexString()),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setUploaderOverride(A, contentId, foreignAdmin.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("clients and staff cannot set overrides", async () => {
    as(amit);
    expect(await setUploaderOverrideAction({ contentId, userId: mohit.id })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    as(rahul);
    expect(await setUploaderOverrideAction({ contentId, userId: mohit.id })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("override applies to this content only, is audited, and is never silently rewritten", async () => {
    await setUploaderOverride(A, contentId, mohit.id);
    const c = await getContentForAdmin(A, contentId);
    expect(c.uploader).toMatchObject({
      source: "OVERRIDE",
      effective: { id: mohit.id },
      brandPrimary: { id: neha.id },
      overrideInvalid: false,
    });
    expect(
      await ActivityLogModel.exists({
        action: "content.uploader_override_changed",
        "entity.id": contentId,
      }),
    ).not.toBeNull();

    const m = await BrandMembershipModel.findOne({
      brandId: mamaearth,
      userId: mohit.id,
      role: "UPLOADER",
    }).lean();
    await deactivateMember(A, { brandId: mamaearth, membershipId: String(m!._id) });
    const after = await getContentForAdmin(A, contentId);
    expect(after.uploader).toMatchObject({ override: { id: mohit.id }, overrideInvalid: true }); // flagged, not rewritten
    expect(after.uploader.brandPrimary?.id).toBe(neha.id);
    await expect(
      setUploaderOverride(A, (await brief(mamaearth)).id, mohit.id),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

// ── Versions ───────────────────────────────────────────────────────────────
describe("content versions", () => {
  let contentId: string;
  beforeAll(async () => {
    contentId = (await brief(mamaearth)).id;
    const t = await ProductionTaskModel.findOne({ contentId }).lean();
    await assignTask(A, String(t!._id), rahul.id);
  });

  const v = (actor: Actor, id = contentId) =>
    createVersion(actor, {
      assetIds: [],
      contentId: id,
      links: [{ url: "https://www.canva.com/design/abc/view", label: "Cut 1" }],
      caption: "Summer is here ☀️",
      hashtags: ["#summer", "#mamaearth"],
      changeNote: null,
    });

  it("assignee creates V1, V2 — numbers increase, nothing is overwritten", async () => {
    const r = await actorOf(rahul);
    expect((await v(r)).versionNumber).toBe(1);
    expect((await v(r)).versionNumber).toBe(2);
    const versions = await ContentVersionModel.find({ contentId })
      .sort({ versionNumber: 1 })
      .lean();
    expect(versions.map((x) => x.versionNumber)).toEqual([1, 2]);
    expect((await getContentForAdmin(A, contentId)).versions[0]?.assets[0]).toMatchObject({
      provider: "CANVA",
    });
  });

  it("duplicate version numbers are impossible and versions are immutable", async () => {
    const existing = await ContentVersionModel.findOne({ contentId, versionNumber: 1 }).lean();
    await expect(
      ContentVersionModel.create({ ...existing, _id: new Types.ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      ContentVersionModel.updateOne({ _id: existing!._id }, { $set: { caption: "edited" } }),
    ).rejects.toThrow(/immutable/);
    await expect(ContentVersionModel.deleteOne({ _id: existing!._id })).rejects.toThrow(
      /immutable/,
    );
  });

  it("staff without a version-producing task cannot add versions", async () => {
    await expect(v(await actorOf(karan))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("content from another agency cannot receive a version", async () => {
    as(admin);
    const res = await createVersionAction({
      contentId: foreignContent,
      links: [{ url: "https://figma.com/file/x" }],
    });
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await ContentVersionModel.countDocuments({ contentId: foreignContent })).toBe(0);
  });
});

// ── Serializer safety ─────────────────────────────────────────────────────
describe("client serializer", () => {
  it("contains no internal notes, brief, tasks, people, codes or audit data", async () => {
    const { id } = await brief(mamaearth);
    const t = await ProductionTaskModel.findOne({ contentId: id }).lean();
    await assignTask(A, String(t!._id), rahul.id);
    await forceStatus(id, "CLIENT_REVIEW");
    const dto = await getContentForClient(await actorOf(amit), id);
    expect(Object.keys(dto).sort()).toEqual([
      "brand",
      "contentType",
      "id",
      "statusLabel",
      "title",
      "updatedAt",
    ]);
    const json = JSON.stringify(dto);
    for (const leak of [
      "INTERNAL-NOTE",
      "Brief:",
      rahul.id,
      rahul.email,
      "MAM-",
      "UPLOAD_FINAL",
      admin.id,
      "CLIENT_REVIEW",
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(dto.statusLabel).toBe("Awaiting your approval");
  });

  it("clients get no tasks, references or versions from the repositories either", async () => {
    const c = await actorOf(amit);
    const { tasksRepo, referencesRepo, versionsRepo } =
      await import("@/server/repositories/content.repo");
    expect(await tasksRepo.find(c, {})).toEqual([]);
    expect(await referencesRepo.find(c, {})).toEqual([]);
    expect(await versionsRepo.find(c, {})).toEqual([]);
    expect(await ReferenceModel.countDocuments({ brandId: mamaearth })).toBeGreaterThan(0);
  });
});

// ── Staff views & atomicity ───────────────────────────────────────────────
describe("staff views and atomicity", () => {
  it("staff 'assigned' view shows content with my open tasks; 'brands' view excludes other brands", async () => {
    const r = await actorOf(rahul);
    const assigned = await listContentForStaff(r, "assigned");
    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.every((c) => c.myOpenTasks > 0)).toBe(true);
    const brands = await listContentForStaff(r, "brands");
    expect(brands.every((c) => c.brand.id === mamaearth)).toBe(true);
  });

  it("a failed audit write rolls back the whole content creation", async () => {
    const before = await ContentModel.countDocuments();
    const spy = vi
      .spyOn(ActivityLogModel, "create")
      .mockRejectedValueOnce(new Error("audit store down"));
    await expect(brief(mamaearth, { title: "Ghost content" })).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect(await ContentModel.countDocuments()).toBe(before);
    expect(await contentRepo.count(A, { title: "Ghost content" })).toBe(0);
  });
});
