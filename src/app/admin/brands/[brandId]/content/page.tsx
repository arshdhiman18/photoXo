import type { Metadata } from "next";
import { ContentFilters } from "@/features/content/components/content-filters";
import { ContentList } from "@/features/content/components/content-list";
import { contentListQuerySchema } from "@/features/content/schemas";
import { Workspace } from "@/lib/domain/roles";
import { todayInTimeZone } from "@/lib/dates";
import { requireWorkspaceActor } from "@/server/auth/session";
import { getAgencyContext } from "@/server/services/agency.service";
import { listContentAdmin } from "@/server/services/content.service";
import { listCrewPeople } from "@/server/services/users.service";
import { loadAdminBrand } from "../load";

export const metadata: Metadata = { title: "Brand content" };

/** This brand's content (same list and filters as /admin/content, brand fixed). */
export default async function BrandContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const brand = await loadAdminBrand(actor, (await params).brandId);
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" ? raw[k] : undefined);
  const query = contentListQuerySchema.parse({
    ...Object.fromEntries(["q", "type", "origin", "status", "created", "archived", "priority", "due", "assignee", "page"].map((k) => [k, one(k)])),
    brand: brand.id,
  });
  const [data, agency, people] = await Promise.all([listContentAdmin(actor, query), getAgencyContext(actor), listCrewPeople(actor)]);
  const brands = [{ id: brand.id, name: brand.name }];
  return (
    <div className="flex flex-col gap-4">
      <ContentFilters query={query} brands={brands} people={people} ideasPending={data.ideasPending} />
      <ContentList data={data} query={query} timeZone={agency.timezone} today={todayInTimeZone(agency.timezone)} brands={brands} />
    </div>
  );
}
