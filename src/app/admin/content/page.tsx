import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { NewBriefButton } from "@/features/content/components/brief-form-dialog";
import { ContentFilters } from "@/features/content/components/content-filters";
import { ContentList } from "@/features/content/components/content-list";
import { contentListQuerySchema } from "@/features/content/schemas";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageContent } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listBrandOptions } from "@/server/services/brands.service";
import { listCrewPeople } from "@/server/services/users.service";
import { listContentAdmin } from "@/server/services/content.service";

export const metadata: Metadata = { title: "Content" };

export default async function ContentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageContent(actor)) return <AccessDenied backHref="/admin" />;
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" ? raw[k] : undefined);
  const query = contentListQuerySchema.parse({
    q: one("q"),
    brand: one("brand"),
    type: one("type"),
    origin: one("origin"),
    status: one("status"),
    created: one("created"),
    archived: one("archived"),
    priority: one("priority"),
    due: one("due"),
    assignee: one("assignee"),
    page: one("page"),
  });
  const [data, brands, agency, people] = await Promise.all([
    listContentAdmin(actor, query),
    listBrandOptions(actor),
    getAgencyContext(actor),
    listCrewPeople(actor),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content"
        description="Every piece of content, from idea to posted."
        actions={<NewBriefButton brands={brands} />}
      />
      <ContentFilters query={query} brands={brands} people={people} ideasPending={data.ideasPending} />
      <ContentList
        data={data}
        query={query}
        timeZone={agency.timezone}
        today={todayInTimeZone(agency.timezone)}
        brands={brands}
      />
    </div>
  );
}
