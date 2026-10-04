import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import { EXPENSE_CATEGORY_KEYS, EXPENSE_STATUSES, type ExpenseCategory, type ExpenseStatus } from "@/lib/domain/expenses";
import { MAX_EXPENSE_MINOR } from "@/lib/money";
import { defineModel } from "./define";

/** One decision on an expense — appended, never edited (resubmissions keep earlier decisions). */
export interface ExpenseReview {
  decision: "APPROVED" | "REJECTED";
  reason: string | null;
  decidedBy: Types.ObjectId;
  decidedAt: Date;
}

/**
 * A staff expense claim. Financial history: never deleted. Amounts are
 * integer minor units (paise). `userId` (the claimant) always comes from the
 * session. Brand/shoot links make expenses queryable for future
 * profitability reporting; neither is required.
 */
export interface ExpenseDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  userId: Types.ObjectId;
  brandId: Types.ObjectId | null;
  shootId: Types.ObjectId | null;
  title: string;
  description: string | null;
  category: ExpenseCategory;
  amountMinor: number;
  currency: string;
  /** Agency calendar date the cost was incurred (YYYY-MM-DD). */
  incurredOn: string;
  receiptAssetId: Types.ObjectId | null;
  status: ExpenseStatus;
  submittedAt: Date | null;
  /** Latest decision (convenience); the full list lives in `reviews`. */
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  reviews: ExpenseReview[];
  /** Optimistic concurrency for edits. */
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<ExpenseReview>(
  {
    decision: { type: String, enum: ["APPROVED", "REJECTED"], required: true },
    reason: { type: String, default: null, maxlength: 500 },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    decidedAt: { type: Date, required: true },
  },
  { _id: false },
);

const expenseSchema = new Schema<ExpenseDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", default: null },
    shootId: { type: Schema.Types.ObjectId, ref: "Shoot", default: null },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: null, maxlength: 1000 },
    category: { type: String, enum: EXPENSE_CATEGORY_KEYS, required: true },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_EXPENSE_MINOR,
      validate: { validator: Number.isInteger, message: "amount must be whole minor units" },
    },
    currency: { type: String, required: true, minlength: 3, maxlength: 3 },
    incurredOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    receiptAssetId: { type: Schema.Types.ObjectId, ref: "Asset", default: null },
    status: { type: String, enum: EXPENSE_STATUSES, required: true },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    decisionReason: { type: String, default: null, maxlength: 500 },
    reviews: { type: [reviewSchema], default: [] },
    revision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: "expenses" },
);

// "My expenses" (newest first) and per-employee filtering.
expenseSchema.index({ agencyId: 1, userId: 1, incurredOn: -1 });
// Approval queue / status filters by period.
expenseSchema.index({ agencyId: 1, status: 1, incurredOn: -1 });
// Brand and shoot totals / filters (profitability groundwork).
expenseSchema.index({ agencyId: 1, brandId: 1, incurredOn: -1 });
expenseSchema.index({ agencyId: 1, shootId: 1 }, { partialFilterExpression: { shootId: { $type: "objectId" } } });
// Agency-wide period listing.
expenseSchema.index({ agencyId: 1, incurredOn: -1 });

// Financial history is never deleted.
for (const op of ["deleteOne", "deleteMany", "findOneAndDelete"] as const) {
  expenseSchema.pre(op, function () {
    throw new Error("Expenses are never deleted");
  });
}

export const ExpenseModel: Model<ExpenseDoc> = defineModel<ExpenseDoc>("Expense", expenseSchema);
