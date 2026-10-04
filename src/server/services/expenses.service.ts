import "server-only";
import type { Types } from "mongoose";
import type { z } from "zod";
import type {
  ExpenseDTO,
  ExpenseFormOptionsDTO,
  ExpenseListDTO,
  ExpenseTotalsDTO,
} from "@/features/expenses/types";
import type {
  ExpenseFilters,
  createExpenseSchema,
  decideExpenseSchema,
  updateExpenseSchema,
} from "@/features/expenses/schemas";
import type { PersonRef } from "@/features/content/types";
import { ActivityAction, ActivityEntityKind } from "@/lib/domain/activity";
import { BrandStatus } from "@/lib/domain/brands";
import {
  EXPENSE_EDITABLE,
  EXPENSE_PAGE_SIZE,
  EXPENSE_TRANSITIONS,
  ExpenseStatus,
  canApplyExpenseEvent,
  type ExpenseCategory,
  type ExpenseEvent,
} from "@/lib/domain/expenses";
import { detectAssetProvider } from "@/lib/domain/content";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { recordActivity } from "@/server/activity/record";
import type { Actor } from "@/server/authz/actor";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/authz/errors";
import { assertCan, canApproveExpenses, canSubmitExpenses, canViewAllExpenses } from "@/server/authz/permissions";
import type { ExpenseDoc } from "@/server/db/models";
import { withTransaction } from "@/server/db/transaction";
import { assetViewUrl } from "@/server/media/urls";
import { onExpenseDecided, onExpenseSubmitted } from "@/server/notifications/events";
import { brandsRepo, brandSummaries } from "@/server/repositories/brands.repo";
import { peopleByIds } from "@/server/repositories/content.repo";
import {
  attachReceipt,
  claimableReceipt,
  expensesRepo,
  expenseTotals,
  insertReceiptAsset,
  receiptAssets,
  shootSummaries,
} from "@/server/repositories/expenses.repo";
import { asObjectId } from "@/server/repositories/scoped-repository";
import { shootRepo } from "@/server/repositories/shoots.repo";
import { usersRepo } from "@/server/repositories/users.repo";
import { getAgencyContext } from "./agency.service";

type CreateInput = z.output<typeof createExpenseSchema>;
type UpdateInput = z.output<typeof updateExpenseSchema>;
type DecideInput = z.output<typeof decideExpenseSchema>;

/*
 * Expenses: staff claim their own costs; ADMIN/MANAGER approve or reject.
 * The claimant is always the session user. Amounts are integer paise.
 * Every change is audited in the same transaction; decisions are appended
 * to `reviews` and never removed (resubmissions keep earlier decisions).
 * Nobody decides their own expense.
 */

const CHANGED = "This expense changed since you opened it. Refresh and try again.";

function audit(actor: Actor, action: ActivityAction, e: Pick<ExpenseDoc, "_id" | "brandId">, meta: Record<string, unknown> = {}) {
  return recordActivity({
    actor,
    action,
    entity: { kind: ActivityEntityKind.EXPENSE, id: String(e._id) },
    brandId: e.brandId ? String(e.brandId) : null,
    meta,
  });
}

/**
 * Resolve the optional brand/shoot links within the actor's scope:
 * a brand the actor works on (ACTIVE for new links); a shoot they can see
 * (staff: their own crew shoots). A shoot implies its brand; both given must agree.
 */
async function resolveLinks(actor: Actor, brandId: string | null, shootId: string | null, current?: ExpenseDoc) {
  let brand: Types.ObjectId | null = null;
  let shoot: Types.ObjectId | null = null;
  if (shootId) {
    const s = await shootRepo.findById(actor, shootId);
    if (!s) throw new ValidationError("Choose one of your shoots.", { shootId: ["Not one of your shoots"] });
    shoot = s._id;
    if (brandId && brandId !== String(s.brandId)) {
      throw new ValidationError("That shoot belongs to a different brand.", { shootId: ["Shoot is for another brand"] });
    }
    brandId = String(s.brandId);
  }
  if (brandId) {
    const b = await brandsRepo.findById(actor, brandId);
    if (!b) throw new ValidationError("Choose one of your brands.", { brandId: ["Not one of your brands"] });
    const unchanged = current?.brandId && String(current.brandId) === brandId;
    if (b.status !== BrandStatus.ACTIVE && !unchanged) {
      throw new ValidationError("This brand is archived.", { brandId: ["Archived brands can't take new expenses"] });
    }
    brand = b._id;
  }
  return { brandId: brand, shootId: shoot };
}

