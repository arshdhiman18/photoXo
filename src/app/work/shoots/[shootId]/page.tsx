import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { UserAvatar } from "@/components/common/user-avatar";
import { ContentCode, ContentStatusBadge, contentTypeLabel } from "@/features/content/components/content-bits";
import { ReferenceCard } from "@/features/content/components/reference-card";
import { ShootActionButton } from "@/features/shoots/components/shoot-action-button";
import { CrewStatusBadge, LocationLink, ShootStatusBadge, TimeRange } from "@/features/shoots/components/shoot-bits";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";
import { Workspace } from "@/lib/domain/roles";
import { formatCalendarDate } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getShootForStaff } from "@/server/services/shoots.service";

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

export default async function StaffShootPage({ params }: { params: Promise<{ shootId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { shootId } = await params;

  let s;
  try {
    s = await getShootForStaff(actor, shootId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/work?date=${s.date}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        My Day
      </Link>

      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{s.brand.name}</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance">{s.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{formatCalendarDate(s.date, { weekday: "long" })}</span>
          <TimeRange start={s.startTime} end={s.endTime} className="text-muted-foreground" />
        </p>
        <div className="mt-1 flex min-w-0 flex-col gap-0.5 text-sm text-muted-foreground">
          <LocationLink location={s.location} />
          {s.location.address && <span className="truncate pl-[18px]">{s.location.address}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-xs sm:flex-row sm:items-center sm:px-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
          <span>
            You&apos;re the <span className="font-medium">{BRAND_ROLE_LABEL[s.myRole]}</span>
          </span>
          <ShootStatusBadge status={s.status} />
          {s.status !== "SCHEDULED" && <CrewStatusBadge status={s.myStatus} />}
        </div>
        <ShootActionButton shootId={s.id} action={s.nextAction} className="w-full sm:w-auto" />
      </div>

      <Section title={`What to shoot · ${s.contents.length}`}>
        {s.contents.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">No content linked yet — check with your manager.</p>
        ) : (
          <ul className="divide-y">
            {s.contents.map((c) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <ContentCode code={c.code} /> · {contentTypeLabel(c.contentType)}
                    </span>
                  </span>
                  <ContentStatusBadge status={c.status} />
                </>
              );
              return (
                <li key={c.id}>
                  {c.canOpen ? (
                    <Link href={`/work/content/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/50 sm:px-5">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {s.references.length > 0 && (
        <Section title={`References · ${s.references.length}`}>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
            {s.references.map((r) => (
              <div key={r.id} className="flex min-w-0 flex-col gap-1.5">
                <p className="truncate text-xs text-muted-foreground">For {r.contentTitle}</p>
                <ReferenceCard reference={r} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {s.notes && (
        <Section title="Production notes">
          <p className="px-4 py-4 text-sm text-pretty whitespace-pre-line sm:px-5">{s.notes}</p>
        </Section>
      )}

      <Section title="Crew">
        <ul className="divide-y">
          {s.crew.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <UserAvatar name={c.name} image={c.image} seed={c.id} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.name}
                  {c.isMe && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="block text-xs text-muted-foreground">{BRAND_ROLE_LABEL[c.brandRole]}</span>
              </span>
              {s.status !== "SCHEDULED" && <CrewStatusBadge status={c.status} />}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
