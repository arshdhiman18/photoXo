import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { getExpenseFormOptions } from "@/server/services/expenses.service";
import { mediaEnabled } from "@/server/services/media.service";

export const metadata: Metadata = { title: "Add expense" };

export default async function NewExpensePage() {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const [options, agency] = await Promise.all([getExpenseFormOptions(actor), getAgencyContext(actor)]);
  return (
    <div className="flex flex-col gap-5">
      <Link href="/work/expenses" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        My expenses
      </Link>
      <PageHeader title="Add expense" description="Link it to a brand or shoot when it was for one." />
      <ExpenseForm options={options} today={todayInTimeZone(agency.timezone)} mediaEnabled={mediaEnabled()} backHref="/work/expenses" />
    </div>
  );
}
