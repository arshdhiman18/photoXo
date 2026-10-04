import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { BoardFilters } from "@/features/shoots/components/board-filters";
import { ShootBoard } from "@/features/shoots/components/shoot-board";
import { boardQuerySchema } from "@/features/shoots/schemas";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageShoots } from "@/server/authz/permissions";
import { listBrandOptions } from "@/server/services/brands.service";
import { listShootsForAdmin } from "@/server/services/shoots.service";
import { listCrewPeople } from "@/server/services/users.service";

export const metadata: Metadata = { title: "Production" };

export default async function ProductionBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageShoots(actor)) return <AccessDenied backHref="/admin" />;
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" ? raw[k] : undefined);
  const query = boardQuerySchema.parse({
    date: one("date"),
    view: one("view"),
    brand: one("brand"),
    status: one("status"),
    crew: one("crew"),
    conflicts: one("conflicts"),
  });
  const [board, brands, people] = await Promise.all([
    listShootsForAdmin(actor, query),
    listBrandOptions(actor),
    listCrewPeople(actor),
  ]);
  const conflictCount = board.items.filter((i) => i.conflicts.length > 0).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Production board"
        description="Who is going where, when, for which brand — and what they're shooting."
        actions={
          <Button asChild>
            <Link href={`/admin/shoots/new?date=${board.from}`}>
              <Plus data-icon="inline-start" />
              New shoot
            </Link>
          </Button>
        }
      />
      <BoardFilters
        query={query}
        from={board.from}
        to={board.to}
        today={board.today}
        view={board.view}
        brands={brands}
        people={people}
      />
      {conflictCount > 0 && !query.conflicts && (
        <p className="rounded-lg border border-tone-danger/30 bg-tone-danger-bg/60 px-3.5 py-2.5 text-sm text-tone-danger">
          {conflictCount} shoot{conflictCount === 1 ? " has" : "s have"} crew double-booked in this period.
        </p>
      )}
      <ShootBoard
        items={board.items}
        today={board.today}
        emptyTitle={query.conflicts ? "No conflicts" : "No shoots scheduled"}
        emptyDescription={query.conflicts ? "Nobody is double-booked in this period." : "Schedule a shoot for this day or switch to the week view."}
      />
    </div>
  );
}
