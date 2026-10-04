/**
 * Expenses domain — categories and lifecycle. Categories are configuration:
 * adding one here is all that's needed (stored as the key string).
 */

export const EXPENSE_CATEGORIES = {
  TRAVEL: { label: "Travel" },
  FOOD: { label: "Food" },
  PROPS: { label: "Props" },
  EQUIPMENT: { label: "Equipment" },
  MATERIALS: { label: "Materials" },
  PRINTING: { label: "Printing" },
  DELIVERY: { label: "Delivery" },
  ACCOMMODATION: { label: "Accommodation" },
  MISCELLANEOUS: { label: "Miscellaneous" },
} as const satisfies Record<string, { label: string }>;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[];
export const expenseCategoryLabel = (c: string) => (EXPENSE_CATEGORIES as Record<string, { label: string }>)[c]?.label ?? c;

export const ExpenseStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];
export const EXPENSE_STATUSES = Object.values(ExpenseStatus);

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
export const EXPENSE_STATUS_TONE: Record<ExpenseStatus, "neutral" | "info" | "success" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

/**
 *   DRAFT ──submit──► SUBMITTED ──approve──► APPROVED   (final)
 *     ▲                  │  └────reject───► REJECTED ──edit + resubmit──► SUBMITTED
 *     └──── withdraw ────┘
 * The submitter edits only DRAFT / REJECTED. Nobody decides their own expense.
 * Approved and rejected records are never deleted; every decision is kept.
 */
export const EXPENSE_TRANSITIONS = {
  SUBMIT: { from: ["DRAFT", "REJECTED"], to: "SUBMITTED" },
  WITHDRAW: { from: ["SUBMITTED"], to: "DRAFT" },
  APPROVE: { from: ["SUBMITTED"], to: "APPROVED" },
  REJECT: { from: ["SUBMITTED"], to: "REJECTED" },
} as const satisfies Record<string, { from: ExpenseStatus[]; to: ExpenseStatus }>;
export type ExpenseEvent = keyof typeof EXPENSE_TRANSITIONS;

export const EXPENSE_EDITABLE: ExpenseStatus[] = ["DRAFT", "REJECTED"];

export function canApplyExpenseEvent(from: ExpenseStatus, event: ExpenseEvent): boolean {
  return (EXPENSE_TRANSITIONS[event].from as readonly ExpenseStatus[]).includes(from);
}

export const EXPENSE_PAGE_SIZE = 50;
