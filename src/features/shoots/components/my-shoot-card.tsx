import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BrandLogo } from "@/features/brands/components/brand-bits";
import { ShootActionButton } from "@/features/shoots/components/shoot-action-button";
import { CrewStatusBadge, LocationLink, ShootStatusBadge, TimeRange } from "@/features/shoots/components/shoot-bits";
import type { MyShootDTO } from "@/features/shoots/types";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";

/** One shoot on a crew member's day: when, where, for whom, what, and the next step. */
export function MyShootCard({ shoot }: { shoot: MyShootDTO }) {
  const s = shoot;
  return (
    <article className="rounded-xl border bg-card shadow-xs">
      <Link href={`/work/shoots/${s.id}`} className="flex items-start gap-3 px-4 pt-4 pb-3 hover:bg-subtle/50 sm:px-5">
        <BrandLogo name={s.brand.name} logoUrl={s.brand.logoUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <TimeRange start={s.startTime} end={s.endTime} className="text-sm font-semibold" />
          <p className="mt-0.5 truncate text-[15px] font-medium">{s.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {s.brand.name} · {BRAND_ROLE_LABEL[s.myRole]} · {s.contentCount ? s.contentSummary : "No content linked"}
          </p>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </Link>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 sm:px-5">
        <LocationLink location={s.location} className="mr-auto max-w-full text-sm text-muted-foreground" />
        <ShootStatusBadge status={s.status} />
        {s.status !== "SCHEDULED" && <CrewStatusBadge status={s.myStatus} />}
        <ShootActionButton shootId={s.id} action={s.nextAction} className="w-full sm:w-auto" />
      </div>
    </article>
  );
}
