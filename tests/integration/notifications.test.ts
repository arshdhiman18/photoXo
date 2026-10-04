import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
const sendEmail = vi.hoisted(() => vi.fn(async () => ({ status: "sent" as const, id: "re_test" })));
vi.mock("@/server/email/transport", () => ({ sendEmail, EmailDeliveryError: class extends Error {} }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import type { NotificationType } from "@/lib/domain/notifications";
import {
  markAllNotificationsReadAction,
  setNotificationPreferencesAction,
  setNotificationReadAction,
  updateReminderSettingsAction,
} from "@/features/notifications/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import {
  ActivityLogModel,
  AgencyModel,
  BrandMembershipModel,
  ContentModel,
  EmailOutboxModel,
  NotificationModel,
  ProductionTaskModel,
  UserModel,
} from "@/server/db/models";
import { deliverPendingEmails } from "@/server/notifications/dispatch";
import { notify } from "@/server/notifications/notify";
import { runReminders } from "@/server/notifications/reminders";
import { notificationsRepo } from "@/server/repositories/notifications.repo";
import {
  decideClientReview,
  decideInternalReview,
  reopenForChanges,
  submitForInternalReview,
} from "@/server/services/approvals.service";
import { addMember, deactivateMember } from "@/server/services/brand-team.service";
import { archiveBrand, createBrand, reactivateBrand } from "@/server/services/brands.service";
import { createBrief } from "@/server/services/content.service";
import {
  getNotificationSummary,
  listMyNotifications,
  setNotificationRead,
} from "@/server/services/notifications.service";
import { confirmPosted } from "@/server/services/postings.service";
import { cancelShoot, completeMyPart, createShoot, rescheduleShoot, startShoot } from "@/server/services/shoots.service";
import { assignTask, updateTaskStatus } from "@/server/services/tasks.service";
import { createVersion } from "@/server/services/versions.service";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, dev: TestUser, other: TestUser, uploader: TestUser, crew: TestUser, editor: TestUser;
let client: TestUser, clientY: TestUser, outsider: TestUser, foreignAdmin: TestUser;
let A: Actor, M: Actor, D: Actor, U: Actor, CR: Actor, C: Actor, CY: Actor, F: Actor;
let brandX: string, brandY: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

const SECRET = { notes: "INTERNAL-NOTES-SECRET", comment: "INTERNAL-REVIEW-COMMENT" };

async function newContent(opts: { brandId?: string; contentType?: string; route?: string; platforms?: string[]; assign?: TestUser | null } = {}) {
  const { id } = await createBrief(A, {
    brandId: opts.brandId ?? brandX,
    title: "Diwali offer post",
    description: "brief",
    notes: SECRET.notes,
    contentType: opts.contentType ?? "GRAPHIC",
    origin: "ADMIN_BRIEF",
    priority: "NORMAL",
    dueDate: null,
    referenceIds: [],
    referenceUrl: null,
    targetPlatforms: opts.platforms ?? ["INSTAGRAM"],
    ...(opts.route ? { route: opts.route } : {}),
  } as never);
  if (opts.assign !== null) {
    const task = await ProductionTaskModel.findOne({ contentId: id, taskType: "DESIGN" }).lean();
    if (task) await assignTask(A, String(task._id), (opts.assign ?? dev).id);
  }
  return id;
}
const addVersion = async (contentId: string, actor = D) =>
  (await createVersion(actor, { contentId, links: [{ url: "https://www.canva.com/design/a/view", label: "Final" }], caption: "c", hashtags: [], changeNote: null } as never)).id;

async function toClientReview(id?: string) {
  const cid = id ?? (await newContent());
  const v = await addVersion(cid);
  await submitForInternalReview(D, { contentId: cid, versionId: v });
  await decideInternalReview(M, { contentId: cid, versionId: v, decision: "APPROVED", comment: SECRET.comment });
  return { id: cid, v };
}

const inbox = (u: TestUser, type?: NotificationType) =>
  NotificationModel.find({ recipientUserId: new Types.ObjectId(u.id), ...(type ? { type } : {}) }).lean();
const count = async (u: TestUser, type: NotificationType, contentId?: string) =>
  NotificationModel.countDocuments({ recipientUserId: new Types.ObjectId(u.id), type, ...(contentId ? { contentId: new Types.ObjectId(contentId) } : {}) });

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Mona Manager");
  dev = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Dev Designer");
  other = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Otto Other");
  uploader = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Uma Uploader");
  crew = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Rahul Crew");
  editor = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Eddie Editor");
  outsider = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Olga Outsider");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  clientY = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Yusuf Client");
  for (const u of [admin, manager, dev, other, uploader, crew, editor, outsider, client, clientY]) cookies[u.id] = await signIn(u);
  [M, D, U, CR, C, CY] = (await Promise.all([manager, dev, uploader, crew, client, clientY].map(actorOf))) as [Actor, Actor, Actor, Actor, Actor, Actor];

  brandX = (await createBrand(A, { name: "Xylo", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  brandY = (await createBrand(A, { name: "Yara", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  await addMember(A, { brandId: brandX, userId: dev.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: other.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: uploader.id, role: BrandRole.UPLOADER });
  await addMember(A, { brandId: brandX, userId: crew.id, role: BrandRole.VIDEOGRAPHER });
  await addMember(A, { brandId: brandX, userId: editor.id, role: BrandRole.EDITOR });
  await addMember(A, { brandId: brandY, userId: outsider.id, role: BrandRole.DESIGNER });
  await addMember(A, { brandId: brandX, userId: client.id, role: BrandRole.CLIENT });
  await addMember(A, { brandId: brandY, userId: clientY.id, role: BrandRole.CLIENT });

  const otherAgency = await AgencyModel.create({ name: "Agency B", slug: "agency-b-notif", timezone: "UTC", currency: "USD" });
  foreignAdmin = await createActiveUser(String(otherAgency._id), SystemRole.ADMIN, "Foreign Admin");
  F = await actorOf(foreignAdmin);
});

beforeEach(() => {
  setRequestCookie(null);
  sendEmail.mockClear();
  sendEmail.mockImplementation(async () => ({ status: "sent" as const, id: "re_test" }));
});
afterAll(async () => {
  await disconnectDb();
});

// ── Creation & recipients ─────────────────────────────────────────────────
describe("approval notifications", () => {
  it("submission notifies reviewers (not the submitter, never clients)", async () => {
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    expect(await count(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(1);
    expect(await count(admin, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(1);
    expect(await count(dev, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(0);
    expect(await NotificationModel.countDocuments({ contentId: id, audience: "CLIENT" })).toBe(0);
  });

  it("internal approval reaches the brand's clients only, with client-safe copy and an email", async () => {
    const { id } = await toClientReview();
    const [n] = await inbox(client, "CONTENT_READY_FOR_CLIENT_APPROVAL").then((r) => r.filter((x) => String(x.contentId) === id));
    expect(n).toMatchObject({ audience: "CLIENT", title: "New content is ready for your approval", message: "Diwali offer post · Xylo" });
    expect(await count(clientY, "CONTENT_READY_FOR_CLIENT_APPROVAL", id)).toBe(0);
    expect((await listMyNotifications(CY)).items.some((x) => x.href.includes(id))).toBe(false);
    expect(await count(outsider, "CONTENT_READY_FOR_CLIENT_APPROVAL", id)).toBe(0);
    expect(await NotificationModel.countDocuments({ contentId: id, type: "CONTENT_READY_FOR_CLIENT_APPROVAL", audience: "INTERNAL" })).toBe(0);
    expect(await EmailOutboxModel.countDocuments({ notificationId: n!._id, to: client.email })).toBe(1);
  });

  it("internal change request reaches the production owner with the comment", async () => {
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    await decideInternalReview(M, { contentId: id, versionId: v, decision: "CHANGES_REQUESTED", comment: "Logo too small" });
    const [n] = (await inbox(dev, "CHANGES_REQUESTED_INTERNAL")).filter((x) => String(x.contentId) === id);
    expect(n?.message).toContain("Logo too small");
    expect(await count(other, "CHANGES_REQUESTED_INTERNAL", id)).toBe(0); // same brand, not working on it
    expect(await count(client, "CHANGES_REQUESTED_INTERNAL", id)).toBe(0);
  });

  it("client changes reach the production owner and the internal approver (with email)", async () => {
    const { id, v } = await toClientReview();
    await decideClientReview(C, { contentId: id, versionId: v, decision: "CHANGES_REQUESTED", comment: "Warmer colours" });
    expect(await count(dev, "CHANGES_REQUESTED_CLIENT", id)).toBe(1);
    expect(await count(manager, "CHANGES_REQUESTED_CLIENT", id)).toBe(1);
    expect(await count(client, "CHANGES_REQUESTED_CLIENT", id)).toBe(0);
    expect(await EmailOutboxModel.countDocuments({ type: "CHANGES_REQUESTED_CLIENT", to: { $in: [dev.email, manager.email] }, notificationId: { $in: (await NotificationModel.find({ contentId: id, type: "CHANGES_REQUESTED_CLIENT" })).map((n) => n._id) } })).toBe(2);
  });

  it("client approval: approver + owner informed, the effective uploader gets the posting job", async () => {
    const { id, v } = await toClientReview();
    await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
    expect(await count(manager, "CLIENT_APPROVED", id)).toBe(1);
    expect(await count(dev, "CLIENT_APPROVED", id)).toBe(1);
    expect(await count(uploader, "CONTENT_READY_TO_POST", id)).toBe(1);
    expect(await count(other, "CONTENT_READY_TO_POST", id)).toBe(0);
    const n = await NotificationModel.findOne({ recipientUserId: uploader.id, type: "CONTENT_READY_TO_POST", contentId: id }).lean();
    expect(await EmailOutboxModel.countDocuments({ notificationId: n!._id })).toBe(1);
    // Posting → POSTED/COMPLETED informs the team and the client (client-safe), not the uploader who did it.
    await confirmPosted(U, { contentId: id, versionId: v, platform: "INSTAGRAM", postUrl: "https://www.instagram.com/p/x/", postedAt: null, screenshotUrl: null, note: null } as never);
    expect(await count(dev, "CONTENT_POSTED", id)).toBe(1);
    expect(await count(uploader, "CONTENT_POSTED", id)).toBe(0);
    expect((await inbox(client, "CONTENT_POSTED")).find((x) => String(x.contentId) === id)?.title).toBe("Your content has been posted");
  });

  it("an approved item without a valid uploader alerts operations (email)", async () => {
    const id = await newContent();
    await ContentModel.updateOne({ _id: id }, { $set: { uploaderOverrideId: new Types.ObjectId() } }); // a non-uploader → invalid
    const { v } = await toClientReview(id);
    await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
    expect(await count(uploader, "CONTENT_READY_TO_POST", id)).toBe(0); // never silently re-routed
    expect(await count(admin, "UPLOADER_ASSIGNMENT_PROBLEM", id)).toBe(1);
    expect(await count(manager, "UPLOADER_ASSIGNMENT_PROBLEM", id)).toBe(1);
    expect(await EmailOutboxModel.countDocuments({ type: "UPLOADER_ASSIGNMENT_PROBLEM", to: admin.email })).toBeGreaterThan(0);
  });

  it("sending approved content back: client sees 'being revised', uploader is told to hold, owner gets the changes", async () => {
    const { id, v } = await toClientReview();
    await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
    await reopenForChanges(M, { contentId: id, versionId: v, reason: "Price changed — internal detail" });
    expect((await inbox(client, "CONTENT_BEING_REVISED")).find((x) => String(x.contentId) === id)).toMatchObject({ title: "Your content is being revised" });
    expect(await count(uploader, "CONTENT_POSTING_PROBLEM", id)).toBe(1);
    expect(await count(dev, "CHANGES_REQUESTED_INTERNAL", id)).toBe(1);
  });
});

describe("production notifications", () => {
  it("shoot assigned / rescheduled / cancelled reach the crew", async () => {
    const { id: shootId } = await createShoot(A, {
      brandId: brandX, title: "Studio shoot", date: "2027-03-01", startTime: "10:00", endTime: "12:00",
      locationName: "Studio", locationAddress: null, notes: null, contentIds: [],
      crew: [{ userId: crew.id, brandRole: "VIDEOGRAPHER", required: true }],
    } as never);
    expect((await inbox(crew, "SHOOT_ASSIGNED")).filter((n) => String(n.entityId) === shootId)).toHaveLength(1);
    await rescheduleShoot(A, { shootId, date: "2027-03-02", startTime: "11:00", endTime: "13:00", locationName: "Studio", locationAddress: null, reason: null } as never);
    expect((await inbox(crew, "SHOOT_RESCHEDULED")).filter((n) => String(n.entityId) === shootId)).toHaveLength(1);
    await cancelShoot(A, shootId, "Rain");
    expect((await inbox(crew, "SHOOT_CANCELLED")).filter((n) => String(n.entityId) === shootId)).toHaveLength(1);
    expect(await NotificationModel.countDocuments({ entityId: shootId, recipientUserId: { $in: [dev.id, client.id].map((x) => new Types.ObjectId(x)) } })).toBe(0);
  });

  it("task assigned, shoot complete and raw footage ready reach the right people", async () => {
    const id = await newContent({ contentType: "VIDEO", route: "SHOOT_THEN_EDIT", assign: null });
    const raw = await ProductionTaskModel.findOne({ contentId: id, taskType: "UPLOAD_RAW" }).lean();
    const edit = await ProductionTaskModel.findOne({ contentId: id, taskType: "EDIT" }).lean();
    await assignTask(A, String(raw!._id), crew.id);
    await assignTask(A, String(edit!._id), editor.id);
    expect(await count(crew, "TASK_ASSIGNED", id)).toBe(1);
    expect(await count(editor, "TASK_ASSIGNED", id)).toBe(1);

    const { id: shootId } = await createShoot(A, {
      brandId: brandX, title: "Video shoot", date: "2027-03-05", startTime: "10:00", endTime: "12:00",
      locationName: "Studio", locationAddress: null, notes: null, contentIds: [id],
      crew: [{ userId: crew.id, brandRole: "VIDEOGRAPHER", required: true }],
    } as never);
    await startShoot(CR, shootId);
    await completeMyPart(CR, shootId);
    expect(await count(editor, "SHOOT_READY", id)).toBe(1); // their task was waiting on the shoot
    expect(await count(crew, "SHOOT_READY", id)).toBe(0); // they completed it themselves

    await updateTaskStatus(CR, String(raw!._id), "IN_PROGRESS");
    await updateTaskStatus(CR, String(raw!._id), "COMPLETED");
    expect(await count(editor, "RAW_FOOTAGE_READY", id)).toBe(1);
    expect(await count(dev, "RAW_FOOTAGE_READY", id)).toBe(0);
  });
});

// ── Scoping ───────────────────────────────────────────────────────────────
describe("recipient scoping", () => {
  it("inactive users and removed members get nothing new", async () => {
    await UserModel.updateOne({ _id: manager.id }, { $set: { status: "SUSPENDED" } });
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    expect(await count(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(0);
    await UserModel.updateOne({ _id: manager.id }, { $set: { status: "ACTIVE" } });

    const m = await BrandMembershipModel.findOne({ brandId: brandX, userId: dev.id, role: "DESIGNER" }).lean();
    await deactivateMember(A, { brandId: brandX, membershipId: String(m!._id) });
    await decideInternalReview(A, { contentId: id, versionId: v, decision: "CHANGES_REQUESTED", comment: "x-x" });
    expect(await count(dev, "CHANGES_REQUESTED_INTERNAL", id)).toBe(0);
    await addMember(A, { brandId: brandX, userId: dev.id, role: BrandRole.DESIGNER });
  });

  it("clients never receive internal types; archived brands generate nothing new", async () => {
    const clientTypes = new Set((await NotificationModel.find({ audience: "CLIENT" }).lean()).map((n) => n.type));
    for (const t of clientTypes) expect(["CONTENT_READY_FOR_CLIENT_APPROVAL", "CONTENT_BEING_REVISED", "CONTENT_POSTED"]).toContain(t);
    const clientIds = [client.id, clientY.id].map((x) => new Types.ObjectId(x));
    expect(await NotificationModel.countDocuments({ recipientUserId: { $in: clientIds }, audience: "INTERNAL" })).toBe(0);
    // notify() itself refuses an internal type for a client even if a caller passes one.
    const id = await newContent();
    expect(await notify({ agencyId: new Types.ObjectId(admin.agencyId), brandId: new Types.ObjectId(brandX), contentId: new Types.ObjectId(id), entity: { type: "CONTENT", id: new Types.ObjectId(id) }, type: "CHANGES_REQUESTED_INTERNAL", recipients: [client.id], eventVersion: "x", ctx: { comment: "secret" } })).toBe(0);
    // …and a brand-Y staff member can't be notified about brand X content.
    expect(await notify({ agencyId: new Types.ObjectId(admin.agencyId), brandId: new Types.ObjectId(brandX), contentId: new Types.ObjectId(id), entity: { type: "CONTENT", id: new Types.ObjectId(id) }, type: "TASK_ASSIGNED", recipients: [outsider.id], eventVersion: "x", ctx: {} })).toBe(0);
    await archiveBrand(A, brandY);
    expect(await notify({ agencyId: new Types.ObjectId(admin.agencyId), brandId: new Types.ObjectId(brandY), entity: { type: "CONTENT", id: new Types.ObjectId() }, type: "OVERDUE_ITEM", recipients: [admin.id], eventVersion: "x", ctx: {} })).toBe(0);
    await reactivateBrand(A, brandY);
  });
});

// ── Security & read state ─────────────────────────────────────────────────
describe("read state and security", () => {
  it("users read and change only their own notifications", async () => {
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    const mine = await NotificationModel.findOne({ recipientUserId: manager.id, contentId: id }).lean();

    await expect(setNotificationRead(A, String(mine!._id), true)).rejects.toMatchObject({ code: "NOT_FOUND" }); // another user
    await expect(setNotificationRead(F, String(mine!._id), true)).rejects.toMatchObject({ code: "NOT_FOUND" }); // other agency
    expect(await notificationsRepo.findById(A, String(mine!._id))).toBeNull();
    as(dev);
    expect(await setNotificationReadAction({ notificationId: String(mine!._id), read: true })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await NotificationModel.findById(mine!._id).lean())!.readAt).toBeNull();

    await setNotificationRead(M, String(mine!._id), true);
    expect((await NotificationModel.findById(mine!._id).lean())!.readAt).toBeInstanceOf(Date);
    await setNotificationRead(M, String(mine!._id), false);
    expect((await NotificationModel.findById(mine!._id).lean())!.readAt).toBeNull();

    as(manager);
    const before = (await getNotificationSummary(M)).unread;
    expect(before).toBeGreaterThan(0);
    expect(await markAllNotificationsReadAction({})).toMatchObject({ ok: true });
    expect((await getNotificationSummary(M)).unread).toBe(0);
    expect(await NotificationModel.countDocuments({ recipientUserId: admin.id, readAt: null })).toBeGreaterThan(0); // others untouched
  });

  it("injected recipient / agency fields are rejected", async () => {
    as(dev);
    const n = await NotificationModel.findOne({ recipientUserId: dev.id }).lean();
    for (const extra of [{ recipientUserId: manager.id }, { agencyId: foreignAdmin.agencyId }, { userId: manager.id }]) {
      expect(await setNotificationReadAction({ notificationId: String(n!._id), read: true, ...extra } as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
      expect(await markAllNotificationsReadAction(extra as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect(await setNotificationPreferencesAction({ inAppEnabled: true, emailEnabled: true, userId: manager.id } as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await updateReminderSettingsAction({ approvalWaitingHours: 1, readyToPostHours: 1, overdueGraceHours: 0, repeatEveryHours: 1, readNotificationRetentionDays: 180 })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("links are internal paths derived for the viewer's role", async () => {
    const items = [...(await listMyNotifications(C)).items, ...(await listMyNotifications(D)).items, ...(await listMyNotifications(A)).items];
    expect(items.length).toBeGreaterThan(5);
    for (const n of items) expect(n.href).toMatch(/^\/(client|work|admin)\/[a-z0-9/-]*$/);
    expect((await listMyNotifications(C)).items.every((n) => n.href.startsWith("/client/"))).toBe(true);
  });

  it("client notification payloads contain nothing internal", async () => {
    const json = JSON.stringify(await listMyNotifications(C)) + JSON.stringify(await getNotificationSummary(C));
    for (const s of [SECRET.notes, SECRET.comment, "Mona", "Dev Designer", "Uma", "Price changed", "Warmer", "uploader", "eventKey", "recipientUserId", "brandId", "agencyId"]) {
      expect(json).not.toContain(s);
    }
  });
});

// ── Idempotency, email, preferences ───────────────────────────────────────
describe("duplicates, email and preferences", () => {
  it("retrying the same event creates no duplicate notification or email", async () => {
    const id = new Types.ObjectId();
    const input = { agencyId: new Types.ObjectId(admin.agencyId), brandId: new Types.ObjectId(brandX), contentId: id, entity: { type: "CONTENT" as const, id }, type: "UPLOADER_ASSIGNMENT_PROBLEM" as const, recipients: [admin.id, manager.id], eventVersion: "v1", ctx: { contentTitle: "Retry" } };
    expect(await notify(input)).toBe(2);
    expect(await notify(input)).toBe(0);
    expect(await NotificationModel.countDocuments({ entityId: id })).toBe(2);
    expect(await EmailOutboxModel.countDocuments({ notificationId: { $in: (await NotificationModel.find({ entityId: id })).map((n) => n._id) } })).toBe(2);
  });

  it("email failures never fail the business change; retries send each email once", async () => {
    await EmailOutboxModel.updateMany({ status: "PENDING" }, { $set: { status: "SENT" } }); // isolate this test
    sendEmail.mockRejectedValue(new Error("provider down"));
    const { id } = await toClientReview(); // queues a client email
    expect((await ContentModel.findById(id).lean())!.status).toBe("CLIENT_REVIEW");
    const r1 = await deliverPendingEmails({ limit: 50 });
    expect(r1.failed).toBeGreaterThan(0);
    const row = await EmailOutboxModel.findOne({ to: client.email, status: "PENDING" }).sort({ createdAt: -1 }).lean();
    expect(row).toMatchObject({ attempts: 1, lastError: "provider down" });

    sendEmail.mockReset();
    sendEmail.mockImplementation(async () => ({ status: "sent" as const, id: "re_ok" }));
    const later = new Date(Date.now() + 60 * 60_000);
    const [a, b] = await Promise.all([deliverPendingEmails({ now: later, limit: 50 }), deliverPendingEmails({ now: later, limit: 50 })]);
    expect(a.sent + b.sent).toBe(r1.failed);
    expect(sendEmail).toHaveBeenCalledTimes(r1.failed); // concurrent dispatchers never double-send
    expect((await EmailOutboxModel.findById(row!._id).lean())).toMatchObject({ status: "SENT", providerId: "re_ok" });
    await deliverPendingEmails({ now: later });
    expect(sendEmail).toHaveBeenCalledTimes(r1.failed);
  });

  it("a rolled-back business change leaves no notification or email behind", async () => {
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    const outboxBefore = await EmailOutboxModel.countDocuments();
    const create = ActivityLogModel.create.bind(ActivityLogModel);
    const spy = vi.spyOn(ActivityLogModel, "create").mockImplementationOnce(create as never).mockRejectedValueOnce(new Error("audit down"));
    await expect(decideInternalReview(M, { contentId: id, versionId: v, decision: "APPROVED", comment: null })).rejects.toThrow("audit down");
    spy.mockRestore();
    expect(await count(client, "CONTENT_READY_FOR_CLIENT_APPROVAL", id)).toBe(0);
    expect(await EmailOutboxModel.countDocuments()).toBe(outboxBefore);
  });

  it("email off → no email; in-app off → only critical in-app", async () => {
    as(client);
    expect(await setNotificationPreferencesAction({ inAppEnabled: false, emailEnabled: false })).toMatchObject({ ok: true });
    const { id, v } = await toClientReview(); // critical → still in-app, but no email
    expect(await count(client, "CONTENT_READY_FOR_CLIENT_APPROVAL", id)).toBe(1);
    const n = await NotificationModel.findOne({ recipientUserId: client.id, contentId: id }).lean();
    expect(await EmailOutboxModel.countDocuments({ notificationId: n!._id })).toBe(0);
    await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
    await confirmPosted(U, { contentId: id, versionId: v, platform: "INSTAGRAM", postUrl: "https://www.instagram.com/p/y/", postedAt: null, screenshotUrl: null, note: null } as never);
    expect(await count(client, "CONTENT_POSTED", id)).toBe(0); // non-critical, in-app off
    await setNotificationPreferencesAction({ inAppEnabled: true, emailEnabled: true });
  });

  it("a queued email is skipped if the recipient turns email off before delivery", async () => {
    await EmailOutboxModel.updateMany({ status: "PENDING" }, { $set: { status: "SENT" } });
    await toClientReview();
    as(client);
    await setNotificationPreferencesAction({ inAppEnabled: true, emailEnabled: false });
    const r = await deliverPendingEmails();
    expect(r.skipped).toBeGreaterThan(0);
    expect(sendEmail).not.toHaveBeenCalled();
    await setNotificationPreferencesAction({ inAppEnabled: true, emailEnabled: true });
  });
});

// ── Reminders ─────────────────────────────────────────────────────────────
describe("reminders", () => {
  const agencyId = () => new Types.ObjectId(admin.agencyId);
  const reminders = (u: TestUser, type: NotificationType, contentId: string) =>
    NotificationModel.countDocuments({ recipientUserId: new Types.ObjectId(u.id), type, contentId: new Types.ObjectId(contentId), reminder: true });

  it("approval reminders respect the threshold, once per window, and stop when resolved", async () => {
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    const since = (await ContentModel.findById(id).lean())!.statusChangedAt;
    const at = (h: number) => new Date(since.getTime() + h * 3_600_000);

    await runReminders({ now: at(71), agencyId: agencyId() }); // default threshold 72h
    expect(await reminders(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(0);
    await runReminders({ now: at(73), agencyId: agencyId() });
    await runReminders({ now: at(80), agencyId: agencyId() }); // same 24h window
    expect(await reminders(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(1);
    await runReminders({ now: at(97), agencyId: agencyId() }); // next window, still unresolved
    expect(await reminders(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(2);
    expect((await NotificationModel.findOne({ recipientUserId: manager.id, contentId: id, reminder: true }).lean())!.title).toMatch(/^Reminder: /);

    await decideInternalReview(M, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
    await runReminders({ now: at(200), agencyId: agencyId() });
    expect(await reminders(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(2); // resolved → no more
  });

  it("client, ready-to-post, uploader-problem and overdue reminders go to the right people", async () => {
    const { id, v } = await toClientReview();
    const since = (await ContentModel.findById(id).lean())!.statusChangedAt;
    await runReminders({ now: new Date(since.getTime() + 73 * 3_600_000), agencyId: agencyId() });
    const r = await NotificationModel.findOne({ recipientUserId: client.id, contentId: id, reminder: true }).lean();
    expect(r).toMatchObject({ audience: "CLIENT", title: "Reminder: content is waiting for your approval" });

    await decideClientReview(C, { contentId: id, versionId: v, decision: "APPROVED", comment: null });
    const ready = (await ContentModel.findById(id).lean())!.statusChangedAt;
    await runReminders({ now: new Date(ready.getTime() + 25 * 3_600_000), agencyId: agencyId() });
    expect(await reminders(uploader, "CONTENT_READY_TO_POST", id)).toBe(1);

    await ContentModel.updateOne({ _id: id }, { $set: { uploaderOverrideId: new Types.ObjectId() } });
    await runReminders({ now: new Date(ready.getTime() + 26 * 3_600_000), agencyId: agencyId() });
    expect(await reminders(admin, "UPLOADER_ASSIGNMENT_PROBLEM", id)).toBe(1);

    const task = await ProductionTaskModel.findOne({ contentId: { $ne: id }, assignedTo: dev.id, status: { $in: ["TODO", "IN_PROGRESS"] } }).lean();
    await ProductionTaskModel.updateOne({ _id: task!._id }, { $set: { dueDate: new Date(Date.now() - 10 * 3_600_000) } });
    await runReminders({ agencyId: agencyId() });
    expect(await NotificationModel.countDocuments({ recipientUserId: dev.id, type: "OVERDUE_ITEM", entityId: task!._id })).toBe(1);
    await runReminders({ agencyId: agencyId() });
    expect(await NotificationModel.countDocuments({ recipientUserId: dev.id, type: "OVERDUE_ITEM", entityId: task!._id })).toBe(1);
  });

  it("agency reminder settings are admin-editable and used", async () => {
    as(admin);
    expect(await updateReminderSettingsAction({ approvalWaitingHours: 0, readyToPostHours: 1, overdueGraceHours: 0, repeatEveryHours: 1, readNotificationRetentionDays: 180 })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(await updateReminderSettingsAction({ approvalWaitingHours: 1, readyToPostHours: 1, overdueGraceHours: 0, repeatEveryHours: 1, readNotificationRetentionDays: 180 })).toMatchObject({ ok: true });
    const id = await newContent();
    const v = await addVersion(id);
    await submitForInternalReview(D, { contentId: id, versionId: v });
    const since = (await ContentModel.findById(id).lean())!.statusChangedAt;
    await runReminders({ now: new Date(since.getTime() + 2 * 3_600_000), agencyId: agencyId() });
    expect(await reminders(manager, "CONTENT_READY_FOR_INTERNAL_REVIEW", id)).toBe(1);
    await updateReminderSettingsAction({ approvalWaitingHours: 72, readyToPostHours: 24, overdueGraceHours: 2, repeatEveryHours: 24, readNotificationRetentionDays: 180 });
  });
});
