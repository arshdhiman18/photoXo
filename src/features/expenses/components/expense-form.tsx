"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FieldError } from "@/components/common/field-error";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createExpenseAction, updateExpenseAction } from "@/features/expenses/actions";
import type { ExpenseDTO, ExpenseFormOptionsDTO } from "@/features/expenses/types";
import { MediaUploader, type UploadedFile } from "@/features/media/components/media-uploader";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS } from "@/lib/domain/expenses";
import { RECEIPT_MIME_TYPES } from "@/lib/domain/media";
import { minorToInput } from "@/lib/money";
import { formatCalendarDate } from "@/lib/dates";

type Errors = Record<string, string[] | undefined>;

/** Add / edit an expense. Amount is typed as text and converted to paise on the server (no floats). */
export function ExpenseForm({
  options,
  today,
  mediaEnabled,
  expense,
  backHref,
}: {
  options: ExpenseFormOptionsDTO;
  today: string;
  mediaEnabled: boolean;
  expense?: ExpenseDTO;
  backHref: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [brandId, setBrandId] = useState(expense?.brand?.id ?? "");
  const [shootId, setShootId] = useState(expense?.shoot?.id ?? "");
  const [receipt, setReceipt] = useState<UploadedFile[]>([]);
  const submitNow = useRef(true); // which submit button was used
  const shoots = options.shoots.filter((s) => !brandId || s.brandId === brandId);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    const now = submitNow.current;
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    const fields = {
      title: get("title"),
      description: get("description"),
      category: get("category"),
      amount: get("amount"),
      incurredOn: get("incurredOn"),
      brandId,
      shootId,
      receiptUrl: get("receiptUrl"),
      receiptAssetId: receipt[0]?.assetId ?? "",
    };
    start(async () => {
      const res = expense
        ? await updateExpenseAction({ expenseId: expense.id, ...fields })
        : await createExpenseAction({ ...fields, submit: now });
      if (!res.ok) {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        else toast.error(res.error.message);
        return;
      }
      toast.success(expense ? "Expense updated" : now ? "Expense submitted for approval" : "Draft saved");
      const id = expense?.id ?? (res.data as { id: string }).id;
      router.push(`${backHref}/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="ex-title">Title</Label>
        <Input id="ex-title" name="title" required maxLength={140} defaultValue={expense?.title} placeholder="e.g. Cab to the studio" aria-invalid={!!errors.title} />
        <FieldError messages={errors.title} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ex-amount">Amount (₹)</Label>
          <Input
            id="ex-amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={expense ? minorToInput(expense.amountMinor) : ""}
            placeholder="1250.00"
            aria-invalid={!!errors.amount}
          />
          <FieldError messages={errors.amount} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-date">Date</Label>
          <Input id="ex-date" name="incurredOn" type="date" required max={today} defaultValue={expense?.incurredOn ?? today} aria-invalid={!!errors.incurredOn} />
          <FieldError messages={errors.incurredOn} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-category">Category</Label>
          <NativeSelect id="ex-category" name="category" required defaultValue={expense?.category ?? ""} aria-invalid={!!errors.category}>
            <option value="" disabled>
              Choose…
            </option>
            {EXPENSE_CATEGORY_KEYS.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORIES[c].label}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors.category} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ex-brand">
            Brand <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <NativeSelect
            id="ex-brand"
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setShootId("");
            }}
            aria-invalid={!!errors.brandId}
          >
            <option value="">No brand</option>
            {options.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors.brandId} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-shoot">
            Shoot <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <NativeSelect
            id="ex-shoot"
            value={shootId}
            onChange={(e) => {
              setShootId(e.target.value);
              const s = options.shoots.find((x) => x.id === e.target.value);
              if (s) setBrandId(s.brandId);
            }}
            aria-invalid={!!errors.shootId}
          >
            <option value="">No shoot</option>
            {shoots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {formatCalendarDate(s.date)}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={errors.shootId} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ex-description">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id="ex-description" name="description" rows={2} maxLength={1000} defaultValue={expense?.description ?? ""} />
      </div>
      <fieldset className="grid gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Receipt</legend>
        {expense?.receipt && <p className="text-xs text-muted-foreground">A receipt is attached. Add a new one to replace it.</p>}
        {mediaEnabled && (
          <MediaUploader purpose="RECEIPT" accept={RECEIPT_MIME_TYPES.join(",")} value={receipt} onChange={setReceipt} label="Upload receipt" />
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ex-receipt" className="text-xs text-muted-foreground">
            {mediaEnabled ? "…or paste a link" : "Link to the receipt (photo, Drive, PDF)"}
          </Label>
          <Input id="ex-receipt" name="receiptUrl" inputMode="url" placeholder="https://" aria-invalid={!!errors.receiptUrl} />
          <FieldError messages={errors.receiptUrl ?? errors.receiptAssetId} />
        </div>
      </fieldset>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {expense ? (
          <Button type="submit" disabled={pending}>
            Save changes
          </Button>
        ) : (
          <>
            <Button type="submit" variant="outline" disabled={pending} onClick={() => (submitNow.current = false)}>
              Save draft
            </Button>
            <Button type="submit" disabled={pending} onClick={() => (submitNow.current = true)}>
              Submit for approval
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
