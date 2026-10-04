import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import {
  confirmPostedAction,
  correctPostingAction,
  recordPostingOnBehalfAction,
  reopenForChangesAction,
  setTargetPlatformsAction,
  startPostingAction,
} from "@/features/postings/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  AgencyModel,
  ApprovalModel,
  AssetModel,
  BrandMembershipModel,
  ContentModel,
  PostingModel,
  ProductionTaskModel,
  UserModel,
} from "@/server/db/models";
import { postingsRepo } from "@/server/repositories/postings.repo";
import {
  decideClientReview,
  decideInternalReview,
  getClientReview,
  reopenForChanges,
  submitForInternalReview,
} from "@/server/services/approvals.service";
import { addMember, deactivateMember } from "@/server/services/brand-team.service";
import { archiveBrand, createBrand, reactivateBrand } from "@/server/services/brands.service";
import { createBrief, setUploaderOverride } from "@/server/services/content.service";
import {
  confirmPosted,
  correctPosting,
  getPostingWorkspace,
  listMyPostingQueue,
  listPostingHistory,
  listReadyToPost,
  recordPostingOnBehalf,
  setTargetPlatforms,
  startPosting,
} from "@/server/services/postings.service";
import { assignTask } from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, dev: TestUser, upA: TestUser, upB: TestUser, upY: TestUser;
let client: TestUser, foreignAdmin: TestUser;
let A: Actor, M: Actor, D: Actor, UA: Actor, UB: Actor, UY: Actor, C: Actor, F: Actor;
let brandX: string, brandY: string, foreignBrand: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

const IG = "https://www.instagram.com/p/Cx123/?igsh=abc#frag";
const YT = "https://youtu.be/dQw4w9WgXcQ";

async function newContent(brandId: string, platforms: string[], actor = A) {
  const { id } = await createBrief(actor, {
    brandId,
    title: "Festive reel",
    description: "BRIEF",
    notes: "INTERNAL-NOTE",
    contentType: "GRAPHIC",
    origin: "ADMIN_BRIEF",
    priority: "NORMAL",
    dueDate: null,
    referenceIds: [],
    referenceUrl: null,
    targetPlatforms: platforms,
  } as never);
  const task = await ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
  await assignTask(actor, String(task!._id), dev.id);
  return id;
}

const addVersion = async (contentId: string, caption = "Approved caption ✨", actor = A) =>
  (
    await createVersion(actor, {
      contentId,
      links: [{ url: "https://www.canva.com/design/x/view", label: "Final" }],
      caption,
      hashtags: ["festive", "launch"],
      changeNote: null,
    } as never)
  ).id;

