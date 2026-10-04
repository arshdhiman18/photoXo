import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => import("../support/next-headers-mock"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { Types } from "mongoose";
import { BrandRole, SystemRole } from "@/lib/domain/roles";
import { createExpenseSchema, updateExpenseSchema } from "@/features/expenses/schemas";
import {
  createExpenseAction,
  decideExpenseAction,
  submitExpenseAction,
  updateExpenseAction,
} from "@/features/expenses/actions";
import type { Actor } from "@/server/authz/actor";
import { disconnectDb } from "@/server/db/connect";
import { ActivityLogModel, AgencyModel, AssetModel, ExpenseModel, NotificationModel } from "@/server/db/models";
import { expensesRepo } from "@/server/repositories/expenses.repo";
import { addMember } from "@/server/services/brand-team.service";
import { archiveBrand, createBrand, reactivateBrand } from "@/server/services/brands.service";
import {
  createExpense,
  decideExpense,
  expenseTotalsFor,
  getExpense,
  getExpenseFormOptions,
  listExpensesAdmin,
  listMyExpenses,
  submitExpense,
  updateExpense,
  withdrawExpense,
} from "@/server/services/expenses.service";
import { createShoot } from "@/server/services/shoots.service";
import { bootstrapAgency, createActiveUser, signIn, signInActor, type TestUser } from "../support/fixtures";
import { setRequestCookie } from "../support/next-headers-mock";

let admin: TestUser, manager: TestUser, staff: TestUser, other: TestUser, client: TestUser, foreignAdmin: TestUser;
let A: Actor, M: Actor, S: Actor, O: Actor, C: Actor, F: Actor;
let brandX: string, brandY: string, shootX: string, shootY: string;
const cookies: Record<string, string> = {};
const as = (u: TestUser) => setRequestCookie(cookies[u.id]!);
const actorOf = async (u: TestUser) => (await signInActor(u)).actor;

/** Raw form input (what a browser sends). */
const input = (extra: Record<string, unknown> = {}) =>
  ({
    title: "Cab to studio",
    description: "Round trip",
    category: "TRAVEL",
    amount: "1250.50",
    incurredOn: "2026-10-01",
    brandId: null,
    shootId: null,
    receiptUrl: "https://drive.google.com/file/d/receipt-1",
    receiptAssetId: null,
    submit: true,
    ...extra,
  }) as never;

/** Service calls take schema-parsed input, exactly like the actions do. */
const P = (raw: unknown) => createExpenseSchema.parse(raw);
const U = (expenseId: string, extra: Record<string, unknown> = {}) => {
  const { submit: _s, ...raw } = input(extra) as Record<string, unknown>;
  return updateExpenseSchema.parse({ expenseId, ...raw });
};

beforeAll(async () => {
  admin = await bootstrapAgency();
  A = await actorOf(admin);
  manager = await createActiveUser(admin.agencyId, SystemRole.MANAGER, "Mona Manager");
  staff = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Sam Staff");
  other = await createActiveUser(admin.agencyId, SystemRole.STAFF, "Olga Other");
  client = await createActiveUser(admin.agencyId, SystemRole.CLIENT, "Cleo Client");
  for (const u of [admin, manager, staff, other, client]) cookies[u.id] = await signIn(u);
  [M, S, O, C] = (await Promise.all([manager, staff, other, client].map(actorOf))) as [Actor, Actor, Actor, Actor];
  brandX = (await createBrand(A, { name: "Xylo", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  brandY = (await createBrand(A, { name: "Yara", description: null, logoUrl: null, status: "ACTIVE", socialHandles: [] })).id;
  await addMember(A, { brandId: brandX, userId: staff.id, role: BrandRole.VIDEOGRAPHER });
  await addMember(A, { brandId: brandY, userId: other.id, role: BrandRole.VIDEOGRAPHER });
  await addMember(A, { brandId: brandX, userId: client.id, role: BrandRole.CLIENT });
  const shoot = (brandId: string, userId: string, date: string) =>
    createShoot(A, { brandId, title: "Studio shoot", date, startTime: "10:00", endTime: "12:00", locationName: "Studio", locationAddress: null, notes: null, contentIds: [], crew: [{ userId, brandRole: "VIDEOGRAPHER", required: true }] } as never);
  shootX = (await shoot(brandX, staff.id, "2026-10-02")).id;
  shootY = (await shoot(brandY, other.id, "2026-10-02")).id;
  const otherAgency = await AgencyModel.create({ name: "Agency B", slug: "agency-b-exp", timezone: "UTC", currency: "USD" });
  foreignAdmin = await createActiveUser(String(otherAgency._id), SystemRole.ADMIN, "Foreign Admin");
  F = await actorOf(foreignAdmin);
});

beforeEach(() => setRequestCookie(null));
afterAll(async () => {
  await disconnectDb();
});

describe("expense lifecycle", () => {
  it("create → submit → approve, amounts in integer paise, audited, notified", async () => {
    const { id } = await createExpense(S, P(input({ brandId: brandX, shootId: shootX })));
    const doc = await ExpenseModel.findById(id).lean();
    expect(doc).toMatchObject({ amountMinor: 125050, currency: "INR", status: "SUBMITTED", category: "TRAVEL", incurredOn: "2026-10-01" });
    expect(String(doc!.userId)).toBe(staff.id);
    expect(String(doc!.shootId)).toBe(shootX);
    expect(await AssetModel.findOne({ _id: doc!.receiptAssetId, kind: "RECEIPT", expenseId: doc!._id }).lean()).not.toBeNull();
    expect(await NotificationModel.countDocuments({ recipientUserId: manager.id, type: "EXPENSE_SUBMITTED", entityId: doc!._id })).toBe(1);
    expect(await NotificationModel.countDocuments({ recipientUserId: staff.id, type: "EXPENSE_SUBMITTED" })).toBe(0);

    await decideExpense(M, { expenseId: id, decision: "APPROVED", reason: null });
    const after = await ExpenseModel.findById(id).lean();
    expect(after).toMatchObject({ status: "APPROVED", decisionReason: null });
    expect(String(after!.decidedBy)).toBe(manager.id);
    expect(after!.reviews).toHaveLength(1);
    expect(await NotificationModel.countDocuments({ recipientUserId: staff.id, type: "EXPENSE_APPROVED", entityId: doc!._id })).toBe(1);
    const actions = (await ActivityLogModel.find({ "entity.id": doc!._id }).lean()).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["expense.created", "expense.submitted", "expense.approved"]));
    await expect(decideExpense(A, { expenseId: id, decision: "REJECTED", reason: "late" })).rejects.toMatchObject({ code: "CONFLICT" }); // final
  });

  it("reject → correct → resubmit keeps every decision", async () => {
    const { id } = await createExpense(S, P(input()));
    await decideExpense(A, { expenseId: id, decision: "REJECTED", reason: "Missing receipt total" });
    expect(await NotificationModel.countDocuments({ recipientUserId: staff.id, type: "EXPENSE_REJECTED", entityId: new Types.ObjectId(id) })).toBe(1);
    await updateExpense(S, U(id, { amount: "1300" }));
    expect((await ExpenseModel.findById(id).lean())!.status).toBe("REJECTED"); // edit doesn't resubmit
    await submitExpense(S, id);
    await decideExpense(M, { expenseId: id, decision: "APPROVED", reason: null });
    const e = await ExpenseModel.findById(id).lean();
    expect(e).toMatchObject({ status: "APPROVED", amountMinor: 130000 });
    expect(e!.reviews.map((r) => r.decision)).toEqual(["REJECTED", "APPROVED"]);
    expect(e!.reviews[0]!.reason).toBe("Missing receipt total");
  });

  it("drafts, withdrawal and edit rules", async () => {
    const { id } = await createExpense(S, P(input({ submit: false })));
    expect((await ExpenseModel.findById(id).lean())!.status).toBe("DRAFT");
    expect(await NotificationModel.countDocuments({ type: "EXPENSE_SUBMITTED", entityId: new Types.ObjectId(id) })).toBe(0);
    await submitExpense(S, id);
    await expect(updateExpense(S, U(id))).rejects.toMatchObject({ code: "CONFLICT" }); // submitted → locked
    await withdrawExpense(S, id);
    expect((await ExpenseModel.findById(id).lean())!.status).toBe("DRAFT");
    await expect(withdrawExpense(S, id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("validates amounts without floating point", async () => {
    as(staff);
    for (const amount of ["0", "-5", "12.345", "1e3", "abc", "", "100000001"]) {
      expect(await createExpenseAction(input({ amount }))).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect(await createExpenseAction(input({ amount: "0.10" }))).toMatchObject({ ok: true });
    expect(await createExpenseAction(input({ amount: "1,23,456.7" }))).toMatchObject({ ok: true });
    const rows = await ExpenseModel.find({ userId: staff.id, amountMinor: { $in: [10, 12345670] } }).lean();
    expect(rows.map((r) => r.amountMinor).sort((a, b) => a - b)).toEqual([10, 12345670]);
  });
});

describe("expense permissions and scope", () => {
  it("nobody decides their own expense; staff can't decide at all", async () => {
    const mine = await createExpense(M, P(input()));
    await expect(decideExpense(M, { expenseId: mine.id, decision: "APPROVED", reason: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await decideExpense(A, { expenseId: mine.id, decision: "APPROVED", reason: null });
    const s = await createExpense(S, P(input()));
    as(staff);
    expect(await decideExpenseAction({ expenseId: s.id, decision: "APPROVED" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    as(client);
    expect(await createExpenseAction(input())).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("staff see and change only their own expenses; clients see nothing", async () => {
    const { id } = await createExpense(S, P(input({ submit: false })));
    await expect(getExpense(O, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitExpense(O, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateExpense(O, U(id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getExpense(C, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await expensesRepo.find(C, {})).toEqual([]);
    expect((await listMyExpenses(O)).items.some((e) => e.id === id)).toBe(false);
    await expect(listExpensesAdmin(S)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Even a manager can't edit someone else's expense.
    await expect(updateExpense(M, U(id))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("brand and shoot links stay within the claimant's scope", async () => {
    await expect(createExpense(S, P(input({ brandId: brandY })))).rejects.toMatchObject({ code: "VALIDATION" }); // not their brand
    await expect(createExpense(S, P(input({ shootId: shootY })))).rejects.toMatchObject({ code: "VALIDATION" }); // not their shoot
    await expect(createExpense(S, P(input({ brandId: brandY, shootId: shootX })))).rejects.toMatchObject({ code: "VALIDATION" }); // mismatch
    const { id } = await createExpense(S, P(input({ shootId: shootX }))); // shoot implies brand
    expect(String((await ExpenseModel.findById(id).lean())!.brandId)).toBe(brandX);
    const opts = await getExpenseFormOptions(S);
    expect(opts.brands.map((b) => b.id)).toEqual([brandX]);
    expect(opts.shoots.map((s) => s.id)).toEqual([shootX]);
    await archiveBrand(A, brandY);
    await expect(createExpense(A, P(input({ brandId: brandY })))).rejects.toMatchObject({ code: "VALIDATION" }); // archived
    await reactivateBrand(A, brandY);
  });

  it("cross-agency ids are not found; injected identity/state fields are rejected", async () => {
    const { id } = await createExpense(S, P(input()));
    await expect(getExpense(F, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(decideExpense(F, { expenseId: id, decision: "APPROVED", reason: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    as(staff);
    for (const extra of [{ userId: manager.id }, { agencyId: foreignAdmin.agencyId }, { status: "APPROVED" }, { decidedBy: admin.id }, { currency: "USD" }, { amountMinor: 1 }]) {
      expect(await createExpenseAction(input(extra))).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
      expect(await updateExpenseAction({ expenseId: id, ...(input(extra) as object), submit: undefined } as never)).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    }
    expect(await submitExpenseAction({ expenseId: "nope" })).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("receipts are only visible to the claimant and approvers; uploads can't be hijacked", async () => {
    const { id } = await createExpense(S, P(input({ receiptUrl: "https://drive.google.com/file/d/private-receipt" })));
    expect((await getExpense(S, id)).receipt?.url).toContain("private-receipt");
    expect((await getExpense(M, id)).receipt?.url).toContain("private-receipt");
    await expect(getExpense(O, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Someone else's uploaded receipt asset can't be attached.
    const foreignUpload = await AssetModel.create({ agencyId: admin.agencyId, brandId: null, kind: "RECEIPT", storage: "MEDIA", external: null, media: { provider: "CLOUDINARY", publicId: "x", resourceType: "image", format: "jpg", mimeType: "image/jpeg", bytes: 10, width: null, height: null, durationSec: null, previewUrl: null, thumbnailUrl: null, processing: "READY", purgedAt: null }, originalFilename: "r.jpg", createdBy: other.id });
    await expect(createExpense(S, P(input({ receiptUrl: null, receiptAssetId: String(foreignUpload._id) })))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("expense reporting", () => {
  it("admin filters and totals respect scope; brand/shoot totals", async () => {
    const all = await listExpensesAdmin(M, {});
    expect(all.totals.count).toBeGreaterThan(5);
    const mine = await listMyExpenses(S, {});
    expect(mine.items.every((e) => e.employee?.id === staff.id)).toBe(true);
    const travel = await listExpensesAdmin(M, { category: "TRAVEL", status: "APPROVED", employee: staff.id });
    expect(travel.items.every((e) => e.category === "TRAVEL" && e.status === "APPROVED" && e.employee?.id === staff.id)).toBe(true);
    expect(travel.totals.totalMinor).toBe(travel.items.reduce((n, e) => n + e.amountMinor, 0));
    const byShoot = await expenseTotalsFor(M, { shootId: shootX });
    expect(byShoot.count).toBeGreaterThan(0);
    const byBrand = await expenseTotalsFor(A, { brandId: brandX });
    expect(byBrand.totalMinor).toBeGreaterThanOrEqual(byShoot.totalMinor);
    const dated = await listExpensesAdmin(A, { from: "2026-10-02", to: "2026-10-31" });
    expect(dated.items.every((e) => e.incurredOn >= "2026-10-02")).toBe(true);
    expect((await listExpensesAdmin(F, {})).items).toEqual([]);
  });

  it("financial history is never deleted", async () => {
    const e = await ExpenseModel.findOne({ status: "APPROVED" });
    await expect(ExpenseModel.deleteOne({ _id: e!._id })).rejects.toThrow(/never deleted/);
  });

  it("a failed decision rolls back status, review and notification", async () => {
    const { id } = await createExpense(S, P(input()));
    const create = ActivityLogModel.create.bind(ActivityLogModel);
    const spy = vi.spyOn(ActivityLogModel, "create").mockRejectedValueOnce(new Error("audit down"));
    await expect(decideExpense(M, { expenseId: id, decision: "REJECTED", reason: "no" + "pe" })).rejects.toThrow("audit down");
    spy.mockRestore();
    void create;
    const e = await ExpenseModel.findById(id).lean();
    expect(e).toMatchObject({ status: "SUBMITTED", reviews: [] });
    expect(await NotificationModel.countDocuments({ type: "EXPENSE_REJECTED", entityId: new Types.ObjectId(id) })).toBe(0);
  });
});
