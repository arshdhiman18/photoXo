import Link from "next/link";
import { MailQuestion, SearchX, Users } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { RoleBadge, UserStatusBadge } from "@/components/common/tone-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InviteButton } from "@/features/team/components/invite-dialog";
import { MemberActions } from "@/features/team/components/member-actions";
import { MemberBrandChips } from "@/features/team/components/member-brand-chips";
import type { TeamListQuery } from "@/features/team/schemas";
import { UserStatus } from "@/lib/domain/roles";
import { formatDate, relativeDays } from "@/lib/dates";
import type { TeamListData, TeamMemberDTO } from "@/features/team/types";

function MemberIdentity({ m }: { m: TeamMemberDTO }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar name={m.name} image={m.image} seed={m.id} className="size-8" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{m.name}</span>
          {m.isSelf && (
            <span className="shrink-0 text-xs font-normal text-muted-foreground">(you)</span>
          )}
        </p>
        <p className="truncate text-sm text-muted-foreground">{m.email}</p>
      </div>
    </div>
  );
}

function StatusCell({ m }: { m: TeamMemberDTO }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <UserStatusBadge status={m.status} />
      {m.status === UserStatus.INVITED && m.invitation && (
        <span
          className={
            m.invitation.expired ? "text-xs text-tone-danger" : "text-xs text-muted-foreground"
          }
        >
          {m.invitation.expired
            ? "Link expired"
            : `Link expires ${relativeDays(m.invitation.expiresAt)}`}
        </span>
      )}
    </div>
  );
}

function dateLabel(m: TeamMemberDTO, tz: string) {
  if (m.activatedAt) return `Joined ${formatDate(m.activatedAt, tz)}`;
  if (m.invitedAt) return `Invited ${formatDate(m.invitedAt, tz)}`;
  return `Added ${formatDate(m.createdAt, tz)}`;
}

function pageHref(query: TeamListQuery, page: number) {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.role) p.set("role", query.role);
  if (query.status) p.set("status", query.status);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/admin/team?${s}` : "/admin/team";
}

export function TeamList({
  team,
  query,
  timeZone,
}: {
  team: TeamListData;
  query: TeamListQuery;
  timeZone: string;
}) {
  const filtered = Boolean(query.q || query.role || query.status);

  if (team.items.length === 0) {
    if (query.status === UserStatus.INVITED && !query.q && !query.role) {
      return (
        <EmptyState
          icon={MailQuestion}
          title="No invitations pending"
          description="Everyone you've invited has set up their account."
          action={<InviteButton variant="outline" />}
        />
      );
    }
    return (
      <EmptyState
        icon={filtered ? SearchX : Users}
        title={filtered ? "No team members match these filters" : "No team members yet"}
        description={
          filtered
            ? "Try a different search, role or status."
            : "Invite managers, production staff and clients."
        }
        action={
          filtered ? (
            <Button asChild variant="outline">
              <Link href="/admin/team">Clear filters</Link>
            </Button>
          ) : (
            <InviteButton variant="outline" />
          )
        }
      />
    );
  }

  const onlyYou = !filtered && team.total === 1 && team.items[0]?.isSelf;
  const pages = Math.max(1, Math.ceil(team.total / team.pageSize));
  const from = (team.page - 1) * team.pageSize + 1;
  const to = from + team.items.length - 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Tablet & desktop: table. Activity column hides below 1280px. */}
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[34%] pl-4">Member</TableHead>
              <TableHead className="w-[11%]">Role</TableHead>
              <TableHead className="w-[17%]">Status</TableHead>
              <TableHead className="w-[26%]">Brands</TableHead>
              <TableHead className="hidden w-[14%] xl:table-cell">Activity</TableHead>
              <TableHead className="w-12 pr-3">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="py-2.5 pl-4">
                  <MemberIdentity m={m} />
                </TableCell>
                <TableCell>
                  <RoleBadge role={m.role} />
                </TableCell>
                <TableCell>
                  <StatusCell m={m} />
                </TableCell>
                <TableCell>
                  <MemberBrandChips brands={m.brands} role={m.role} />
                </TableCell>
                <TableCell className="hidden truncate text-sm text-muted-foreground xl:table-cell">
                  {dateLabel(m, timeZone)}
                </TableCell>
                <TableCell className="pr-3 text-right">
                  <MemberActions member={m} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phones: cards. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {team.items.map((m) => (
          <li key={m.id} className="rounded-xl border bg-card p-3.5 shadow-xs">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <MemberIdentity m={m} />
              </div>
              <MemberActions member={m} />
            </div>
            <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 pl-11">
              <RoleBadge role={m.role} />
              <StatusCell m={m} />
            </div>
            {m.brands.length > 0 && (
              <div className="mt-2 pl-11">
                <MemberBrandChips brands={m.brands} role={m.role} limit={4} />
              </div>
            )}
            <p className="mt-2 pl-11 text-xs text-muted-foreground">{dateLabel(m, timeZone)}</p>
          </li>
        ))}
      </ul>

      {onlyYou && (
        <EmptyState
          icon={Users}
          title="No team members yet"
          description="You're the only one here. Invite managers, production staff and clients to get started."
          action={<InviteButton variant="outline" />}
        />
      )}

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground tabular-nums">
            {from}–{to} of {team.total}
          </p>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={team.page <= 1}
              className={team.page <= 1 ? "pointer-events-none opacity-50" : undefined}
            >
              <Link href={pageHref(query, team.page - 1)} scroll={false}>
                Previous
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={team.page >= pages}
              className={team.page >= pages ? "pointer-events-none opacity-50" : undefined}
            >
              <Link href={pageHref(query, team.page + 1)} scroll={false}>
                Next
              </Link>
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
