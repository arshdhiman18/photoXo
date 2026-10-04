import Link from "next/link";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExpenseFilters } from "@/features/expenses/schemas";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, EXPENSE_STATUS_LABEL, EXPENSE_STATUSES } from "@/lib/domain/expenses";
import { formatCalendarDate } from "@/lib/dates";

/** Server-rendered GET filter form (no JS needed; values validated server-side). */
export function ExpenseFiltersForm({
  action,
  f,
  people,
  brands,
  shoots,
  fixedBrand,
}: {
  action: string;
  f: ExpenseFilters;
  people: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  shoots: { id: string; title: string; date: string }[];
  fixedBrand?: boolean;
}) {
  return (
    <form action={action} method="get" className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3 shadow-xs sm:grid-cols-3 lg:grid-cols-7">
      <div className="grid gap-1">
        <Label htmlFor="xf-from" className="text-xs text-muted-foreground">From</Label>
        <Input id="xf-from" name="from" type="date" defaultValue={f.from} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="xf-to" className="text-xs text-muted-foreground">To</Label>
        <Input id="xf-to" name="to" type="date" defaultValue={f.to} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="xf-employee" className="text-xs text-muted-foreground">Employee</Label>
        <NativeSelect id="xf-employee" name="employee" defaultValue={f.employee ?? ""}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </NativeSelect>
      </div>
      {!fixedBrand && (
        <div className="grid gap-1">
          <Label htmlFor="xf-brand" className="text-xs text-muted-foreground">Brand</Label>
          <NativeSelect id="xf-brand" name="brand" defaultValue={f.brand ?? ""}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="grid gap-1">
        <Label htmlFor="xf-shoot" className="text-xs text-muted-foreground">Shoot</Label>
        <NativeSelect id="xf-shoot" name="shoot" defaultValue={f.shoot ?? ""}>
          <option value="">All shoots</option>
          {shoots.map((s) => (
            <option key={s.id} value={s.id}>{s.title} · {formatCalendarDate(s.date)}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="xf-category" className="text-xs text-muted-foreground">Category</Label>
        <NativeSelect id="xf-category" name="category" defaultValue={f.category ?? ""}>
          <option value="">All categories</option>
          {EXPENSE_CATEGORY_KEYS.map((c) => (
            <option key={c} value={c}>{EXPENSE_CATEGORIES[c].label}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="xf-status" className="text-xs text-muted-foreground">Status</Label>
        <NativeSelect id="xf-status" name="status" defaultValue={f.status ?? ""}>
          <option value="">Any status</option>
          {EXPENSE_STATUSES.map((s) => (
            <option key={s} value={s}>{EXPENSE_STATUS_LABEL[s]}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-7">
        <Button type="submit" size="sm">Apply filters</Button>
        <Button asChild type="button" size="sm" variant="ghost">
          <Link href={action}>Reset</Link>
        </Button>
      </div>
    </form>
  );
}