/** A receipt link (new asset) or an uploaded receipt the actor owns (attached once). */
async function resolveReceipt(actor: Actor, input: { receiptUrl: string | null; receiptAssetId: string | null }, expense: Pick<ExpenseDoc, "_id" | "brandId">) {
  if (input.receiptAssetId) {
    const a = await claimableReceipt(actor.agencyId, actor.userId, input.receiptAssetId, expense._id);
    if (!a) throw new ValidationError("That receipt upload isn't available.", { receiptAssetId: ["Upload the receipt again"] });
    await attachReceipt(a._id, expense._id);
    return a._id;
  }
  if (input.receiptUrl) {
    const a = await insertReceiptAsset({
      agencyId: asObjectId(actor.agencyId),
      brandId: expense.brandId, // may be null: receipts are scoped by their expense
      kind: "RECEIPT",
      storage: "EXTERNAL_LINK",
      external: { url: input.receiptUrl, provider: detectAssetProvider(input.receiptUrl), label: "Receipt" },
      media: null,
      originalFilename: null,
      contentId: null,
      versionId: null,
      expenseId: expense._id,
      createdBy: asObjectId(actor.userId),
    });
    return a._id;
  }
  return undefined; // unchanged
}

async function loadOwn(actor: Actor, expenseId: string): Promise<ExpenseDoc> {
  const e = await expensesRepo.getById(actor, expenseId); // scope → 404
  if (String(e.userId) !== actor.userId) throw new ForbiddenError("You can only change your own expenses.");
  return e;
}

/** Apply a lifecycle event conditionally on the current status + revision. */
async function move(actor: Actor, e: ExpenseDoc, event: ExpenseEvent, update: Record<string, unknown>) {
  if (!canApplyExpenseEvent(e.status, event)) throw new ConflictError("That isn't possible for this expense right now.");
  const updated = await expensesRepo.updateById(
    actor,
    String(e._id),
    { ...update, $set: { ...((update.$set as object) ?? {}), status: EXPENSE_TRANSITIONS[event].to }, $inc: { revision: 1 } },
    { status: e.status, revision: e.revision },
  );
  if (!updated) throw new ConflictError(CHANGED);
  return updated;
}

// ── Commands ─────────────────────────────────────────────────────────────

export async function createExpense(actor: Actor, input: CreateInput): Promise<{ id: string }> {
  assertCan(canSubmitExpenses(actor));
  const links = await resolveLinks(actor, input.brandId, input.shootId);
  const { currency } = await getAgencyContext(actor);
  return withTransaction(async () => {
    const now = new Date();
    const e = await expensesRepo.create(actor, {
      userId: asObjectId(actor.userId),
      ...links,
      title: input.title,
      description: input.description,
      category: input.category as ExpenseCategory,
      amountMinor: input.amount,
      currency,
      incurredOn: input.incurredOn,
      receiptAssetId: null,
      status: input.submit ? ExpenseStatus.SUBMITTED : ExpenseStatus.DRAFT,
      submittedAt: input.submit ? now : null,
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      reviews: [],
      revision: 0,
    });
    const receipt = await resolveReceipt(actor, input, e);
    if (receipt) await expensesRepo.updateById(actor, String(e._id), { $set: { receiptAssetId: receipt } });
    await audit(actor, ActivityAction.EXPENSE_CREATED, e, { amountMinor: e.amountMinor, category: e.category, status: e.status });
    if (input.submit) {
      await audit(actor, ActivityAction.EXPENSE_SUBMITTED, e, { amountMinor: e.amountMinor });
      await onExpenseSubmitted(actor, e);
    }
    return { id: String(e._id) };
  });
}

