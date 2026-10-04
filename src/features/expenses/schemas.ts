import { z } from "zod";
import { EXPENSE_CATEGORY_KEYS, EXPENSE_STATUSES } from "@/lib/domain/expenses";
import { MAX_EXPENSE_MINOR, parseMoneyInput } from "@/lib/money";
import { objectIdString } from "@/lib/validation";

// Strict: userId / agencyId / status / decidedBy / currency are never accepted.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const optionalId = z
  .union([z.literal(""), objectIdString])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** "1,234.50" → 123450 paise. Integer only; no floats are ever stored. */
const amount = z
  .string({ error: "Enter an amount" })
  .trim()
  .transform((v, ctx) => {
    const minor = parseMoneyInput(v);
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 1250 or 1250.50" });
      return z.NEVER;
    }
    if (minor < 1 || minor > MAX_EXPENSE_MINOR) {
      ctx.addIssue({ code: "custom", message: "Amount must be more than 0 and at most 1,00,00,000" });
      return z.NEVER;
    }
    return minor;
  });

const fields = {
  title: z.string().trim().min(2, "Add a short title").max(140),
  description: optionalText(1000),
  category: z.enum(EXPENSE_CATEGORY_KEYS as [string, ...string[]], { error: "Choose a category" }),
  amount,
  incurredOn: z.iso.date("Enter the date"),
  brandId: optionalId,
  shootId: optionalId,
  /** A link to the receipt (Drive, photo link…) — or an uploaded receipt asset below. */
  receiptUrl: z
    .union([z.literal(""), z.string().trim().max(1000).pipe(z.url({ protocol: /^https?$/, error: "Enter a full link starting with https://" }))])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  receiptAssetId: optionalId,
};

export const createExpenseSchema = z.object({ ...fields, submit: z.boolean().default(true) }).strict();
export const updateExpenseSchema = z.object({ expenseId: objectIdString, ...fields }).strict();
export const expenseTargetSchema = z.object({ expenseId: objectIdString }).strict();
export const decideExpenseSchema = z
  .object({
    expenseId: objectIdString,
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: optionalText(500),
  })
  .strict()
  .refine((d) => d.decision === "APPROVED" || (d.reason?.length ?? 0) >= 3, {
    path: ["reason"],
    message: "Tell them why it was rejected",
  });

export const expenseFiltersSchema = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  employee: objectIdString.optional().catch(undefined),
  brand: objectIdString.optional().catch(undefined),
  shoot: objectIdString.optional().catch(undefined),
  category: z.enum(EXPENSE_CATEGORY_KEYS as [string, ...string[]]).optional().catch(undefined),
  status: z.enum(EXPENSE_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});
export type ExpenseFilters = z.output<typeof expenseFiltersSchema>;
