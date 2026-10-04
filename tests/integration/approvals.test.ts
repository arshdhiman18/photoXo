import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import {
  decideClientReviewAction,
  decideInternalReviewAction,
  recordClientApprovalAction,
  submitForReviewAction,
} from "@/features/approvals/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  AgencyModel,
  ApprovalModel,
  ContentModel,
  ProductionTaskModel,
} from "@/server/db/models";
import { approvalsRepo } from "@/server/repositories/approvals.repo";
import {
  decideClientReview,
  decideInternalReview,
  getClientReview,
  getReviewState,
  listClientApprovals,
  listRecentDecisions,
  listReviewQueues,
  recordClientApprovalOnBehalf,
  submitForInternalReview,
} from "@/server/services/approvals.service";
import { addMember } from "@/server/services/brand-team.service";
import { createBrand } from "@/server/services/brands.service";
import { cancelContent, createBrief, getContentForClient } from "@/server/services/content.service";
import { assignTask } from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, dev: TestUser, otherDev: TestUser, outsider: TestUser;
let client: TestUser, clientB: TestUser, foreignAdmin: TestUser;
let A: Actor, M: Actor, D: Actor, OD: Actor, OUT: Actor, C: Actor, CB: Actor, F: Actor;
let brandX: string, brandY: string, foreignBrand: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

const SECRET = {
  notes: "INTERNAL-NOTES-SECRET",
  brief: "BRIEF-SECRET",
  internalComment: "INTERNAL-COMMENT-SECRET",
  adminNote: "WHATSAPP-NOTE-SECRET",
  changeNote: "CHANGE-NOTE-SECRET",
};

/** Graphic (DESIGN route) content with its DESIGN task assigned to `dev`. */
async function newContent(brandId = brandX, actor = A, assignee: TestUser | null = dev, targetPlatforms: string[] = ["INSTAGRAM"]) {
  const { id } = await createBrief(actor, {
    brandId,
    title: "Diwali offer graphic",
    description: SECRET.brief,
    notes: SECRET.notes,
    contentType: "GRAPHIC",
    origin: "ADMIN_BRIEF",
    priority: "NORMAL",
    dueDate: null,
    referenceIds: [],
    referenceUrl: null,
    targetPlatforms,
  } as never);
  if (assignee) {
    const task = await ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
    await assignTask(actor, String(task!._id), assignee.id);
  }
  return id;
}

const addVersion = async (contentId: string, actor = D) =>
  (
    await createVersion(actor, {
      contentId,
      links: [{ url: "https://www.canva.com/design/abc/view", label: "Final" }],
      caption: "Light up this Diwali ✨",
      hashtags: ["diwali", "offer"],
      changeNote: SECRET.changeNote,
    } as never)
  ).id;

const submit = (contentId: string, versionId: string, actor = D) =>
  submitForInternalReview(actor, { contentId, versionId });
const internal = (contentId: string, versionId: string, decision: "APPROVED" | "CHANGES_REQUESTED" = "APPROVED", comment: string | null = null, actor = M) =>
  decideInternalReview(actor, { contentId, versionId, decision, comment });
const clientDecide = (contentId: string, versionId: string, decision: "APPROVED" | "CHANGES_REQUESTED" = "APPROVED", comment: string | null = null, actor = C) =>
  decideClientReview(actor, { contentId, versionId, decision, comment });
const content = (id: string) => ContentModel.findById(id).lean();

