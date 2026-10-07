import type * as CloudinaryModule from "@/server/media/cloudinary";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// Cloudinary is mocked at the network boundary: we test OUR authorisation,
// verification and storage logic, not Cloudinary itself.
const cloud = vi.hoisted(() => ({ resources: new Map<string, Record<string, unknown>>() }));
vi.mock("@/server/media/cloudinary", async (orig) => {
  const actual = await orig<typeof CloudinaryModule>();
  return {
    ...actual,
    isCloudinaryConfigured: () => true,
    getCloudinaryConfig: () => ({ cloudName: "demo", apiKey: "k", apiSecret: "s" }),
    signedUploadParams: (o: { publicId: string; resourceType: string }) => ({
      uploadUrl: `https://api.cloudinary.com/v1_1/demo/${o.resourceType}/upload`,
      fields: { public_id: o.publicId, timestamp: 1, type: "authenticated", api_key: "k", signature: "sig" },
    }),
    signedDeliveryUrl: (o: { publicId: string; format: string; transformation?: string }) =>
      `https://res.cloudinary.com/demo/image/authenticated/s--sig--/${[o.transformation, `${o.publicId}.${o.format}`].filter(Boolean).join("/")}`,
    fetchResource: async (publicId: string) => cloud.resources.get(publicId) ?? null,
  };
});

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import { createUploadIntentAction, finalizeUploadAction } from "@/features/media/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import { ActivityLogModel, AssetModel, ContentModel, ProductionTaskModel, UploadIntentModel } from "@/server/db/models";
import { mediaRetentionCandidates } from "@/server/repositories/media.repo";
import { decideInternalReview, getClientReview, submitForInternalReview } from "@/server/services/approvals.service";
import { addMember } from "@/server/services/brand-team.service";
import { createBrand } from "@/server/services/brands.service";
import { archiveContent, cancelContent, createBrief, getContentForAdmin } from "@/server/services/content.service";
import { createExpense, getExpense } from "@/server/services/expenses.service";
import { createUploadIntent, finalizeUpload } from "@/server/services/media.service";
import { assignTask } from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import { createExpenseSchema } from "@/features/expenses/schemas";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, dev: TestUser, other: TestUser, client: TestUser;
let A: Actor, D: Actor, O: Actor, C: Actor;
let brandX: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

async function newContent() {
  const { id } = await createBrief(A, {
    brandId: brandX, title: "Teaser", description: null, notes: null, contentType: "GRAPHIC", origin: "ADMIN_BRIEF",
    priority: "NORMAL", dueDate: null, referenceIds: [], referenceUrl: null, targetPlatforms: ["INSTAGRAM"],
  } as never);
  const task = await ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
  await assignTask(A, String(task!._id), dev.id);
  return id;
}

