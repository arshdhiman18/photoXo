import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Send } from "lucide-react";
import { UserAvatar } from "@/components/common/user-avatar";
import { SocialHandleList } from "@/features/brands/components/brand-bits";
import { BRAND_ROLE_GROUP_LABEL } from "@/lib/domain/brands";
import { Workspace } from "@/lib/domain/roles";
import { formatDate } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { getBrandTeam } from "@/server/services/brand-team.service";
import { loadAdminBrand } from "./load";

export const metadata: Metadata = { title: "Brand overview" };

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export default async function BrandOverviewPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const { brandId } = await params;
  const brand = await loadAdminBrand(actor, brandId);
  const [team, agency] = await Promise.all([getBrandTeam(actor, brandId), getAgencyContext(actor)]);

  const uploaders = team.groups.find((g) => g.role === "UPLOADER")?.members ?? [];
  const primary = uploaders.find((m) => m.isPrimaryUploader);
  const summary = team.groups.filter((g) => g.members.length > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <Section title="About">
          {brand.description ? (
            <p className="text-sm text-pretty whitespace-pre-line">{brand.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No description yet. Add tone of voice, products and audience via Edit.
            </p>
          )}
        </Section>
        <Section title="Social handles">
          {brand.socialHandles.length ? (
            <SocialHandleList handles={brand.socialHandles} />
          ) : (
            <p className="text-sm text-muted-foreground">No social handles added.</p>
          )}
        </Section>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Section title="Content uploader">
          {primary ? (
            <div className="flex items-center gap-3">
              <UserAvatar
                name={primary.name}
                image={primary.image}
                seed={primary.userId}
                className="size-8"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{primary.name}</p>
                <p className="text-xs text-muted-foreground">
                  Primary · receives everything Ready to Post
                  {uploaders.length > 1 &&
                    ` · ${uploaders.length - 1} backup${uploaders.length > 2 ? "s" : ""}`}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 text-sm">
              <Send className="mt-0.5 size-4 shrink-0 text-tone-warning" />
              <p className="text-pretty text-muted-foreground">
                No primary uploader. Ready-to-post content for this brand will have no default
                owner.{" "}
                <Link
                  href={`/admin/brands/${brandId}/team`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Assign one
                </Link>
              </p>
            </div>
          )}
          {team.primaryUploaderUnavailable && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-tone-warning-bg px-2.5 py-2 text-xs text-tone-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              The primary uploader&apos;s account isn&apos;t active. Choose another primary
              uploader.
            </p>
          )}
        </Section>

        <Section
          title={`Team · ${team.activeMemberCount}`}
          action={
            <Link
              href={`/admin/brands/${brandId}/team`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Manage <ArrowRight className="size-3" />
            </Link>
          }
        >
          {summary.length ? (
            <dl className="grid gap-2 text-sm">
              {summary.map((g) => (
                <div key={g.role} className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">{BRAND_ROLE_GROUP_LABEL[g.role]}</dt>
                  <dd className="min-w-0 truncate text-right">
                    {g.members.map((m) => m.name.split(" ")[0]).join(", ")}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
          )}
        </Section>

        <p className="px-1 text-xs text-muted-foreground">
          Created {formatDate(brand.createdAt, agency.timezone)} · Updated{" "}
          {formatDate(brand.updatedAt, agency.timezone)}
        </p>
      </div>
    </div>
  );
}
