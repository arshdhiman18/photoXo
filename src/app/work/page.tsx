import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/features/brands/components/brand-bits";
import { MyTaskCard } from "@/features/content/components/my-task-card";
import { MyShootCard } from "@/features/shoots/components/my-shoot-card";
import { Workspace } from "@/lib/domain/roles";
import { addDays, formatCalendarDate, formatLongDay, partOfDay, todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { listMyBrands } from "@/server/services/brands.service";
import { listMyShoots } from "@/server/services/shoots.service";
import { listMyTasks } from "@/server/services/tasks.service";

export const metadata: Metadata = { title: "My Day" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function SectionTitle({ id, children, href, linkLabel }: { id: string; children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {children}
      </h2>
      {href && (
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const agency = await getAgencyContext(actor);
  const today = todayInTimeZone(agency.timezone);
  const raw = (await searchParams).date;
  const date = typeof raw === "string" && DATE_RE.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : today;
  const isToday = date === today;

  const [brands, tasks, shoots] = await Promise.all([listMyBrands(actor), listMyTasks(actor), listMyShoots(actor, date)]);
  const upNext = tasks.filter((t) => t.status !== "COMPLETED").slice(0, 4);
  // Review work: my content that needs changes (action) or sits in review (waiting) — one row per content.
  const reviewWork = [...new Map(
    tasks
      .filter((t) => ["CHANGES_REQUESTED", "INTERNAL_REVIEW", "CLIENT_REVIEW"].includes(t.content.status))
      .map((t) => [t.content.id, t] as const),
  ).values()].sort((a, b) => Number(b.content.status === "CHANGES_REQUESTED") - Number(a.content.status === "CHANGES_REQUESTED"));
  const now = new Date();
  const dayHref = (d: string) => (d === today ? "/work" : `/work?date=${d}`);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Today · {formatLongDay(now, agency.timezone)}
        </p>
        <h1 className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight">
          Good {partOfDay(now, agency.timezone)}, {actor.name.split(" ")[0]}
        </h1>
      </div>

      <section aria-labelledby="my-shoots">
        <div className="mb-2 flex items-center gap-1">
          <Link href="/work/shoots" className="order-last ml-2 text-xs text-muted-foreground hover:text-foreground">
            All
          </Link>
          <h2 id="my-shoots" className="mr-auto text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {isToday ? "Today's shoots" : `Shoots · ${formatCalendarDate(date, { weekday: "long" })}`}
          </h2>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Previous day">
            <Link href={dayHref(addDays(date, -1))} scroll={false}>
              <ChevronLeft />
            </Link>
          </Button>
          {!isToday && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/work" scroll={false}>
                Today
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="icon-sm" aria-label="Next day">
            <Link href={dayHref(addDays(date, 1))} scroll={false}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
        {shoots.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-4 sm:px-5">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-subtle text-muted-foreground">
              <CalendarDays className="size-4" strokeWidth={1.75} />
            </span>
            <p className="text-sm text-muted-foreground">
              {isToday ? "No shoots for you today." : "No shoots for you on this day."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {shoots.map((s) => (
              <li key={s.id}>
                <MyShootCard shoot={s} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {reviewWork.length > 0 && (
        <section aria-labelledby="review-work">
          <SectionTitle id="review-work">Review &amp; changes</SectionTitle>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {reviewWork.map((t) => (
              <li key={t.content.id}>
                <Link href={`/work/content/${t.content.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.content.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t.brand.name}</span>
                  </span>
                  {t.content.status === "CHANGES_REQUESTED" ? (
                    <span className="shrink-0 text-xs font-medium text-tone-warning">Changes needed</span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">{t.content.status === "INTERNAL_REVIEW" ? "In internal review" : "With the client"}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upNext.length > 0 && (
        <section aria-labelledby="up-next">
          <SectionTitle id="up-next" href="/work/tasks" linkLabel="All tasks">
            Up next
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {upNext.map((t) => (
              <li key={t.id}>
                <MyTaskCard task={t} timeZone={agency.timezone} today={today} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {brands.length > 0 && (
        <section aria-labelledby="my-brands">
          <SectionTitle id="my-brands" href="/work/brands" linkLabel="View all">
            Your brands
          </SectionTitle>
          <ul className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {brands.map((b) => (
              <li key={b.id} className="shrink-0">
                <Link
                  href={`/work/brands/${b.id}`}
                  className="flex h-11 items-center gap-2 rounded-full border bg-card pr-3.5 pl-1.5 text-sm shadow-xs hover:bg-subtle"
                >
                  <BrandLogo name={b.name} logoUrl={b.logoUrl} size="sm" className="rounded-full" />
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