/** Content with V1 sitting in CLIENT_REVIEW. */
async function inClientReview() {
  const id = await newContent();
  const v1 = await addVersion(id);
  await submit(id, v1);
  await internal(id, v1, "APPROVED", SECRET.internalComment);
  return { id, v1 };
}

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Mona Manager");
  dev = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Dev Designer");
  otherDev = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Otto Designer");
  outsider = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Olga Outsider");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  clientB = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Bea Client");
  for (const u of [admin, manager, dev, otherDev, outsider, client, clientB]) cookies[u.id] = await signIn(u);
  [M, D, OD, OUT, C, CB] = (await Promise.all([manager, dev, otherDev, outsider, client, clientB].map(actorOf))) as Actor[] as [Actor, Actor, Actor, Actor, Actor, Actor];

  brandX = (await createBrand(A, { name: "Xylo", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  brandY = (await createBrand(A, { name: "Yara", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  await addMember(A, { brandId: brandX, userId: dev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: otherDev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandY, userId: outsider.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: client.id, role: BrandRole.CLIENT });
  await addMember(A, { brandId: brandY, userId: clientB.id, role: BrandRole.CLIENT });

  const other = await AgencyModel.create({ name: "Agency B", slug: "agency-b-appr", timezone: "UTC", currency: "USD" });
  foreignAdmin = await createActiveUser(String(other._id), SystemRole.ADMIN, "Foreign Admin");
  F = await actorOf(foreignAdmin);
  foreignBrand = (await createBrand(F, { name: "Foreign", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

// ── Workflow ──────────────────────────────────────────────────────────────
describe("approval workflow", () => {
  it("V1: submit → internal approve → client approve → READY_TO_POST (never posted/completed)", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    expect((await content(id))!.status).toBe("IN_PRODUCTION");

    await submit(id, v1);
    let c = await content(id);
    expect(c).toMatchObject({ status: "INTERNAL_REVIEW", internalApprovedVersionId: null });
    expect(String(c!.reviewSubmission!.versionId)).toBe(v1);
    expect(String(c!.reviewSubmission!.submittedBy)).toBe(dev.id);

    await internal(id, v1, "APPROVED", "Looks great");
    c = await content(id);
    expect(c!.status).toBe("CLIENT_REVIEW");
    expect(String(c!.internalApprovedVersionId)).toBe(v1);

    await clientDecide(id, v1, "APPROVED", "Love it");
    c = await content(id);
    expect(c!.status).toBe("READY_TO_POST");
    expect(String(c!.clientApprovedVersionId)).toBe(v1);
    expect(c!.readyToPostAt).toBeInstanceOf(Date);

    const records = await ApprovalModel.find({ contentId: id }).sort({ decidedAt: 1 }).lean();
    expect(records.map((r) => [r.stage, r.decision, r.source, String(r.contentVersionId)])).toEqual([
      ["INTERNAL", "APPROVED", "REVIEWER", v1],
      ["CLIENT", "APPROVED", "CLIENT_USER", v1],
    ]);
    expect(String(records[0]!.decidedBy)).toBe(manager.id);
    expect(String(records[1]!.decidedBy)).toBe(client.id);

    const actions = (await ActivityLogModel.find({ $or: [{ "entity.id": new Types.ObjectId(id) }, { "meta.contentId": id }] }).lean()).map((l) => l.action);
    for (const a of [
      "approval.submitted_for_internal_review",
      "approval.internal_approved",
      "approval.submitted_for_client_review",
      "approval.client_approved",
    ]) {
      expect(actions).toContain(a);
    }
  });

  it("internal changes requested → new version → resubmit → internal review again", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    await internal(id, v1, "CHANGES_REQUESTED", "Logo too small");
    let c = await content(id);
    expect(c!.status).toBe("CHANGES_REQUESTED");
    expect(c!.changesRequestedBy).toMatchObject({ stage: "INTERNAL", versionNumber: 1, comment: "Logo too small" });
    expect(String(c!.changesRequestedBy!.decidedBy)).toBe(manager.id);
    expect(c!.clientChangesPending).toBe(false);

    // The reviewed version can't simply be resubmitted; no version is created automatically.
    await expect(submit(id, v1)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(c!.versionCount).toBe(1);

    const v2 = await addVersion(id);
    await submit(id, v2);
    c = await content(id);
    expect(c!.status).toBe("INTERNAL_REVIEW");
    expect(String(c!.reviewSubmission!.versionId)).toBe(v2);
    await internal(id, v2);
    expect((await content(id))!.status).toBe("CLIENT_REVIEW");
  });

  it("client changes requested → V2 must pass internal review again → client approves V2", async () => {
    const { id, v1 } = await inClientReview();
    await clientDecide(id, v1, "CHANGES_REQUESTED", "Make it warmer");
    let c = await content(id);
    expect(c).toMatchObject({ status: "CHANGES_REQUESTED", clientChangesPending: true });
    expect(c!.changesRequestedBy).toMatchObject({ stage: "CLIENT", source: "CLIENT_USER", versionNumber: 1 });

    // Client still sees it — as "Changes in progress".
    let inbox = await listClientApprovals(C);
    expect(inbox.changes.map((i) => i.id)).toContain(id);

    const v2 = await addVersion(id);
    await submit(id, v2);
    c = await content(id);
    expect(c!.status).toBe("INTERNAL_REVIEW");
    expect(c!.internalApprovedVersionId).toBeNull(); // V1's internal approval does not carry over
    // No skipping the internal gate: the client can't decide V2 (or V1) now.
    await expect(clientDecide(id, v2)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(clientDecide(id, v1)).rejects.toMatchObject({ code: "CONFLICT" });
    const review = await getClientReview(C, id);
    expect(review).toMatchObject({ state: "CHANGES", statusLabel: "Changes in progress", canDecide: false });
    expect(review.version?.versionNumber).toBe(1);
    inbox = await listClientApprovals(C);
    expect(inbox.changes.map((i) => i.id)).toContain(id);

    await internal(id, v2);
    expect((await content(id))!.clientChangesPending).toBe(false);
    expect((await getClientReview(C, id)).version?.versionNumber).toBe(2);
    await clientDecide(id, v2, "APPROVED");
    c = await content(id);
    expect(c!.status).toBe("READY_TO_POST");
    expect(String(c!.clientApprovedVersionId)).toBe(v2);
    expect(String(c!.internalApprovedVersionId)).toBe(v2);

    // V1 keeps its own history; V2 has its own.
    const byVersion = async (v: string) =>
      (await ApprovalModel.find({ contentVersionId: v }).sort({ decidedAt: 1 }).lean()).map((r) => `${r.stage}:${r.decision}`);
    expect(await byVersion(v1)).toEqual(["INTERNAL:APPROVED", "CLIENT:CHANGES_REQUESTED"]);
    expect(await byVersion(v2)).toEqual(["INTERNAL:APPROVED", "CLIENT:APPROVED"]);
  });

  it("internal approval requires the target platforms to be set", async () => {
    const id = await newContent(brandX, A, dev, []);
    const v1 = await addVersion(id);
    await submit(id, v1);
    await expect(internal(id, v1)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("platforms") });
    expect(await ApprovalModel.countDocuments({ contentId: id })).toBe(0);
    await internal(id, v1, "CHANGES_REQUESTED", "Fine to request changes without platforms");
  });

  it("a change request needs a comment; approval comments are optional", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    as(manager);
    const res = await decideInternalReviewAction({ contentId: id, versionId: v1, decision: "CHANGES_REQUESTED", comment: "" });
    expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION", fieldErrors: { comment: expect.any(Array) } } });
    expect(await decideInternalReviewAction({ contentId: id, versionId: v1, decision: "APPROVED" })).toMatchObject({ ok: true });
  });

  it("queues and recent decisions reflect the workflow", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    let q = await listReviewQueues(M);
    expect(q.internal.map((i) => i.id)).toContain(id);
    expect(q.internal.find((i) => i.id === id)?.versionNumber).toBe(1);
    await internal(id, v1, "CHANGES_REQUESTED", "Fix spelling");
    q = await listReviewQueues(M, { brandId: brandX });
    expect(q.changes.find((i) => i.id === id)?.changeRequest).toMatchObject({ stage: "INTERNAL", comment: "Fix spelling" });
    const recent = await listRecentDecisions(M, { stage: "INTERNAL", decision: "CHANGES_REQUESTED" });
    expect(recent.find((r) => r.content.id === id)).toMatchObject({ comment: "Fix spelling", version: { number: 1 } });
    await expect(listReviewQueues(D)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── Version safety ────────────────────────────────────────────────────────
describe("version safety", () => {
  it("cannot submit without a version, or submit an old version", async () => {
    const id = await newContent();
    await expect(submit(id, new Types.ObjectId().toString())).rejects.toMatchObject({ code: "CONFLICT" });
    const v1 = await addVersion(id);
    const v2 = await addVersion(id);
    await expect(submit(id, v1)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("newer version") });
    await submit(id, v2);
    await expect(submit(id, v2)).rejects.toMatchObject({ code: "CONFLICT" }); // already in review
  });

  it("no new versions while a version is under review (the reviewed version can't be swapped)", async () => {
    const { id } = await inClientReview();
    await expect(addVersion(id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses nonexistent, old, and other content's versions", async () => {
    const other = await newContent();
    const otherV = await addVersion(other);
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    await internal(id, v1, "CHANGES_REQUESTED", "Again");
    const v2 = await addVersion(id);
    await submit(id, v2);

    await expect(internal(id, new Types.ObjectId().toString())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(internal(id, v1)).rejects.toMatchObject({ code: "CONFLICT" }); // obsolete version
    await expect(internal(id, otherV)).rejects.toMatchObject({ code: "CONFLICT" }); // another content's version
    expect(await ApprovalModel.countDocuments({ contentId: id, contentVersionId: v2 })).toBe(0);
    await internal(id, v2);
    await expect(internal(id, v2)).rejects.toMatchObject({ code: "CONFLICT" }); // decided twice / wrong state
  });

  it("an internal approval of V1 never approves V2 at any gate", async () => {
    const { id, v1 } = await inClientReview();
    await clientDecide(id, v1, "CHANGES_REQUESTED", "Different colours");
    const v2 = await addVersion(id);
    await submit(id, v2);
    const c = await content(id);
    expect(c!.internalApprovedVersionId).toBeNull();
    expect(c!.clientApprovedVersionId).toBeNull();
    // Even an admin recording a client approval cannot skip V2's internal review.
    await expect(recordClientApprovalOnBehalf(A, { contentId: id, versionId: v2, note: "Client OK'd on call" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancelled content leaves review and cannot be decided", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    await cancelContent(A, id, "Campaign dropped");
    await expect(internal(id, v1)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ── Permissions ───────────────────────────────────────────────────────────
describe("permissions", () => {
  it("only managers or the assigned creator can submit", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await expect(submit(id, v1, OD)).rejects.toMatchObject({ code: "FORBIDDEN" }); // same brand, not assigned
    await expect(submit(id, v1, OUT)).rejects.toMatchObject({ code: "NOT_FOUND" }); // other brand
    await submit(id, v1, M);
    expect((await content(id))!.status).toBe("INTERNAL_REVIEW");
  });

  it("staff cannot approve internally or as the client", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    await expect(internal(id, v1, "APPROVED", null, D)).rejects.toMatchObject({ code: "FORBIDDEN" });
    as(dev);
    expect(await decideInternalReviewAction({ contentId: id, versionId: v1, decision: "APPROVED" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await internal(id, v1);
    expect(await decideClientReviewAction({ contentId: id, versionId: v1, decision: "APPROVED" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(clientDecide(id, v1, "APPROVED", null, D)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await content(id))!.status).toBe("CLIENT_REVIEW");
  });

  it("clients cannot decide the internal gate or submit", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    as(client);
    expect(await submitForReviewAction({ contentId: id, versionId: v1 })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await submit(id, v1);
    expect(await decideInternalReviewAction({ contentId: id, versionId: v1, decision: "APPROVED" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(internal(id, v1, "APPROVED", null, C)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // …and can't see content that is in internal review.
    await expect(getContentForClient(C, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getClientReview(C, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clients cannot see or decide another brand's content", async () => {
    const { id, v1 } = await inClientReview();
    await expect(getClientReview(CB, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(clientDecide(id, v1, "APPROVED", null, CB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listClientApprovals(CB)).awaiting.map((i) => i.id)).not.toContain(id);
    expect((await content(id))!.status).toBe("CLIENT_REVIEW");
  });

  it("admin can record an external client approval — clearly marked, note required", async () => {
    const { id, v1 } = await inClientReview();
    as(admin);
    const missing = await recordClientApprovalAction({ contentId: id, versionId: v1, note: "" });
    expect(missing).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await recordClientApprovalAction({ contentId: id, versionId: v1, note: SECRET.adminNote })).toMatchObject({ ok: true });

    const c = await content(id);
    expect(c!.status).toBe("READY_TO_POST");
    expect(String(c!.clientApprovedVersionId)).toBe(v1);
    const rec = await ApprovalModel.findOne({ contentId: id, stage: "CLIENT" }).lean();
    expect(rec).toMatchObject({ decision: "APPROVED", source: "RECORDED_BY_ADMIN", comment: SECRET.adminNote, commentVisibility: "INTERNAL" });
    expect(String(rec!.decidedBy)).toBe(admin.id); // never the client
    const log = await ActivityLogModel.findOne({ action: "approval.client_decision_recorded_by_admin", "entity.id": rec!._id }).lean();
    expect(String(log!.actorId)).toBe(admin.id);

    const seen = await getClientReview(C, id);
    expect(seen.history[0]).toMatchObject({ recordedByTeam: true, comment: null, decision: "APPROVED" });
    expect(seen.history[0]!.byLabel).toMatch(/recorded on your behalf/);
  });

  it("managers cannot record client approvals on a client's behalf", async () => {
    const { id, v1 } = await inClientReview();
    as(manager);
    expect(await recordClientApprovalAction({ contentId: id, versionId: v1, note: "Client said yes" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(recordClientApprovalOnBehalf(M, { contentId: id, versionId: v1, note: "Client said yes" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await content(id))!.status).toBe("CLIENT_REVIEW");
  });

  it("managers review any brand of their agency but nothing of another agency", async () => {
    const own = await newContent(brandY, A, null);
    const v = await addVersion(own, A);
    await submit(own, v, M);
    await internal(own, v, "APPROVED", null, M);
    const foreign = await newContent(foreignBrand, F, null);
    const fv = await addVersion(foreign, F);
    await expect(submit(foreign, fv, M)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await submitForInternalReview(F, { contentId: foreign, versionId: fv });
    await expect(internal(foreign, fv, "APPROVED", null, M)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getReviewState(M, foreign)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── Security ──────────────────────────────────────────────────────────────
describe("security", () => {
  it("cross-agency and cross-brand content ids are not found", async () => {
    const foreign = await newContent(foreignBrand, F, null);
    const fv = await addVersion(foreign, F);
    await expect(submit(foreign, fv, A)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await submitForInternalReview(F, { contentId: foreign, versionId: fv });
    await expect(internal(foreign, fv, "APPROVED", null, A)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getClientReview(C, foreign)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ApprovalModel.countDocuments({ contentId: foreign })).toBe(0);
  });

  it("a foreign version id can't be smuggled into another content's review", async () => {
    const foreign = await newContent(foreignBrand, F, null);
    const fv = await addVersion(foreign, F);
    const id = await newContent();
    const v1 = await addVersion(id);
    await expect(submit(id, fv)).rejects.toMatchObject({ code: "CONFLICT" });
    await submit(id, v1);
    await expect(internal(id, fv)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("tampered ids and injected identity/scope/state fields are rejected before anything changes", async () => {
    const { id, v1 } = await inClientReview();
    as(client);
    expect(await decideClientReviewAction({ contentId: id, versionId: "not-an-id", decision: "APPROVED" })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    for (const extra of [
      { decidedBy: admin.id },
      { userId: admin.id },
      { agencyId: foreignAdmin.agencyId },
      { brandId: brandY },
      { stage: "INTERNAL" },
      { status: "READY_TO_POST" },
      { source: "RECORDED_BY_ADMIN" },
    ]) {
      const res = await decideClientReviewAction({ contentId: id, versionId: v1, decision: "APPROVED", ...extra } as never);
      expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect((await content(id))!.status).toBe("CLIENT_REVIEW");
    expect(await ApprovalModel.countDocuments({ contentId: id, stage: "CLIENT" })).toBe(0);

    expect(await decideClientReviewAction({ contentId: id, versionId: v1, decision: "APPROVED" })).toMatchObject({ ok: true });
    const rec = await ApprovalModel.findOne({ contentId: id, stage: "CLIENT" }).lean();
    expect(String(rec!.decidedBy)).toBe(client.id);
    expect(String(rec!.agencyId)).toBe(admin.agencyId);
    expect(String(rec!.brandId)).toBe(brandX);
  });

  it("clients only ever read CLIENT-gate approval records", async () => {
    const { id } = await inClientReview();
    const mine = await approvalsRepo.find(C, { contentId: new Types.ObjectId(id) });
    expect(mine).toEqual([]); // only an INTERNAL record exists so far
    const all = await approvalsRepo.find(C, { stage: "INTERNAL" });
    expect(all).toEqual([]);
    await expect(getReviewState(C, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── History & atomicity ───────────────────────────────────────────────────
describe("history", () => {
  it("approval records are immutable", async () => {
    const { id } = await inClientReview();
    const rec = await ApprovalModel.findOne({ contentId: id });
    await expect(ApprovalModel.updateOne({ _id: rec!._id }, { $set: { decision: "CHANGES_REQUESTED" } })).rejects.toThrow(/append-only/);
    await expect(ApprovalModel.findOneAndUpdate({ _id: rec!._id }, { $set: { comment: "x" } })).rejects.toThrow(/append-only/);
    await expect(ApprovalModel.deleteOne({ _id: rec!._id })).rejects.toThrow(/append-only/);
    await expect(ApprovalModel.deleteMany({ contentId: id })).rejects.toThrow(/append-only/);
    rec!.comment = "rewritten";
    await expect(rec!.save()).rejects.toThrow(/append-only/);
    expect((await ApprovalModel.findById(rec!._id).lean())!.comment).toBe(SECRET.internalComment);
  });

  it("a failed decision rolls back the approval, the content status and the audit", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    await submit(id, v1);
    const logsBefore = await ActivityLogModel.countDocuments();
    const create = ActivityLogModel.create.bind(ActivityLogModel);
    // Let the status-change audit succeed, then fail the decision audit.
    const spy = vi
      .spyOn(ActivityLogModel, "create")
      .mockImplementationOnce(create as never)
      .mockRejectedValueOnce(new Error("audit store down"));
    await expect(internal(id, v1)).rejects.toThrow("audit store down");
    spy.mockRestore();
    const c = await content(id);
    expect(c).toMatchObject({ status: "INTERNAL_REVIEW", internalApprovedVersionId: null });
    expect(await ApprovalModel.countDocuments({ contentId: id })).toBe(0);
    expect(await ActivityLogModel.countDocuments()).toBe(logsBefore);
  });

  it("a failed submission rolls back status and audit", async () => {
    const id = await newContent();
    const v1 = await addVersion(id);
    const spy = vi.spyOn(ActivityLogModel, "create").mockRejectedValueOnce(new Error("audit store down"));
    await expect(submit(id, v1)).rejects.toThrow("audit store down");
    spy.mockRestore();
    const c = await content(id);
    expect(c).toMatchObject({ status: "IN_PRODUCTION", reviewSubmission: null });
  });

  it("internal users see the full history; review state exposes capabilities per role", async () => {
    const { id, v1 } = await inClientReview();
    await clientDecide(id, v1, "CHANGES_REQUESTED", "Warmer please");
    const staffView = await getReviewState(D, id);
    expect(staffView.history.map((h) => `${h.stage}:${h.decision}`)).toEqual(["CLIENT:CHANGES_REQUESTED", "INTERNAL:APPROVED"]);
    expect(staffView.changeRequest).toMatchObject({ stage: "CLIENT", comment: "Warmer please", versionNumber: 1 });
    expect(staffView).toMatchObject({ canDecideInternal: false, canRecordClientApproval: false, canSubmit: null });
    expect(staffView.submitHint).toMatch(/already been reviewed/);
    const v2 = await addVersion(id);
    expect((await getReviewState(D, id)).canSubmit).toEqual({ versionId: v2, versionNumber: 2 });
    expect((await getReviewState(OD, id)).canSubmit).toBeNull(); // not the assigned creator
  });
});

// ── Client serializer ─────────────────────────────────────────────────────
describe("client responses", () => {
  it("contain nothing internal", async () => {
    const { id, v1 } = await inClientReview();
    await clientDecide(id, v1, "CHANGES_REQUESTED", "CLIENT-VISIBLE-COMMENT");
    const v2 = await addVersion(id);
    await submit(id, v2);
    await internal(id, v2, "APPROVED", SECRET.internalComment);
    await recordClientApprovalOnBehalf(A, { contentId: id, versionId: v2, note: SECRET.adminNote });

    const payloads = [
      JSON.stringify(await getClientReview(C, id)),
      JSON.stringify(await listClientApprovals(C)),
      JSON.stringify(await getContentForClient(C, id)),
    ];
    for (const json of payloads) {
      for (const secret of Object.values(SECRET)) expect(json).not.toContain(secret);
      for (const name of ["Dev Designer", "Mona Manager", "Ada Admin", dev.email, manager.email, admin.email]) {
        expect(json).not.toContain(name);
      }
      for (const key of ['"notes"', '"description"', '"tasks"', '"shoot', '"route"', '"code"', '"createdBy"', '"changeNote"', '"expense', '"activity', '"uploader', '"stage"', '"source"', '"commentVisibility"', '"email"']) {
        expect(json).not.toContain(key);
      }
    }
    const review = await getClientReview(C, id);
    expect(review.version).toMatchObject({ versionNumber: 2, caption: "Light up this Diwali ✨", hashtags: ["diwali", "offer"] });
    expect(review.history.map((h) => [h.decision, h.comment])).toEqual([
      ["APPROVED", null],
      ["CHANGES_REQUESTED", "CLIENT-VISIBLE-COMMENT"],
    ]);
    expect(review.history[1]!.byLabel).toBe("You");
  });

  it("the client inbox separates awaiting, changes requested and approved", async () => {
    const awaiting = await inClientReview();
    const changes = await inClientReview();
    await clientDecide(changes.id, changes.v1, "CHANGES_REQUESTED", "Shorter");
    const approved = await inClientReview();
    await clientDecide(approved.id, approved.v1, "APPROVED");
    const inbox = await listClientApprovals(C);
    expect(inbox.awaiting.map((i) => i.id)).toContain(awaiting.id);
    expect(inbox.changes.map((i) => i.id)).toContain(changes.id);
    expect(inbox.approved.map((i) => i.id)).toContain(approved.id);
    expect(inbox.approved.find((i) => i.id === approved.id)?.statusLabel).toBe("Approved");
    // Internal change requests are invisible to the client.
    const internalOnly = await newContent();
    const v = await addVersion(internalOnly);
    await submit(internalOnly, v);
    await internal(internalOnly, v, "CHANGES_REQUESTED", "Not yet");
    const after = await listClientApprovals(C);
    expect([...after.awaiting, ...after.changes, ...after.approved].map((i) => i.id)).not.toContain(internalOnly);
  });
});