/** Simulate the browser's direct upload: Cloudinary now holds a resource under the intent's public id. */
async function upload(actor: Actor, purpose: "VERSION_MEDIA" | "RECEIPT" | "BRAND_LOGO", contentId: string | null, mimeType = "image/png", format = "png") {
  const intent = await createUploadIntent(actor, { purpose, contentId, filename: "frame.png", mimeType, bytes: 2048 });
  const publicId = String(intent.fields.public_id);
  cloud.resources.set(publicId, { public_id: publicId, resource_type: mimeType.startsWith("video") ? "video" : "image", type: "authenticated", format, bytes: 2048, width: 1080, height: 1350, version: 1 });
  return { intent, publicId };
}

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  dev = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Dev Designer");
  other = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Otto Other");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  for (const u of [admin, dev, other, client]) cookies[u.id] = await signIn(u);
  [D, O, C] = (await Promise.all([dev, other, client].map(actorOf))) as [Actor, Actor, Actor];
  brandX = (await createBrand(A, { name: "Xylo", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  await addMember(A, { brandId: brandX, userId: dev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: other.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: client.id, role: BrandRole.CLIENT });
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

describe("uploads", () => {
  it("assigned creator: intent → upload → finalize → version; metadata recorded, audited", async () => {
    const id = await newContent();
    const { intent, publicId } = await upload(D, "VERSION_MEDIA", id);
    expect(publicId).toMatch(new RegExp(`^photoxo/${admin.agencyId}/${brandX}/[a-f0-9]{24}$`)); // server-chosen
    const done = await finalizeUpload(D, intent.intentId);
    const asset = await AssetModel.findById(done.assetId).lean();
    expect(asset).toMatchObject({ storage: "MEDIA", kind: "CREATION", originalFilename: "frame.png", versionId: null });
    expect(asset!.media).toMatchObject({ provider: "CLOUDINARY", publicId, format: "png", bytes: 2048, width: 1080, height: 1350 });
    expect(String(asset!.contentId)).toBe(id);
    expect(String(asset!.createdBy)).toBe(dev.id);
    expect(await ActivityLogModel.countDocuments({ action: "asset.media_uploaded", "entity.id": asset!._id })).toBe(1);
    await expect(finalizeUpload(D, intent.intentId)).rejects.toMatchObject({ code: "NOT_FOUND" }); // single use

    const v = await createVersion(D, { contentId: id, links: [], assetIds: [done.assetId], caption: "c", hashtags: [], changeNote: null } as never);
    expect(String((await AssetModel.findById(done.assetId).lean())!.versionId)).toBe(v.id);
    const admin_ = await getContentForAdmin(A, id);
    expect(admin_.versions[0]!.assets[0]).toMatchObject({ kind: "MEDIA", mediaType: "image", format: "png" });
    expect(admin_.versions[0]!.assets[0]!.url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/authenticated\/s--/);
    // The same upload can't be reused for another version.
    await ContentModel.updateOne({ _id: id }, { $set: { status: "IN_PRODUCTION" } });
    await expect(createVersion(D, { contentId: id, links: [], assetIds: [done.assetId], caption: null, hashtags: [], changeNote: null } as never)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("only people who may add versions can upload; others' and cross-content uploads are refused", async () => {
    const id = await newContent();
    await expect(upload(O, "VERSION_MEDIA", id)).rejects.toMatchObject({ code: "FORBIDDEN" }); // same brand, not assigned
    as(client);
    expect(await createUploadIntentAction({ purpose: "VERSION_MEDIA", contentId: id, filename: "x.png", mimeType: "image/png", bytes: 10 })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    // Dev's upload can't be finalised by someone else, nor attached by someone else or to other content.
    const { intent } = await upload(D, "VERSION_MEDIA", id);
    await expect(finalizeUpload(A, intent.intentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const done = await finalizeUpload(D, intent.intentId);
    await expect(createVersion(A, { contentId: id, links: [], assetIds: [done.assetId], caption: null, hashtags: [], changeNote: null } as never)).rejects.toMatchObject({ code: "VALIDATION" });
    const other = await newContent();
    await expect(createVersion(D, { contentId: other, links: [], assetIds: [done.assetId], caption: null, hashtags: [], changeNote: null } as never)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createVersion(D, { contentId: id, links: [], assetIds: [new Types.ObjectId().toString()], caption: null, hashtags: [], changeNote: null } as never)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("client-supplied ids, types and sizes are never trusted", async () => {
    const id = await newContent();
    as(dev);
    for (const extra of [{ publicId: "evil/x" }, { url: "https://evil.example/x.png" }, { agencyId: new Types.ObjectId().toString() }, { userId: admin.id }]) {
      expect(await createUploadIntentAction({ purpose: "VERSION_MEDIA", contentId: id, filename: "x.png", mimeType: "image/png", bytes: 10, ...extra } as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect(await createUploadIntentAction({ purpose: "VERSION_MEDIA", contentId: id, filename: "x.exe", mimeType: "application/x-msdownload", bytes: 10 })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    await expect(createUploadIntent(D, { purpose: "VERSION_MEDIA", contentId: id, filename: "big.png", mimeType: "image/png", bytes: 999 * 1024 * 1024 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createUploadIntent(D, { purpose: "RECEIPT", contentId: null, filename: "r.mp4", mimeType: "video/mp4", bytes: 10 })).rejects.toMatchObject({ code: "VALIDATION" });
    // The stored resource must match: nothing uploaded → refused; wrong format → refused.
    const intent = await createUploadIntent(D, { purpose: "VERSION_MEDIA", contentId: id, filename: "a.png", mimeType: "image/png", bytes: 10 });
    await expect(finalizeUpload(D, intent.intentId)).rejects.toMatchObject({ code: "CONFLICT" });
    cloud.resources.set(String(intent.fields.public_id), { public_id: intent.fields.public_id, resource_type: "image", type: "authenticated", format: "gif", bytes: 10, version: 1 });
    await expect(finalizeUpload(D, intent.intentId)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await finalizeUploadAction({ intentId: "nope" } as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    // Expired intents are dead.
    await UploadIntentModel.updateOne({ _id: intent.intentId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    cloud.resources.set(String(intent.fields.public_id), { public_id: intent.fields.public_id, resource_type: "image", type: "authenticated", format: "png", bytes: 10, version: 1 });
    await expect(finalizeUpload(D, intent.intentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("receipt uploads attach only to the uploader's own expense and are visible only to them + approvers", async () => {
    const { intent } = await upload(D, "RECEIPT", null, "application/pdf", "pdf");
    const r = await finalizeUpload(D, intent.intentId);
    expect((await AssetModel.findById(r.assetId).lean())).toMatchObject({ kind: "RECEIPT", brandId: null });
    await expect(createExpense(O, createExpenseSchema.parse({ title: "Steal", category: "FOOD", amount: "10", incurredOn: "2026-10-01", receiptAssetId: r.assetId }))).rejects.toMatchObject({ code: "VALIDATION" });
    const e = await createExpense(D, createExpenseSchema.parse({ title: "Lunch", category: "FOOD", amount: "450", incurredOn: "2026-10-01", receiptAssetId: r.assetId }));
    expect((await getExpense(D, e.id)).receipt).toMatchObject({ kind: "MEDIA" });
    expect((await getExpense(A, e.id)).receipt?.url).toMatch(/authenticated\/s--/);
    await expect(getExpense(O, e.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("brand logos: ADMIN/MANAGER only, small images only; the brand gets a signed, resized URL", async () => {
    await expect(createUploadIntent(D, { purpose: "BRAND_LOGO", contentId: null, filename: "l.png", mimeType: "image/png", bytes: 2048 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createUploadIntent(A, { purpose: "BRAND_LOGO", contentId: null, filename: "l.mp4", mimeType: "video/mp4", bytes: 2048 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createUploadIntent(A, { purpose: "BRAND_LOGO", contentId: null, filename: "l.png", mimeType: "image/png", bytes: 6 * 1024 * 1024 })).rejects.toMatchObject({ code: "VALIDATION" });
    const { intent, publicId } = await upload(A, "BRAND_LOGO", null);
    expect(publicId).toMatch(/\/logos\//);
    const r = await finalizeUpload(A, intent.intentId);
    expect(r.logoUrl).toMatch(/authenticated\/s--sig--\/c_limit,w_256,h_256,q_auto\//);
    expect(await AssetModel.findById(r.assetId).lean()).toMatchObject({ kind: "LOGO", brandId: null });
    await createBrand(A, { name: "Logo Co", description: null, logoUrl: r.logoUrl, status: "ACTIVE", socialHandles: [] });
  });

  it("a MOV stored as compressed MP4 is accepted", async () => {
    const id = await newContent();
    const { intent } = await upload(D, "VERSION_MEDIA", id, "video/quicktime", "mp4");
    await expect(finalizeUpload(D, intent.intentId)).resolves.toMatchObject({ bytes: 2048 });
  });

  it("clients only see media of versions that passed internal review — and never internal file names", async () => {
    const id = await newContent();
    const { intent } = await upload(D, "VERSION_MEDIA", id);
    const done = await finalizeUpload(D, intent.intentId);
    const v = await createVersion(D, { contentId: id, links: [], assetIds: [done.assetId], caption: "c", hashtags: [], changeNote: null } as never);
    await submitForInternalReview(D, { contentId: id, versionId: v.id });
    await expect(getClientReview(C, id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // still internal
    await decideInternalReview(A, { contentId: id, versionId: v.id, decision: "APPROVED", comment: null });
    const review = await getClientReview(C, id);
    expect(review.version?.assets[0]).toMatchObject({ kind: "MEDIA", mediaType: "image", label: null });
    expect(JSON.stringify(review)).not.toContain("frame.png");
    expect(JSON.stringify(review)).not.toContain('"publicId"');
  });

  it("retention planning never selects active or current-version media (dry run, nothing deleted)", async () => {
    const id = await newContent();
    const a = await finalizeUpload(D, (await upload(D, "VERSION_MEDIA", id)).intent.intentId);
    const b = await finalizeUpload(D, (await upload(D, "VERSION_MEDIA", id)).intent.intentId);
    await createVersion(D, { contentId: id, links: [], assetIds: [a.assetId], caption: null, hashtags: [], changeNote: null } as never);
    await createVersion(D, { contentId: id, links: [], assetIds: [b.assetId], caption: null, hashtags: [], changeNote: null } as never); // current = b
    const agency = new Types.ObjectId(admin.agencyId);
    const later = new Date(Date.now() + 400 * 86_400_000);
    expect((await mediaRetentionCandidates(agency, later, 365)).map((x) => String(x._id))).not.toContain(a.assetId); // content still active
    await cancelContent(A, id, "done");
    await archiveContent(A, id);
    const ids = (await mediaRetentionCandidates(agency, later, 365)).map((x) => String(x._id));
    expect(ids).toContain(a.assetId); // superseded version of archived content
    expect(ids).not.toContain(b.assetId); // current version always kept
    expect(await AssetModel.countDocuments({ _id: { $in: [a.assetId, b.assetId] } })).toBe(2); // nothing deleted
  });
});