async function approveThrough(id: string, v: string, actor = A) {
  await submitForInternalReview(actor, { contentId: id, versionId: v });
  await decideInternalReview(actor, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
  await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
}

/** Content READY_TO_POST on brandX for the given platforms. */
async function ready(platforms = ["INSTAGRAM", "YOUTUBE"], brandId = brandX, actor = A) {
  const id = await newContent(brandId, platforms, actor);
  const v1 = await addVersion(id, undefined, actor);
  await approveThrough(id, v1, actor);
  return { id, v1 };
}

const post = (id: string, v: string, platform: string, postUrl: string, actor = UA, extra: Record<string, unknown> = {}) =>
  confirmPosted(actor, { contentId: id, versionId: v, platform, postUrl, postedAt: null, screenshotUrl: null, note: null, ...extra } as never);
const content = (id: string) => ContentModel.findById(id).lean();

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Mona Manager");
  dev = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Dev Designer");
  upA = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Uma Uploader");
  upB = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Ben Backup");
  upY = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Yan Uploader");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  for (const u of [admin, manager, dev, upA, upB, upY, client]) cookies[u.id] = await signIn(u);
  [M, D, UA, UB, UY, C] = (await Promise.all([manager, dev, upA, upB, upY, client].map(actorOf))) as [Actor, Actor, Actor, Actor, Actor, Actor];

  brandX = (await createBrand(A, { name: "Xylo", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  brandY = (await createBrand(A, { name: "Yara", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  await addMember(A, { brandId: brandX, userId: dev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandY, userId: dev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: upA.id, role: BrandRole.UPLOADER }); // first → primary
  await addMember(A, { brandId: brandX, userId: upB.id, role: BrandRole.UPLOADER }); // backup
  await addMember(A, { brandId: brandY, userId: upY.id, role: BrandRole.UPLOADER });
  await addMember(A, { brandId: brandX, userId: client.id, role: BrandRole.CLIENT });
  await addMember(A, { brandId: brandY, userId: client.id, role: BrandRole.CLIENT });

  const other = await AgencyModel.create({ name: "Agency B", slug: "agency-b-post", timezone: "UTC", currency: "USD" });
  foreignAdmin = await createActiveUser(String(other._id), SystemRole.ADMIN, "Foreign Admin");
  F = await actorOf(foreignAdmin);
  foreignBrand = (await createBrand(F, { name: "Foreign", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

// ── Basic posting ─────────────────────────────────────────────────────────
describe("basic posting", () => {
  it("the approved item reaches the right uploader with the exact approved version", async () => {
    const { id, v1 } = await ready();
    expect((await listMyPostingQueue(UA)).map((i) => i.id)).toContain(id);
    expect((await listMyPostingQueue(UB)).map((i) => i.id)).not.toContain(id); // backup, not assigned
    expect((await listMyPostingQueue(UY)).map((i) => i.id)).not.toContain(id); // other brand
    const ws = await getPostingWorkspace(UA, id);
    expect(ws.approvedVersion).toMatchObject({ id: v1, versionNumber: 1, caption: "Approved caption ✨", hashtags: ["festive", "launch"] });
    expect(ws).toMatchObject({ canPost: true, canRecordOnBehalf: false, canCorrect: false, progress: { posted: 0, required: 2 } });
    expect(ws.uploader).toMatchObject({ source: "BRAND_PRIMARY", valid: true, person: { id: upA.id } });
  });

  it("one platform posted keeps the content open; the last one completes it", async () => {
    const { id, v1 } = await ready();
    await post(id, v1, "INSTAGRAM", IG);
    let c = await content(id);
    expect(c!.status).toBe("READY_TO_POST");
    const rec = await PostingModel.findOne({ contentId: id, platform: "INSTAGRAM" }).lean();
    expect(rec).toMatchObject({ status: "POSTED", postUrl: "https://www.instagram.com/p/Cx123/?igsh=abc", source: "UPLOADER", versionNumber: 1 });
    expect(String(rec!.postedBy)).toBe(upA.id);
    expect(String(rec!.recordedBy)).toBe(upA.id);
    expect(String(rec!.contentVersionId)).toBe(v1);
    expect(rec!.postedAt).toBeInstanceOf(Date);
    const ws = await getPostingWorkspace(UA, id);
    expect(ws.platforms.map((p) => [p.platform, p.state])).toEqual([
      ["INSTAGRAM", "POSTED"],
      ["YOUTUBE", "PENDING"],
    ]);

    await startPosting(UA, { contentId: id, versionId: v1, platform: "YOUTUBE" });
    expect((await content(id))!.status).toBe("READY_TO_POST"); // starting claims nothing
    expect((await getPostingWorkspace(UA, id)).platforms[1]!.state).toBe("POSTING");

    await post(id, v1, "YOUTUBE", YT, UA, { postedAt: new Date(Date.now() - 3_600_000).toISOString() });
    c = await content(id);
    expect(c!.status).toBe("COMPLETED");
    expect(c!.postedAt).toBeInstanceOf(Date);
    expect(c!.completedAt).toBeInstanceOf(Date);
    const statusLogs = (await ActivityLogModel.find({ "entity.id": new Types.ObjectId(id), action: "content.status_changed" }).sort({ createdAt: 1 }).lean()).map((l) => `${l.meta.from}>${l.meta.to}`);
    expect(statusLogs.slice(-2)).toEqual(["READY_TO_POST>POSTED", "POSTED>COMPLETED"]);
    for (const a of ["content.posted", "content.completed"] as const) {
      expect(await ActivityLogModel.countDocuments({ "entity.id": new Types.ObjectId(id), action: a })).toBe(1);
    }
    expect((await listMyPostingQueue(UA)).map((i) => i.id)).not.toContain(id);
    expect((await listPostingHistory(UA, { mine: true })).filter((h) => h.content.id === id)).toHaveLength(2);
  });

  it("validates post URLs per platform and refuses future times, duplicates and non-required platforms", async () => {
    const { id, v1 } = await ready(["INSTAGRAM", "OTHER"]);
    await expect(post(id, v1, "INSTAGRAM", YT)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(post(id, v1, "INSTAGRAM", "not a url")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(post(id, v1, "INSTAGRAM", IG, UA, { postedAt: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(post(id, v1, "TIKTOK", "https://www.tiktok.com/@x/video/1")).rejects.toMatchObject({ code: "VALIDATION" });
    await post(id, v1, "INSTAGRAM", IG, UA, { screenshotUrl: "https://drive.google.com/file/d/proof" });
    await expect(post(id, v1, "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT" });
    const rec = await PostingModel.findOne({ contentId: id, platform: "INSTAGRAM" }).lean();
    expect(await AssetModel.findById(rec!.screenshotAssetId).lean()).toMatchObject({ kind: "POSTING_PROOF", storage: "EXTERNAL_LINK" });
    await post(id, v1, "OTHER", "https://example.com/blog/launch"); // screenshot optional
    expect((await content(id))!.status).toBe("COMPLETED");
  });

  it("uploaders can't change the approved content or add versions after approval", async () => {
    const { id } = await ready();
    await expect(addVersion(id, "Sneaky new caption", A)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(addVersion(id, "Sneaky", UA)).rejects.toMatchObject({ code: expect.stringMatching(/CONFLICT|FORBIDDEN/) });
  });

  it("production tasks are not completed by approval or posting", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    const before = await ProductionTaskModel.find({ contentId: id }).lean();
    await post(id, v1, "INSTAGRAM", IG);
    const after = await ProductionTaskModel.find({ contentId: id }).lean();
    expect(after.map((t) => t.status)).toEqual(before.map((t) => t.status));
    expect(after.every((t) => t.status !== "COMPLETED")).toBe(true);
  });
});

// ── Permissions ───────────────────────────────────────────────────────────
describe("permissions", () => {
  it("only the assigned uploader can post", async () => {
    const { id, v1 } = await ready();
    await expect(post(id, v1, "INSTAGRAM", IG, D)).rejects.toMatchObject({ code: "FORBIDDEN" }); // staff, same brand
    await expect(post(id, v1, "INSTAGRAM", IG, UB)).rejects.toMatchObject({ code: "FORBIDDEN" }); // backup uploader
    await expect(post(id, v1, "INSTAGRAM", IG, UY)).rejects.toMatchObject({ code: "NOT_FOUND" }); // other brand
    await expect(post(id, v1, "INSTAGRAM", IG, M)).rejects.toMatchObject({ code: "FORBIDDEN" }); // manager isn't the uploader
    await expect(startPosting(D, { contentId: id, versionId: v1, platform: "INSTAGRAM" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getPostingWorkspace(D, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    as(client);
    expect(await confirmPostedAction({ contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await PostingModel.countDocuments({ contentId: id })).toBe(0);
  });

  it("admin records on the uploader's behalf (reason required); managers cannot", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    as(manager);
    expect(await recordPostingOnBehalfAction({ contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, reason: "Uma is on leave" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(recordPostingOnBehalf(M, { contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, reason: "x".repeat(5) } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    as(admin);
    expect(await recordPostingOnBehalfAction({ contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, reason: "" })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await recordPostingOnBehalfAction({ contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, reason: "Uma posted from her phone; app was down" })).toMatchObject({ ok: true, data: { completed: true } });
    const rec = await PostingModel.findOne({ contentId: id }).lean();
    expect(rec).toMatchObject({ source: "RECORDED_BY_ADMIN", adminReason: "Uma posted from her phone; app was down" });
    expect(String(rec!.recordedBy)).toBe(admin.id);
    expect(String(rec!.postedBy)).toBe(upA.id); // the actual uploader stays distinguishable
    const log = await ActivityLogModel.findOne({ action: "posting.recorded_by_admin", "entity.id": rec!._id }).lean();
    expect(String(log!.actorId)).toBe(admin.id);
    expect((await content(id))!.status).toBe("COMPLETED");
  });

  it("cross-agency content is not found", async () => {
    const f = await newContentForeign();
    await expect(post(f.id, f.v1, "INSTAGRAM", IG, A)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordPostingOnBehalf(A, { contentId: f.id, versionId: f.v1, platform: "INSTAGRAM", postUrl: IG, postedAt: null, screenshotUrl: null, note: null, reason: "test" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getPostingWorkspace(A, f.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("only uploaders of the brand (and ops) can read posting records; clients only confirmed ones", async () => {
    const { id, v1 } = await ready();
    await startPosting(UA, { contentId: id, versionId: v1, platform: "YOUTUBE" });
    await post(id, v1, "INSTAGRAM", IG);
    const filter = { contentId: new Types.ObjectId(id) };
    expect(await postingsRepo.find(D, filter)).toEqual([]); // non-uploader staff
    expect(await postingsRepo.find(UY, filter)).toEqual([]); // uploader of another brand
    expect(await postingsRepo.find(UB, filter)).toHaveLength(2); // uploader on this brand
    expect((await postingsRepo.find(C, filter)).map((p) => p.status)).toEqual(["POSTED"]);
    await expect(getPostingWorkspace(C, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function newContentForeign() {
  const { id } = await createBrief(F, {
    brandId: foreignBrand,
    title: "Foreign",
    description: null,
    notes: null,
    contentType: "GRAPHIC",
    origin: "ADMIN_BRIEF",
    priority: "NORMAL",
    dueDate: null,
    referenceIds: [],
    referenceUrl: null,
    targetPlatforms: ["INSTAGRAM"],
  } as never);
  const v1 = await addVersion(id, undefined, F);
  await submitForInternalReview(F, { contentId: id, versionId: v1 });
  await decideInternalReview(F, { contentId: id, versionId: v1, decision: "APPROVED", comment: null });
  return { id, v1 };
}

// ── Version safety ────────────────────────────────────────────────────────
describe("version safety", () => {
  it("only the client-approved version can be posted", async () => {
    const other = await ready(["INSTAGRAM"]);
    const { id, v1 } = await ready(["INSTAGRAM"]);
    await expect(post(id, new Types.ObjectId().toString(), "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(post(id, other.v1, "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT" }); // another content's version
    expect(await PostingModel.countDocuments({ contentId: id })).toBe(0);
    await post(id, v1, "INSTAGRAM", IG);
  });

  it("content that isn't READY_TO_POST can't be posted", async () => {
    const id = await newContent(brandX, ["INSTAGRAM"]);
    const v1 = await addVersion(id);
    await submitForInternalReview(A, { contentId: id, versionId: v1 });
    await decideInternalReview(A, { contentId: id, versionId: v1, decision: "APPROVED", comment: null });
    await expect(post(id, v1, "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT" }); // CLIENT_REVIEW
    await expect(recordPostingOnBehalf(A, { contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, postedAt: null, screenshotUrl: null, note: null, reason: "client said ok" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await content(id))!.status).toBe("CLIENT_REVIEW");
  });

  it("a tampered approved-version pointer or missing approvals are rejected", async () => {
    const { id } = await ready(["INSTAGRAM"]);
    // Tamper the DB pointer to an unapproved version of the same content (bypassing the services).
    const rogue = new Types.ObjectId();
    const c = await content(id);
    await (await import("@/server/db/models")).ContentVersionModel.create({
      _id: rogue,
      agencyId: c!.agencyId,
      brandId: c!.brandId,
      contentId: c!._id,
      versionNumber: 99,
      assetIds: [],
      caption: "unapproved",
      hashtags: [],
      changeNote: null,
      createdBy: c!.createdBy,
    });
    await ContentModel.updateOne({ _id: id }, { $set: { clientApprovedVersionId: rogue, internalApprovedVersionId: rogue } });
    await expect(post(id, String(rogue), "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("approvals") });
    expect((await getPostingWorkspace(UA, id)).canPost).toBe(false);
  });
});

// ── Uploader assignment ───────────────────────────────────────────────────
describe("uploader assignment", () => {
  it("override beats the brand primary; a backup is assigned through the existing override", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    await setUploaderOverride(A, id, upB.id);
    expect((await getPostingWorkspace(M, id)).uploader).toMatchObject({ source: "OVERRIDE", valid: true, person: { id: upB.id } });
    expect((await listMyPostingQueue(UB)).map((i) => i.id)).toContain(id);
    expect((await listMyPostingQueue(UA)).map((i) => i.id)).not.toContain(id);
    await expect(post(id, v1, "INSTAGRAM", IG, UA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await post(id, v1, "INSTAGRAM", IG, UB);
    expect((await content(id))!.status).toBe("COMPLETED");
  });

  it("a removed override uploader is surfaced, never silently re-routed", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    await setUploaderOverride(A, id, upB.id);
    const m = await BrandMembershipModel.findOne({ brandId: brandX, userId: upB.id, role: "UPLOADER" }).lean();
    await deactivateMember(A, { brandId: brandX, membershipId: String(m!._id) });
    const item = (await listReadyToPost(M)).find((i) => i.id === id);
    expect(item?.uploader).toMatchObject({ source: "OVERRIDE", valid: false, problem: "NOT_AN_UPLOADER" });
    await expect(post(id, v1, "INSTAGRAM", IG, UB)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(post(id, v1, "INSTAGRAM", IG, UA)).rejects.toMatchObject({ code: "FORBIDDEN" }); // primary is NOT used automatically
    expect((await listMyPostingQueue(UA)).map((i) => i.id)).not.toContain(id);
    expect((await getPostingWorkspace(A, id)).blockedReason).toMatch(/uploader/);
    // An admin explicitly reassigns (clears the override → brand primary).
    await setUploaderOverride(A, id, null);
    await post(id, v1, "INSTAGRAM", IG, UA);
    await addMember(A, { brandId: brandX, userId: upB.id, role: BrandRole.UPLOADER });
  });

  it("an inactive uploader account and a brand without an uploader are surfaced", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"], brandY);
    await UserModel.updateOne({ _id: upY.id }, { $set: { status: "SUSPENDED" } });
    expect((await listReadyToPost(A)).find((i) => i.id === id)?.uploader).toMatchObject({ valid: false, problem: "INACTIVE_ACCOUNT" });
    await UserModel.updateOne({ _id: upY.id }, { $set: { status: "ACTIVE" } });
    const m = await BrandMembershipModel.findOne({ brandId: brandY, userId: upY.id, role: "UPLOADER" }).lean();
    await deactivateMember(A, { brandId: brandY, membershipId: String(m!._id) }); // primary cleared by Stage 2
    expect((await listReadyToPost(A)).find((i) => i.id === id)?.uploader).toMatchObject({ source: "NONE", valid: false, problem: "NO_UPLOADER" });
    // Admin can still record on the brand's behalf; postedBy stays empty (no valid uploader).
    await recordPostingOnBehalf(A, { contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, postedAt: null, screenshotUrl: null, note: null, reason: "Brand has no uploader yet" });
    const rec = await PostingModel.findOne({ contentId: id }).lean();
    expect(rec!.postedBy).toBeNull();
    expect(String(rec!.recordedBy)).toBe(admin.id);
    await addMember(A, { brandId: brandY, userId: upY.id, role: BrandRole.UPLOADER });
  });

  it("content created before Stage 6 (no targetPlatforms field) is surfaced, not crashed", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    await ContentModel.collection.updateOne({ _id: new Types.ObjectId(id) }, { $unset: { targetPlatforms: "" } });
    const ws = await getPostingWorkspace(A, id);
    expect(ws).toMatchObject({ targetPlatforms: [], progress: { posted: 0, required: 0 }, blockedReason: expect.stringMatching(/platforms/) });
    expect((await listReadyToPost(A)).find((i) => i.id === id)?.targetPlatforms).toEqual([]);
    await expect(post(id, v1, "INSTAGRAM", IG)).rejects.toMatchObject({ code: "VALIDATION" });
    await setTargetPlatforms(A, { contentId: id, platforms: ["INSTAGRAM"] });
    await post(id, v1, "INSTAGRAM", IG);
    expect((await content(id))!.status).toBe("COMPLETED");
  });

  it("archived brands get no new posting work", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"], brandY);
    await archiveBrand(A, brandY);
    await expect(recordPostingOnBehalf(A, { contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, postedAt: null, screenshotUrl: null, note: null, reason: "x-x-x" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getPostingWorkspace(A, id)).blockedReason).toMatch(/archived/);
    await reactivateBrand(A, brandY);
  });
});

// ── Corrections, history, platforms, reopen ───────────────────────────────
describe("corrections and history", () => {
  it("admin corrections keep the previous values; others can't correct", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    await post(id, v1, "INSTAGRAM", IG);
    const rec = await PostingModel.findOne({ contentId: id }).lean();
    await expect(correctPosting(M, { postingId: String(rec!._id), postUrl: "https://www.instagram.com/p/Fixed/", postedAt: null, screenshotUrl: null, reason: "typo" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    as(upA);
    expect(await correctPostingAction({ postingId: String(rec!._id), postUrl: "https://www.instagram.com/p/Fixed/", reason: "typo" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(correctPosting(A, { postingId: String(rec!._id), postUrl: YT, postedAt: null, screenshotUrl: null, reason: "wrong" })).rejects.toMatchObject({ code: "VALIDATION" });
    await correctPosting(A, { postingId: String(rec!._id), postUrl: "https://www.instagram.com/p/Fixed/", postedAt: null, screenshotUrl: null, reason: "Uploader pasted the wrong link" });
    const after = await PostingModel.findById(rec!._id).lean();
    expect(after!.postUrl).toBe("https://www.instagram.com/p/Fixed/");
    expect(after!.corrections[0]).toMatchObject({ previous: { postUrl: "https://www.instagram.com/p/Cx123/?igsh=abc" }, reason: "Uploader pasted the wrong link" });
    expect(String(after!.corrections[0]!.correctedBy)).toBe(admin.id);
    expect(await ActivityLogModel.countDocuments({ action: "posting.corrected", "entity.id": rec!._id })).toBe(1);
    const history = await listPostingHistory(A);
    expect(history.find((h) => h.id === String(rec!._id))?.corrections).toHaveLength(1);
    await expect(PostingModel.deleteOne({ _id: rec!._id })).rejects.toThrow(/never deleted/);
  });

  it("a failed confirmation rolls back the posting, the status and the audit", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    const logsBefore = await ActivityLogModel.countDocuments();
    const spy = vi.spyOn(ActivityLogModel, "create").mockRejectedValueOnce(new Error("audit store down"));
    await expect(post(id, v1, "INSTAGRAM", IG)).rejects.toThrow("audit store down");
    spy.mockRestore();
    expect(await PostingModel.countDocuments({ contentId: id })).toBe(0);
    expect((await content(id))!.status).toBe("READY_TO_POST");
    expect(await ActivityLogModel.countDocuments()).toBe(logsBefore);
  });

  it("target platforms: ops only, required after internal review, locked once posting starts", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    as(dev);
    expect(await setTargetPlatformsAction({ contentId: id, platforms: ["YOUTUBE"] })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(setTargetPlatforms(M, { contentId: id, platforms: [] })).rejects.toMatchObject({ code: "VALIDATION" });
    await setTargetPlatforms(M, { contentId: id, platforms: ["INSTAGRAM", "TIKTOK"] });
    expect((await content(id))!.targetPlatforms).toEqual(["INSTAGRAM", "TIKTOK"]);
    await startPosting(UA, { contentId: id, versionId: v1, platform: "INSTAGRAM" });
    await expect(setTargetPlatforms(M, { contentId: id, platforms: ["INSTAGRAM"] })).rejects.toMatchObject({ code: "CONFLICT" });
    await post(id, v1, "INSTAGRAM", IG);
    expect((await content(id))!.status).toBe("READY_TO_POST"); // TikTok still required
  });

  it("approved content can go back for changes before posting; the new version needs both approvals again", async () => {
    const { id, v1 } = await ready(["INSTAGRAM", "YOUTUBE"]);
    await startPosting(UA, { contentId: id, versionId: v1, platform: "INSTAGRAM" });
    as(dev);
    expect(await reopenForChangesAction({ contentId: id, versionId: v1, reason: "Price changed" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await reopenForChanges(M, { contentId: id, versionId: v1, reason: "Price changed" });
    let c = await content(id);
    expect(c!.status).toBe("CHANGES_REQUESTED");
    expect(c!.changesRequestedBy).toMatchObject({ stage: "INTERNAL", comment: "Price changed" });
    // Architect decision: the client sees "Changes in progress", not a vanished item.
    expect(c!.clientChangesPending).toBe(true);
    expect(await getClientReview(C, id)).toMatchObject({ state: "CHANGES", statusLabel: "Changes in progress", canDecide: false });
    const cancelled = await PostingModel.findOne({ contentId: id }).lean();
    expect(cancelled).toMatchObject({ status: "CANCELLED", live: false, cancelReason: "Price changed" });
    await expect(submitForInternalReview(A, { contentId: id, versionId: v1 })).rejects.toMatchObject({ code: "CONFLICT" });

    const v2 = await addVersion(id, "New price caption");
    await approveThrough(id, v2);
    c = await content(id);
    expect(c!.status).toBe("READY_TO_POST");
    expect(String(c!.clientApprovedVersionId)).toBe(v2);
    await expect(post(id, v1, "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT" }); // old version
    expect((await getPostingWorkspace(UA, id)).approvedVersion?.caption).toBe("New price caption");
    await post(id, v2, "INSTAGRAM", IG);
    await post(id, v2, "YOUTUBE", YT);
    expect((await content(id))!.status).toBe("COMPLETED");
    const records = await PostingModel.find({ contentId: id }).sort({ createdAt: 1 }).lean();
    expect(records.map((r) => `${r.versionNumber}:${r.platform}:${r.status}`)).toEqual(["1:INSTAGRAM:CANCELLED", "2:INSTAGRAM:POSTED", "2:YOUTUBE:POSTED"]);
    const v1History = await ApprovalModel.find({ contentVersionId: v1 }).sort({ decidedAt: 1 }).lean();
    expect(v1History.map((r) => `${r.stage}:${r.decision}`)).toEqual(["INTERNAL:APPROVED", "CLIENT:APPROVED", "INTERNAL:CHANGES_REQUESTED"]);
  });

  it("content already posted somewhere can't be sent back for changes (architect decision pending)", async () => {
    const { id, v1 } = await ready(["INSTAGRAM", "YOUTUBE"]);
    await post(id, v1, "INSTAGRAM", IG);
    await expect(reopenForChanges(A, { contentId: id, versionId: v1, reason: "Too late" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await content(id))!.status).toBe("READY_TO_POST");
  });
});

// ── Injection & client view ───────────────────────────────────────────────
describe("security", () => {
  it("injected identity, scope, state and version fields are rejected", async () => {
    const { id, v1 } = await ready(["INSTAGRAM"]);
    as(upA);
    for (const extra of [
      { userId: admin.id },
      { agencyId: foreignAdmin.agencyId },
      { brandId: brandY },
      { uploaderId: upB.id },
      { postedBy: upB.id },
      { recordedBy: admin.id },
      { status: "POSTED" },
      { approvedVersionId: v1 },
      { clientApprovedVersionId: v1 },
      { source: "RECORDED_BY_ADMIN" },
    ]) {
      const res = await confirmPostedAction({ contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG, ...extra } as never);
      expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect(await startPostingAction({ contentId: id, versionId: "nope", platform: "INSTAGRAM" })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await PostingModel.countDocuments({ contentId: id })).toBe(0);
    expect(await confirmPostedAction({ contentId: id, versionId: v1, platform: "INSTAGRAM", postUrl: IG })).toMatchObject({ ok: true });
  });

  it("clients see where it went live — and nothing internal", async () => {
    const { id, v1 } = await ready(["INSTAGRAM", "YOUTUBE"]);
    await post(id, v1, "INSTAGRAM", IG, UA, { note: "UPLOADER-NOTE", screenshotUrl: "https://drive.google.com/proof" });
    await recordPostingOnBehalf(A, { contentId: id, versionId: v1, platform: "YOUTUBE", postUrl: YT, postedAt: null, screenshotUrl: null, note: null, reason: "ADMIN-REASON" });
    const review = await getClientReview(C, id);
    expect(review.statusLabel).toBe("Published");
    expect(review.posts.map((p) => p.platform)).toEqual(["INSTAGRAM", "YOUTUBE"]);
    const json = JSON.stringify(review);
    for (const s of ["UPLOADER-NOTE", "ADMIN-REASON", "drive.google.com/proof", "Uma Uploader", "Ada Admin", '"postedBy"', '"recordedBy"', '"source"', '"note"', "INTERNAL-NOTE"]) {
      expect(json).not.toContain(s);
    }
  });
});
