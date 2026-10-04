import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { InviteButton } from "@/features/team/components/invite-dialog";
import { TeamList } from "@/features/team/components/team-list";
import { TeamToolbar } from "@/features/team/components/team-toolbar";
import { teamListQuerySchema } from "@/features/team/schemas";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { canManageUsers } from "@/server/authz/permissions";
import { getAgencyContext } from "@/server/services/agency.service";
import { listTeam } from "@/server/services/users.service";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  if (!canManageUsers(actor)) {
    return (
      <AccessDenied
        description="User and role administration is limited to administrators."
        backHref="/admin"
      />
    );
  }

  const raw = await searchParams;
  const query = teamListQuerySchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });

  const [team, agency] = await Promise.all([listTeam(actor, query), getAgencyContext(actor)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Invite people, manage roles and control access."
        actions={<InviteButton />}
      />
      <TeamToolbar query={query} statusCounts={team.statusCounts} />
      <TeamList team={team} query={query} timeZone={agency.timezone} />
    </div>
  );
}