/** The claimant edits a DRAFT or REJECTED expense (status unchanged until resubmitted). */
export async function updateExpense(actor: Actor, input: UpdateInput): Promise<void> {
  assertCan(canSubmitExpenses(actor));
  const e = await loadOwn(actor, input.expenseId);
  if (!EXPENSE_EDITABLE.includes(e.status)) throw new ConflictError("Only draft or rejected expenses can be edited.");
  const links = await resolveLinks(actor, input.brandId, input.shootId, e);
  await withTransaction(async () => {
    const receipt = await resolveReceipt(actor, input, { _id: e._id, brandId: links.brandId });
    const set: Record<string, unknown> = {
      ...links,
      title: input.title,
      description: input.description,
      category: input.category,
      amountMinor: input.amount,
      incurredOn: input.incurredOn,
    };
    if (receipt) set.receiptAssetId = receipt;
    const updated = await expensesRepo.updateById(actor, input.expenseId, { $set: set, $inc: { revision: 1 } }, { status: e.status, revision: e.revision });
    if (!updated) throw new ConflictError(CHANGED);
    await audit(actor, ActivityAction.EXPENSE_UPDATED, e, {
      from: { amountMinor: e.amountMinor, category: e.category, incurredOn: e.incurredOn },
      to: { amountMinor: input.amount, category: input.category, incurredOn: input.incurredOn },
    });
  });
}

export async function submitExpense(actor: Actor, expenseId: string): Promise<void> {
  assertCan(canSubmitExpenses(actor));
  const e = await loadOwn(actor, expenseId);
  await withTransaction(async () => {
    const updated = await move(actor, e, "SUBMIT", { $set: { submittedAt: new Date() } });
    await audit(actor, ActivityAction.EXPENSE_SUBMITTED, e, { amountMinor: e.amountMinor, resubmission: e.status === "REJECTED" });
    await onExpenseSubmitted(actor, updated);
  });
}

export async function withdrawExpense(actor: Actor, expenseId: string): Promise<void> {
  assertCan(canSubmitExpenses(actor));
  const e = await loadOwn(actor, expenseId);
  await withTransaction(async () => {
    await move(actor, e, "WITHDRAW", {});
    await audit(actor, ActivityAction.EXPENSE_WITHDRAWN, e);
  });
}

/** ADMIN / MANAGER approve or reject — never their own expense. */
export async function decideExpense(actor: Actor, input: DecideInput): Promise<void> {
  assertCan(canApproveExpenses(actor));
  const e = await expensesRepo.getById(actor, input.expenseId);
  if (String(e.userId) === actor.userId) throw new ForbiddenError("You can't decide your own expense.");
  const approved = input.decision === "APPROVED";
  const now = new Date();
  await withTransaction(async () => {
    const review = { decision: input.decision, reason: input.reason, decidedBy: asObjectId(actor.userId), decidedAt: now };
    await move(actor, e, approved ? "APPROVE" : "REJECT", {
      $set: { decidedBy: review.decidedBy, decidedAt: now, decisionReason: input.reason },
      $push: { reviews: review },
    });
    await audit(actor, approved ? ActivityAction.EXPENSE_APPROVED : ActivityAction.EXPENSE_REJECTED, e, {
      amountMinor: e.amountMinor,
      userId: String(e.userId),
      reason: input.reason,
    });
    await onExpenseDecided(actor, e, approved, input.reason, e.reviews.length + 1);
  });
}

// ── Reads ────────────────────────────────────────────────────────────────

