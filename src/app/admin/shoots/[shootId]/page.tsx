import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { ShootContentPanel, ShootCrewPanel, ShootHeaderActions } from "@/features/shoots/components/shoot-admin-panels";
import { ConflictList, LocationLink, ShootStatusBadge, TimeRange } from "@/features/shoots/components/shoot-bits";
import { Workspace } from "@/lib/domain/roles";
import { formatCalendarDate, formatDate } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { canManageShoots } from "@/server/authz/permissions";
import { getShootForAdmin } from "@/server/services/shoots.service";

export const metadata: Metadata = { title: "Shoot" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border bg-card shadow-xs">
      <div className="flex min-h-12 items-center border-b px-4 py-2 sm:px-5">
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default async function AdminShootDetailPage({ params }: { params: Promise<{ shootId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageShoots(actor)) return <AccessDenied backHref="/admin" />;
  const { shootId } = await params;

  let s;
  try {
    s = await getShootForAdmin(actor, shootId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const activeCrew = s.crew.filter((c) => c.status !== "CANCELLED");
  const done = activeCrew.filter((c) => c.status === "COMPLETED").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={`/admin/production?date=${s.date}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Production board
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link href={`/admin/brands/${s.brand.id}/shoots`} className="text-xs font-medium text-muted-foreground hover:underline">
              {s.brand.name}
            </Link>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance sm:text-[22px]">{s.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="font-medium">{formatCalendarDate(s.date, { weekday: "long" })}</span>
              <TimeRange start={s.startTime} end={s.endTime} className="text-muted-foreground" />
              <ShootStatusBadge status={s.status} />
            </div>
            <div className="mt-1.5 flex min-w-0 flex-col gap-0.5 text-sm text-muted-foreground">
              <LocationLink location={s.location} />
              {s.location.address && <span className="truncate pl-[18px]">{s.location.address}</span>}
            </div>
          </div>
          <ShootHeaderActions shoot={s} />
        </div>
      </div>

      {s.conflicts.length > 0 && (
        <div className="rounded-xl border border-tone-danger/30 bg-tone-danger-bg/60 px-4 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-tone-danger">
            <AlertTriangle className="size-4" />
            Crew double-booked
          </p>
          <ConflictList conflicts={s.conflicts} />
        </div>
      )}
      {s.status === "CANCELLED" && s.cancellationReason && (
        <p className="rounded-xl border bg-tone-danger-bg/50 px-4 py-3 text-sm">
          <span className="font-medium">Cancelled:</span> {s.cancellationReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={`Content · ${s.contents.length}`}>
            <ShootContentPanel shoot={s} />
          </Section>
          <Section title="Production notes">
            <p className="px-4 py-4 text-sm text-pretty whitespace-pre-line text-muted-foreground sm:px-5">
              {s.notes ?? "No notes. Internal — never shown to clients."}
            </p>
          </Section>
          <Section title="History">
            {s.history.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No activity yet.</p>
            ) : (
              <ol className="divide-y">
                {s.history.map((h) => (
                  <li key={h.id} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-3 sm:px-5">
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums sm:w-36">
                      {formatDate(h.at, s.timezone, { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{h.label}</span>
                      {h.actorName && <span className="text-muted-foreground"> · {h.actorName}</span>}
                      {h.detail && <span className="block text-muted-foreground">{h.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={`Crew${activeCrew.length ? ` · ${done}/${activeCrew.length} done` : ""}`}>
            <ShootCrewPanel shoot={s} />
          </Section>
        </div>
      </div>
    </div>
  );
}
