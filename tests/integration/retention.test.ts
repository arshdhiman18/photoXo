import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { SystemRole } from "@/lib/domain/roles";
import { disconnectDb } from "@/server/db/connect";
import { ActivityLogModel, EmailOutboxModel, NotificationModel } from "@/server/db/models";
import { runNotificationRetention } from "@/server/notifications/retention";
import { bootstrapAgency, createActiveUser, type TestUser } from "../support/fixtures";

let admin: TestUser, staff: TestUser;
const DAY = 86_400_000;

async function seed(type: string, ageDays: number, read: boolean, key: string) {
  const id = new Types.ObjectId();
  const createdAt = new Date(Date.now() - ageDays * DAY);
  await NotificationModel.collection.insertOne({
    _id: id, agencyId: new Types.ObjectId(admin.agencyId), recipientUserId: new Types.ObjectId(staff.id), audience: "INTERNAL",
    type, title: "t", message: "m", entityType: "CONTENT", entityId: new Types.ObjectId(), contentId: null, brandId: null,
    eventKey: key, reminder: false, readAt: read ? createdAt : null, createdAt,
  });
  return id;
}

beforeAll(async () => {
  admin = await bootstrapAgency();
  staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Sam Staff");
});
afterAll(async () => {
  await disconnectDb();
});

describe("notification retention", () => {
  it("deletes only old read / old unread non-critical notifications and old finished outbox rows", async () => {
    const oldRead = await seed("CLIENT_APPROVED", 200, true, "a");
    const recentRead = await seed("CLIENT_APPROVED", 10, true, "b");
    const oldUnreadMinor = await seed("SHOOT_READY", 400, false, "c");
    const oldUnreadCritical = await seed("OVERDUE_ITEM", 900, false, "d"); // critical → protected
    const recentUnread = await seed("SHOOT_READY", 5, false, "e");
    const auditBefore = await ActivityLogModel.countDocuments();
    const old = new Date(Date.now() - 40 * DAY);
    await EmailOutboxModel.collection.insertMany([
      { agencyId: new Types.ObjectId(admin.agencyId), status: "SENT", updatedAt: old, dedupeKey: "x1" },
      { agencyId: new Types.ObjectId(admin.agencyId), status: "PENDING", updatedAt: old, dedupeKey: "x2" },
    ]);

    const r = await runNotificationRetention({ agencyId: new Types.ObjectId(admin.agencyId) });
    expect(r).toMatchObject({ read: 1, unread: 1 });
    const left = (await NotificationModel.find({ recipientUserId: staff.id }).lean()).map((n) => String(n._id));
    expect(left).toEqual(expect.arrayContaining([String(recentRead), String(oldUnreadCritical), String(recentUnread)]));
    expect(left).not.toContain(String(oldRead));
    expect(left).not.toContain(String(oldUnreadMinor));
    expect(await EmailOutboxModel.countDocuments({ dedupeKey: "x1" })).toBe(0);
    expect(await EmailOutboxModel.countDocuments({ dedupeKey: "x2" })).toBe(1); // pending is never pruned
    expect(await ActivityLogModel.countDocuments()).toBe(auditBefore); // business history untouched
  });
});
