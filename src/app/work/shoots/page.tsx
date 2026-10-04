import type { Metadata } from "next";
import Link from "next/link";
import { Camera } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { MyShootCard } from "@/features/shoots/components/my-shoot-card";
import { Workspace } from "@/lib/domain/roles";
import { addDays, formatCalendarDate, todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { listMyShoots } from "@/server/services/shoots.service";

export const metadata: Metadata = { title: "My shoots" };

/** The signed-in person's crew shoots: the next 30 days, or the last 30. Crew-only scope. */
export default async function MyShootsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const past = (await searchParams).when === "past";
  const { timezone } = await getAgencyContext(actor);
  const today = todayInTimeZone(timezone);
  const shoots = past ? (await listMyShoots(actor, addDays(today, -30), addDays(today, -1))).reverse() : await listMyShoots(actor, today, addDays(today, 30));
  const days = [...new Set(shoots.map((s) => s.date))];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My shoots" description={past ? "The last 30 days." : "The next 30 days."} />
      <nav aria-label="Period" className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
        {[
          ["Upcoming", "/work/shoots", !past],
          ["Past", "/work/shoots?when=past", past],
        ].map(([label, href, on]) => (
          <Link key={String(label)} href={String(href)} aria-current={on ? "page" : undefined} className={cn("inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground", on && "bg-card font-medium text-foreground shadow-sm")}>
            {label}
          </Link>
        ))}
      </nav>
      {shoots.length === 0 ? (
        <EmptyState icon={Camera} title={past ? "No recent shoots" : "No upcoming shoots"} description="Shoots you're on the crew for appear here." />
      ) : (
        days.map((d) => (
          <section key={d} aria-labelledby={`d-${d}`} className="flex flex-col gap-2">
            <h2 id={`d-${d}`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {d === today ? "Today · " : ""}
              {formatCalendarDate(d, { weekday: "long" })}
            </h2>
            <ul className="grid grid-cols-1 gap-2">
              {shoots
                .filter((s) => s.date === d)
                .map((s) => (
                  <li key={s.id}>
                    <MyShootCard shoot={s} />
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
