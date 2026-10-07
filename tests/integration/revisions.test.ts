import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import { startRevisionAction } from "@/features/postings/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  ApprovalModel,
  ContentModel,
  ContentVersionModel,
  NotificationModel,
  PostingModel,
  ProductionTaskModel,
} from "@/server/db/models";
import {
  decideClientReview,
  decideInternalReview,
  getClientReview,
  getReviewState,
  reopenForChanges,
  startRevision,
  submitForInternalReview,
} from "@/server/services/approvals.service";
import { addMember } from "@/server/services/brand-team.service";
import { archiveBrand, createBrand, reactivateBrand } from "@/server/services/brands.service";
import { archiveContent, createBrief, getContentActivity } from "@/server/services/content.service";
import { confirmPosted, getPostingWorkspace, setTargetPlatforms, startPosting } from "@/server/services/postings.service";
import { assignTask } from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, dev: TestUser, uploader: TestUser, client: TestUser;
let A: Actor, M: Actor, D: Actor, U: Actor, C: Actor;
let brandX: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;
const IG = "https://www.instagram.com/p/v1/";
const YT = "https://youtu.be/v1";

async function newContent(platforms = ["INSTAGRAM", "YOUTUBE"]) {
  const { id } = await createBrief(A, {
    brandId: brandX, title: "Launch reel", description: null, notes: "INTERNAL-NOTE", contentType: "GRAPHIC",
    origin: "ADMIN_BRIEF", priority: "NORMAL", dueDate: null, referenceIds: [], referenceUrl: null, targetPlatforms: platforms,
  } as never);
  const task = await ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
  await assignTask(A, String(task!._id), dev.id);
  return id;
}
const version = async (id: string, caption: string) =>
  (await createVersion(D, { contentId: id, links: [{ url: "https://www.canva.com/design/x/view", label: "Final" }], caption, hashtags: ["launch"], changeNote: null } as never)).id;
async function approve(id: string, v: string) {
  await submitForInternalReview(D, { contentId: id, versionId: v });
  await decideInternalReview(M, { contentId: id, versionId: v, decision: "APPROVED", comment: "INTERNAL-OK" });
  await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
}
const post = (id: string, v: string, platform: string, url: string) =>
  confirmPosted(U, { contentId: id, versionId: v, platform, postUrl: url, postedAt: null, screenshotUrl: null, note: null } as never);
const content = (id: string) => ContentModel.findById(id).lean();