async function toDTOs(actor: Actor, rows: ExpenseDoc[]): Promise<ExpenseDTO[]> {
  const [people, brands, shoots, receipts] = await Promise.all([
    peopleByIds(actor.agencyId, rows.flatMap((r) => [r.userId, ...r.reviews.map((v) => v.decidedBy)])),
    brandSummaries(actor.agencyId, [...new Set(rows.flatMap((r) => (r.brandId ? [String(r.brandId)] : [])))].map(asObjectId)),
    // Title/date of shoots the (already scope-checked) expenses link to — the
    // claimant may no longer be on that crew, so this is not a shoot read.
    shootSummaries(actor.agencyId, rows.flatMap((r) => (r.shootId ? [r.shootId] : []))),
    receiptAssets(actor.agencyId, rows.flatMap((r) => (r.receiptAssetId ? [r.receiptAssetId] : []))),
  ]);
  const shootById = shoots;
  const p = (id: Types.ObjectId | null): PersonRef | null => (id ? (people.get(String(id)) ?? null) : null);
  const ops = canApproveExpenses(actor);
  return rows.map((e) => {
    const mine = String(e.userId) === actor.userId;
    const receipt = e.receiptAssetId ? receipts.get(String(e.receiptAssetId)) : undefined;
    const url = receipt ? assetViewUrl(receipt) : null;
    const shoot = e.shootId ? shootById.get(String(e.shootId)) : undefined;
    return {
      id: String(e._id),
      title: e.title,
      description: e.description ?? null,
      category: e.category,
      amountMinor: e.amountMinor,
      currency: e.currency,
      incurredOn: e.incurredOn,
      status: e.status,
      employee: p(e.userId),
      brand: e.brandId ? { id: String(e.brandId), name: brands.get(String(e.brandId))?.name ?? "—" } : null,
      shoot: shoot ? { id: String(shoot._id), title: shoot.title, date: shoot.date } : null,
      receipt: receipt && url ? { kind: receipt.storage === "MEDIA" ? "MEDIA" : "LINK", url, label: receipt.external?.label ?? receipt.originalFilename ?? null } : null,
      submittedAt: e.submittedAt?.toISOString() ?? null,
      reviews: e.reviews.map((r) => ({ decision: r.decision, reason: r.reason ?? null, decidedBy: p(r.decidedBy), decidedAt: r.decidedAt.toISOString() })),
      createdAt: e.createdAt.toISOString(),
      isMine: mine,
      canEdit: mine && EXPENSE_EDITABLE.includes(e.status),
      canSubmit: mine && canApplyExpenseEvent(e.status, "SUBMIT"),
      canWithdraw: mine && canApplyExpenseEvent(e.status, "WITHDRAW"),
      canDecide: ops && !mine && e.status === ExpenseStatus.SUBMITTED,
    };
  });
}

function totalsDTO(t: Awaited<ReturnType<typeof expenseTotals>>): ExpenseTotalsDTO {
  const z = (s: string) => t.byStatus[s] ?? { count: 0, totalMinor: 0 };
  return { count: t.count, totalMinor: t.totalMinor, submitted: z("SUBMITTED"), approved: z("APPROVED"), rejected: z("REJECTED"), draft: z("DRAFT") };
}

/** One expense: the claimant, or ADMIN/MANAGER. Anyone else → 404. */
export async function getExpense(actor: Actor, expenseId: string): Promise<ExpenseDTO> {
  if (!canSubmitExpenses(actor)) throw new NotFoundError();
  const e = await expensesRepo.getById(actor, expenseId);
  const [dto] = await toDTOs(actor, [e]);
  return dto!;
}

function filterFor(actor: Actor, f: ExpenseFilters, own: boolean): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (own || !canViewAllExpenses(actor)) filter.userId = asObjectId(actor.userId);
  else if (f.employee) filter.userId = asObjectId(f.employee);
  if (f.brand) filter.brandId = asObjectId(f.brand);
  if (f.shoot) filter.shootId = asObjectId(f.shoot);
  if (f.category) filter.category = f.category;
  if (f.status) filter.status = f.status;
  if (f.from || f.to) filter.incurredOn = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  return filter;
}

