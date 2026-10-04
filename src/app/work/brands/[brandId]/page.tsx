import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { UserAvatar } from "@/components/common/user-avatar";
import { BrandLogo, SocialHandleList } from "@/features/brands/components/brand-bits";
import type { CoworkerDTO } from "@/features/brands/types";
import {
  BRAND_ROLE_GROUP_LABEL,
  BRAND_ROLE_LABEL,
  INTERNAL_BRAND_ROLES,
} from "@/lib/domain/brands";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { isAppError } from "@/server/authz/errors";
import { getCoworkers } from "@/server/services/brand-team.service";
import { getBrandPublic } from "@/server/services/brands.service";

export const metadata: Metadata = { title: "Brand" };

export default async function StaffBrandPage({ params }: { params: Promise<{ brandId: string }> }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const { brandId } = await params;

  let brand, team: CoworkerDTO[];
  try {
    [brand, team] = await Promise.all([
      getBrandPublic(actor, brandId),
      getCoworkers(actor, brandId),
    ]);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound(); // not on this brand
    throw error;
  }

  const groups = INTERNAL_BRAND_ROLES.map((role) => ({
    role,
    people: team.filter((c) => c.roles.includes(role)),
  })).filter((g) => g.people.length > 0);
  const me = team.find((c) => c.isYou);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/work/brands"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        My brands
      </Link>

      <header className="flex items-start gap-4">
        <BrandLogo name={brand.name} logoUrl={brand.logoUrl} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] leading-tight font-semibold tracking-tight">
            {brand.name}
          </h1>
          {me && (
            <p className="mt-1 text-sm text-muted-foreground">
              You&apos;re {me.roles.map((r) => BRAND_ROLE_LABEL[r]).join(" & ")} here
            </p>
          )}
          <SocialHandleList handles={brand.socialHandles} className="mt-2.5" />
        </div>
      </header>

      {brand.description && (
        <section className="rounded-xl border bg-card px-4 py-4 shadow-xs sm:px-5">
          <h2 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            About
          </h2>
          <p className="text-sm text-pretty whitespace-pre-line">{brand.description}</p>
        </section>
      )}

      <section className="rounded-xl border bg-card shadow-xs">
        <h2 className="border-b px-4 py-3 text-sm font-medium sm:px-5">Brand team</h2>
        <div className="divide-y">
          {groups.map((g) => (
            <div key={g.role} className="px-4 py-3 sm:px-5">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {BRAND_ROLE_GROUP_LABEL[g.role]}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {g.people.map((p) => (
                  <li key={p.userId} className="flex min-h-11 items-center gap-2.5">
                    <UserAvatar name={p.name} image={p.image} seed={p.userId} className="size-8" />
                    <span className="truncate text-sm">
                      {p.name}
                      {p.isYou && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
