import type { PersonRef } from "@/features/content/types";
import type { ExpenseCategory, ExpenseStatus } from "@/lib/domain/expenses";

export interface ExpenseReceiptDTO {
  kind: "LINK" | "MEDIA";
  /** Only ever sent to the claimant and ADMIN/MANAGER. Media URLs are short-lived signed URLs. */
  url: string;
  label: string | null;
}

export interface ExpenseReviewDTO {
  decision: "APPROVED" | "REJECTED";
  reason: string | null;
  decidedBy: PersonRef | null;
  decidedAt: string;
}

export interface ExpenseDTO {
  id: string;
  title: string;
  description: string | null;
  category: ExpenseCategory;
  amountMinor: number;
  currency: string;
  incurredOn: string;
  status: ExpenseStatus;
  employee: PersonRef | null;
  brand: { id: string; name: string } | null;
  shoot: { id: string; title: string; date: string } | null;
  receipt: ExpenseReceiptDTO | null;
  submittedAt: string | null;
  reviews: ExpenseReviewDTO[];
  createdAt: string;
  isMine: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canDecide: boolean;
}

export interface ExpenseTotalsDTO {
  count: number;
  totalMinor: number;
  submitted: { count: number; totalMinor: number };
  approved: { count: number; totalMinor: number };
  rejected: { count: number; totalMinor: number };
  draft: { count: number; totalMinor: number };
}

export interface ExpenseListDTO {
  items: ExpenseDTO[];
  totals: ExpenseTotalsDTO;
  page: number;
  hasMore: boolean;
  currency: string;
}

export interface ExpenseFormOptionsDTO {
  brands: { id: string; name: string }[];
  shoots: { id: string; title: string; date: string; brandId: string }[];
}