async function list(actor: Actor, f: ExpenseFilters, own: boolean): Promise<ExpenseListDTO> {
  const filter = filterFor(actor, f, own);
  const page = f.page ?? 1;
  const [rows, totals, { currency }] = await Promise.all([
    expensesRepo.find(actor, filter, { sort: { incurredOn: -1, createdAt: -1 }, skip: (page - 1) * EXPENSE_PAGE_SIZE, limit: EXPENSE_PAGE_SIZE + 1 }),
    expenseTotals({ agencyId: asObjectId(actor.agencyId), ...filter }),
    getAgencyContext(actor),
  ]);
  return {
    items: await toDTOs(actor, rows.slice(0, EXPENSE_PAGE_SIZE)),
    totals: totalsDTO(totals),
    page,
    hasMore: rows.length > EXPENSE_PAGE_SIZE,
    currency,
  };
}

/** The signed-in user's own expenses (everyone who can claim). */
export async function listMyExpenses(actor: Actor, f: ExpenseFilters = {}): Promise<ExpenseListDTO> {
  assertCan(canSubmitExpenses(actor));
  return list(actor, f, true);
}

/** ADMIN / MANAGER: agency expenses with filters and totals for the filtered set. */
export async function listExpensesAdmin(actor: Actor, f: ExpenseFilters = {}): Promise<ExpenseListDTO> {
  assertCan(canViewAllExpenses(actor));
  return list(actor, f, false);
}

/** Brand / shoot totals (approved + pending) — groundwork for profitability reporting. */
export async function expenseTotalsFor(actor: Actor, scope: { brandId?: string; shootId?: string }): Promise<ExpenseTotalsDTO> {
  assertCan(canViewAllExpenses(actor));
  const match: Record<string, unknown> = { agencyId: asObjectId(actor.agencyId) };
  if (scope.brandId) match.brandId = asObjectId(scope.brandId);
  if (scope.shootId) match.shootId = asObjectId(scope.shootId);
  return totalsDTO(await expenseTotals(match));
}

/** Brands and shoots the actor may link (their own scope), for the form. */
export async function getExpenseFormOptions(actor: Actor): Promise<ExpenseFormOptionsDTO> {
  assertCan(canSubmitExpenses(actor));
  const { timezone } = await getAgencyContext(actor);
  const today = todayInTimeZone(timezone);
  const [brands, shoots] = await Promise.all([
    brandsRepo.find(actor, { status: BrandStatus.ACTIVE }, { sort: { name: 1 }, limit: 200, projection: { name: 1 } }),
    shootRepo.find(
      actor,
      { date: { $gte: addDays(today, -60), $lte: addDays(today, 30) } },
      { sort: { date: -1 }, limit: 100, projection: { title: 1, date: 1, brandId: 1 } },
    ),
  ]);
  return {
    brands: brands.map((b) => ({ id: String(b._id), name: b.name })),
    shoots: shoots.map((s) => ({ id: String(s._id), title: s.title, date: s.date, brandId: String(s.brandId) })),
  };
}

/** Filter options for the approver view: claimants (any status — history), brands, recent shoots. */
export async function getExpenseFilterOptions(actor: Actor) {
  assertCan(canViewAllExpenses(actor));
  const [people, brands, shoots] = await Promise.all([
    usersRepo.find(actor, { role: { $in: ["ADMIN", "MANAGER", "STAFF"] } }, { sort: { name: 1 }, limit: 200, projection: { name: 1 } }),
    brandsRepo.find(actor, {}, { sort: { name: 1 }, limit: 200, projection: { name: 1 } }),
    shootRepo.find(actor, {}, { sort: { startAt: -1 }, limit: 100, projection: { title: 1, date: 1, brandId: 1 } }),
  ]);
  return {
    people: people.map((u) => ({ id: String(u._id), name: u.name })),
    brands: brands.map((b) => ({ id: String(b._id), name: b.name })),
    shoots: shoots.map((s) => ({ id: String(s._id), title: s.title, date: s.date, brandId: String(s.brandId) })),
  };
}