/** V1 fully posted → COMPLETED. */
async function completedV1() {
  const id = await newContent();
  const v1 = await version(id, "V1 caption");
  await approve(id, v1);
  await post(id, v1, "INSTAGRAM", IG);
  await post(id, v1, "YOUTUBE", YT);
  return { id, v1 };
}

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Mona Manager");
  dev = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Dev Designer");
  uploader = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Uma Uploader");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  for (const u of [admin, manager, dev, uploader, client]) cookies[u.id] = await signIn(u);
  [M, D, U, C] = (await Promise.all([manager, dev, uploader, client].map(actorOf))) as [Actor, Actor, Actor, Actor];
  brandX = (await createBrand(A, { name: "Xylo", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  await addMember(A, { brandId: brandX, userId: dev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: uploader.id, role: BrandRole.UPLOADER });
  await addMember(A, { brandId: brandX, userId: client.id, role: BrandRole.CLIENT });
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

describe("post-publication revision", () => {
  it("completed V1 → revision → V2 through review and its own posting round; V1 untouched", async () => {
    const { id, v1 } = await completedV1();
    const before = await content(id);
    expect(before).toMatchObject({ status: "COMPLETED" });
    const v1Postings = await PostingModel.find({ contentVersionId: v1 }).lean();
    const v1Approvals = await ApprovalModel.find({ contentVersionId: v1 }).lean();
    const v1Doc = await ContentVersionModel.findById(v1).lean();

    await startRevision(M, { contentId: id, reason: "Price changed on the poster" });
    let c = await content(id);
    expect(c).toMatchObject({ status: "CHANGES_REQUESTED", revisionCount: 1, clientChangesPending: true, postedAt: null, completedAt: null });
    expect(c!.changesRequestedBy).toMatchObject({ revision: 1, versionNumber: 1, comment: "Price changed on the poster", approvalId: null });
    expect(c!.revisions[0]).toMatchObject({ number: 1, fromVersionNumber: 1, previousStatus: "COMPLETED" });
    expect(c!.revisions[0]!.previousCompletedAt).toEqual(before!.completedAt);
    expect(await ActivityLogModel.countDocuments({ action: "content.post_publication_revision_started", "entity.id": new Types.ObjectId(id) })).toBe(1);

    // V1 can't be resubmitted; a NEW immutable version is required.
    await expect(submitForInternalReview(D, { contentId: id, versionId: v1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await setTargetPlatforms(M, { contentId: id, platforms: ["INSTAGRAM"] }); // adjust targets before internal approval
    const v2 = await version(id, "V2 caption — new price");
    await approve(id, v2);
    c = await content(id);
    expect(c).toMatchObject({ status: "READY_TO_POST", clientChangesPending: false });
    expect(String(c!.clientApprovedVersionId)).toBe(v2);
    const ws = await getPostingWorkspace(U, id);
    expect(ws).toMatchObject({ currentVersionNumber: 2, progress: { posted: 0, required: 1 } });
    expect(ws.approvedVersion?.caption).toBe("V2 caption — new price");
    await expect(post(id, v1, "INSTAGRAM", IG)).rejects.toMatchObject({ code: "CONFLICT" }); // old version can't be posted
    await post(id, v2, "INSTAGRAM", "https://www.instagram.com/p/v2/");
    c = await content(id);
    expect(c!.status).toBe("COMPLETED");
    expect(String(c!.currentVersionId)).toBe(v2);

    // History: V1 records byte-for-byte unchanged; V2 has its own.
    expect(await PostingModel.find({ contentVersionId: v1 }).lean()).toEqual(v1Postings);
    expect(await ApprovalModel.find({ contentVersionId: v1 }).lean()).toEqual(v1Approvals);
    expect(await ContentVersionModel.findById(v1).lean()).toEqual(v1Doc);
    const all = await PostingModel.find({ contentId: id }).sort({ versionNumber: 1, platform: 1 }).lean();
    expect(all.map((p) => `V${p.versionNumber}:${p.platform}:${p.status}`)).toEqual(["V1:INSTAGRAM:POSTED", "V1:YOUTUBE:POSTED", "V2:INSTAGRAM:POSTED"]);
    const history = (await getPostingWorkspace(A, id)).history;
    expect(history.filter((h) => h.versionNumber === 1)).toHaveLength(2);
    expect(history.filter((h) => h.versionNumber === 2)).toHaveLength(1);
  });

  it("partially posted content: V1's posted and pending platforms stay as they were", async () => {
    const id = await newContent();
    const v1 = await version(id, "V1");
    await approve(id, v1);
    await post(id, v1, "INSTAGRAM", IG);
    await startPosting(U, { contentId: id, versionId: v1, platform: "YOUTUBE" }); // started, never confirmed
    const v1Before = await PostingModel.find({ contentVersionId: v1 }).sort({ platform: 1 }).lean();
    expect(v1Before.map((p) => `${p.platform}:${p.status}`)).toEqual(["INSTAGRAM:POSTED", "YOUTUBE:POSTING"]);

    // Nothing posted yet → revision is the wrong tool; partly posted → allowed.
    const fresh = await newContent();
    const fv = await version(fresh, "F");
    await approve(fresh, fv);
    await expect(startRevision(M, { contentId: fresh, reason: "too early" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(reopenForChanges(M, { contentId: id, versionId: v1, reason: "posted already" })).rejects.toMatchObject({ code: "CONFLICT" });

    await startRevision(A, { contentId: id, reason: "Wrong logo on the posted one" });
    expect(await PostingModel.find({ contentVersionId: v1 }).sort({ platform: 1 }).lean()).toEqual(v1Before);
    expect((await content(id))!.revisions[0]).toMatchObject({ previousStatus: "READY_TO_POST" });
    const v2 = await version(id, "V2");
    await approve(id, v2);
    const ws = await getPostingWorkspace(U, id);
    expect(ws.platforms.map((p) => `${p.platform}:${p.state}`)).toEqual(["INSTAGRAM:PENDING", "YOUTUBE:PENDING"]); // V2 starts fresh
    await post(id, v2, "INSTAGRAM", "https://www.instagram.com/p/v2a/");
    await post(id, v2, "YOUTUBE", "https://youtu.be/v2a");
    expect((await content(id))!.status).toBe("COMPLETED");
    expect(await PostingModel.find({ contentVersionId: v1 }).sort({ platform: 1 }).lean()).toEqual(v1Before);
  });

  it("only ADMIN/MANAGER can start one; reason required; retries don't duplicate", async () => {
    const { id } = await completedV1();
    await expect(startRevision(D, { contentId: id, reason: "staff try" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startRevision(C, { contentId: id, reason: "client try" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    as(dev);
    expect(await startRevisionAction({ contentId: id, reason: "x-x-x" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    as(manager);
    expect(await startRevisionAction({ contentId: id, reason: "" })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    for (const extra of [{ versionId: new Types.ObjectId().toString() }, { status: "CHANGES_REQUESTED" }, { agencyId: new Types.ObjectId().toString() }]) {
      expect(await startRevisionAction({ contentId: id, reason: "valid reason", ...extra } as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect(await startRevisionAction({ contentId: id, reason: "New season pricing" })).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(await startRevisionAction({ contentId: id, reason: "New season pricing" })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    const c = await content(id);
    expect(c!.revisions).toHaveLength(1);
    expect(await ActivityLogModel.countDocuments({ action: "content.post_publication_revision_started", "entity.id": new Types.ObjectId(id) })).toBe(1);
    expect(await NotificationModel.countDocuments({ type: "CHANGES_REQUESTED_INTERNAL", recipientUserId: dev.id, contentId: new Types.ObjectId(id) })).toBe(1);
  });

  it("archived content / brands can't be revised", async () => {
    const { id } = await completedV1();
    await archiveBrand(A, brandX);
    await expect(startRevision(A, { contentId: id, reason: "archived brand" })).rejects.toMatchObject({ code: "CONFLICT" });
    await reactivateBrand(A, brandX);
    await archiveContent(A, id);
    await expect(startRevision(A, { contentId: id, reason: "archived content" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("the client sees a client-safe 'changes in progress' and then only the new version", async () => {
    const { id } = await completedV1();
    await startRevision(M, { contentId: id, reason: "INTERNAL-REVISION-REASON" });
    const review = await getClientReview(C, id);
    expect(review).toMatchObject({ state: "CHANGES", statusLabel: "Changes in progress", canDecide: false, posts: [] });
    const json = JSON.stringify(review);
    for (const s of ["INTERNAL-REVISION-REASON", "INTERNAL-NOTE", "INTERNAL-OK", "Mona", "Uma", "revision", "uploader"]) expect(json).not.toContain(s);
    const notes = await NotificationModel.find({ recipientUserId: client.id, contentId: new Types.ObjectId(id), type: "CONTENT_BEING_REVISED" }).lean();
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes)).not.toContain("INTERNAL-REVISION-REASON");

    const v2 = await version(id, "V2 for the client");
    await submitForInternalReview(D, { contentId: id, versionId: v2 });
    await decideInternalReview(M, { contentId: id, versionId: v2, decision: "APPROVED", comment: null });
    const awaiting = await getClientReview(C, id);
    expect(awaiting).toMatchObject({ state: "AWAITING", canDecide: true, version: { versionNumber: 2, caption: "V2 for the client" } });
    expect(awaiting.history.map((h) => h.versionNumber)).toEqual([1]); // their V1 approval stays in their history
  });

  it("internal review state exposes the revision history", async () => {
    const { id } = await completedV1();
    await startRevision(M, { contentId: id, reason: "Refresh for Diwali" });
    const s = await getReviewState(D, id);
    expect(s.changeRequest).toMatchObject({ revision: 1, comment: "Refresh for Diwali" });
    expect(s.revisions).toEqual([expect.objectContaining({ number: 1, reason: "Refresh for Diwali", fromVersionNumber: 1, previousStatus: "COMPLETED" })]);
  });

  it("the creator's task completes when they submit for review and reopens when changes are requested", async () => {
    const id = await newContent();
    const task = () => ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
    const v1 = await version(id, "V1");
    await submitForInternalReview(D, { contentId: id, versionId: v1 });
    expect(await task()).toMatchObject({ status: "COMPLETED", completedAt: expect.any(Date), startedAt: expect.any(Date) });
    await decideInternalReview(M, { contentId: id, versionId: v1, decision: "CHANGES_REQUESTED", comment: "Brighter please" });
    expect(await task()).toMatchObject({ status: "TODO", completedAt: null });
    const v2 = await version(id, "V2");
    await submitForInternalReview(D, { contentId: id, versionId: v2 });
    expect((await task())!.status).toBe("COMPLETED");
  });

  it("the content activity timeline covers related records and is ops-only", async () => {
    const { id } = await completedV1();
    await startRevision(M, { contentId: id, reason: "Refresh for Diwali" });
    const rows = await getContentActivity(A, id);
    const labels = rows.map((r) => r.label);
    for (const l of ["Content created", "Version added", "Client approved", "Platform posted", "New revision started"]) expect(labels).toContain(l);
    expect(rows[0]!.label).toBe("New revision started"); // newest first
    expect(rows.find((r) => r.label === "New revision started")).toMatchObject({ actorName: "Mona Manager", detail: expect.stringContaining("Refresh for Diwali") });
    await expect(getContentActivity(M, id)).resolves.toHaveLength(rows.length);
    for (const who of [D, U, C]) await expect(getContentActivity(who, id)).rejects.toThrow();
  });
});
