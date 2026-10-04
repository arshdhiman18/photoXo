import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { ShootBoard } from "@/features/shoots/components/shoot-board";
import { Workspace } from "@/lib/domain/roles";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageShoots } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listShootsForAdmin } from "@/server/services/shoots.service";

export const metadata: Metadata = { title: "Shoots" };

export default async function ShootsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageShoots(actor)) return <AccessDenied backHref="/admin" />;
  const past = (await searchParams).when === "past";
  const { timezone } = await getAgencyContext(actor);
  const today = todayInTimeZone(timezone);
  const data = await listShootsForAdmin(
    actor,
    past ? { from: addDays(today, -60), to: addDays(today, -1) } : { from: today, to: addDays(today, 60) },
  );
  const items = past ? [...data.items].reverse() : data.items;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Shoots"
        description={past ? "The last 60 days." : "The next 60 days."}
        actions={
          <Button asChild>
            <Link href="/admin/shoots/new">
              <Plus data-icon="inline-start" />
              New shoot
            </Link>
          </Button>
        }
      />
      <nav aria-label="Period" className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        {[
          ["Upcoming", "/admin/shoots", !past],
          ["Past", "/admin/shoots?when=past", past],
        ].map(([label, href, on]) => (
          <Link
            key={String(label)}
            href={String(href)}
            aria-current={on ? "page" : undefined}
            className={cn("inline-flex h-7 items-center rounded-md px-3 text-sm text-muted-foreground [@media(pointer:coarse)]:h-9", on && "bg-card font-medium text-foreground shadow-sm")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <ShootBoard
        items={items}
        today={today}
        emptyTitle={past ? "No past shoots" : "No upcoming shoots"}
        emptyDescription={past ? undefined : "Schedule one from here or the production board."}
      />
    </div>
  );
}
