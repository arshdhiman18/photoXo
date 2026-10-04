"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Send, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideExpenseAction, submitExpenseAction, withdrawExpenseAction } from "@/features/expenses/actions";
import type { ExpenseDTO } from "@/features/expenses/types";
import type { ActionResult } from "@/lib/action-result";

/** Owner actions (edit / submit / withdraw) and approver actions (approve / reject). Server re-checks all. */
export function ExpenseActions({ expense, editHref }: { expense: ExpenseDTO; editHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string[] | undefined>();

  const run = (fn: () => Promise<ActionResult<unknown>>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        if (res.error.fieldErrors?.reason) return setError(res.error.fieldErrors.reason);
        toast.error(res.error.message);
        return;
      }
      toast.success(ok);
      setMode(null);
      router.refresh();
    });

  if (!expense.canEdit && !expense.canSubmit && !expense.canWithdraw && !expense.canDecide) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {expense.canDecide && (
        <>
          <Button disabled={pending} onClick={() => (setReason(""), setError(undefined), setMode("APPROVED"))}>
            <Check data-icon="inline-start" />
            Approve
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => (setReason(""), setError(undefined), setMode("REJECTED"))}>
            <X data-icon="inline-start" />
            Reject
          </Button>
        </>
      )}
      {expense.canEdit && (
        <Button asChild variant="outline">
          <Link href={editHref}>
            <Pencil data-icon="inline-start" />
            Edit
          </Link>
        </Button>
      )}
      {expense.canSubmit && (
        <Button disabled={pending} onClick={() => run(() => submitExpenseAction({ expenseId: expense.id }), "Submitted for approval")}>
          <Send data-icon="inline-start" />
          {expense.status === "REJECTED" ? "Resubmit" : "Submit for approval"}
        </Button>
      )}
      {expense.canWithdraw && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => withdrawExpenseAction({ expenseId: expense.id }), "Withdrawn to draft")}>
          <Undo2 data-icon="inline-start" />
          Withdraw
        </Button>
      )}
      {mode && (
        <ResponsiveDialog
          open
          onOpenChange={(o) => !o && setMode(null)}
          title={mode === "APPROVED" ? "Approve this expense?" : "Reject this expense?"}
          description={mode === "APPROVED" ? "The employee is notified." : "The employee can correct it and resubmit."}
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ex-reason">{mode === "APPROVED" ? "Note (optional)" : "Reason"}</Label>
              <Textarea id="ex-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} />
              <FieldError messages={error} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setMode(null)}>
                Back
              </Button>
              <Button
                variant={mode === "REJECTED" ? "destructive" : "default"}
                disabled={pending || (mode === "REJECTED" && reason.trim().length < 3)}
                onClick={() => run(() => decideExpenseAction({ expenseId: expense.id, decision: mode, reason: reason || null }), mode === "APPROVED" ? "Approved" : "Rejected")}
              >
                {mode === "APPROVED" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        </ResponsiveDialog>
      )}
    </div>
  );
}
