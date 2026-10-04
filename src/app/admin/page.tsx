import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Users } from "lucide-react";
import { ShootBoard } from "@/features/shoots/components/shoot-board";
import { Workspace } from "@/lib/domain/roles";
import { formatLongDay, partOfDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageUsers } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listBrandOptions } from "@/server/services/brands.service";
import { getOperationsSummary } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Dashboard" };

/** Operational overview: what needs attention, where work stands, today's shoots. Links into the real pages. */
export default async function AdminDashboardPage() {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const [agency, summary, brands] = await Promise.all([getAgencyContext(actor), getOperationsSummary(actor), listBrandOptions(actor)]);
  const now = new Date();
  const firstName = actor.name.split(" ")[0];
  const attention = summary.attention.filter((a) => a.count > 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm text-muted-foreground">{formatLongDay(now, agency.timezone)}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-[22px]">
          Good {partOfDay(now, agency.timezone)}, {firstName}
        </h1>
      </div>

      {canManageUsers(actor) && brands.length === 0 && (
        <section aria-labelledby="setup" className="rounded-xl border bg-card shadow-xs">
          <div className="border-b px-5 py-4">
            <h2 id="setup" className="text-sm font-medium">
              Set up {agency.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">A few steps before production starts.</p>
          </div>
          <ul className="divide-y">
            {[
              { href: "/admin/team", icon: Users, title: "Invite your team", body: "Managers, production staff and clients" },
              { href: "/admin/brands", icon: Building2, title: "Add brands and assign teams", body: "Uploaders, crew roles and client access per brand" },
            ].map(({ href, icon: Icon, title, body }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-4 px-5 py-3.5 hover:bg-subtle">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-subtle">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block truncate text-sm text-muted-foreground">{body}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="attention" className="flex flex-col gap-3">
        <h2 id="attention" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {attention.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className={cn(
                    "flex h-full flex-col rounded-xl border bg-card px-4 py-3 shadow-xs hover:bg-subtle",
                    a.danger && "border-tone-danger/30",
                  )}
                >
                  <span className={cn("text-2xl font-semibold tabular-nums", a.danger && "text-tone-danger")}>{a.count}</span>
                  <span className="text-sm text-muted-foreground">{a.label}</span>
                  {"amountMinor" in a && a.amountMinor ? (
                    <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{formatMoney(a.amountMinor, summary.currency)}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pipeline" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="pipeline" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Content pipeline
          </h2>
          <span className="text-xs text-muted-foreground">{summary.postedThisWeek} posted in the last 7 days</span>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {summary.pipeline.map((p) => (
            <li key={p.label}>
              <Link href={p.href} className="flex h-full flex-col rounded-xl border bg-card px-3 py-3 shadow-xs hover:bg-subtle">
                <span className="text-xl font-semibold tabular-nums">{p.count}</span>
                <span className="truncate text-xs text-muted-foreground">{p.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="today-shoots" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="today-shoots" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Today&apos;s shoots{summary.shootsInProgress ? ` · ${summary.shootsInProgress} in progress` : ""}
          </h2>
          <Link href="/admin/production" className="text-xs text-muted-foreground hover:text-foreground">
            Production board
          </Link>
        </div>
        <ShootBoard items={summary.shootsToday} today={summary.today} emptyTitle="No shoots today" emptyDescription="Schedule one from the production board." />
      </section>
    </div>
  );
}
