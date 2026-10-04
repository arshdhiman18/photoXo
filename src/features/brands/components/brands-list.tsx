import Link from "next/link";
import { Archive, Building2, ChevronRight, SearchX, Send, Users } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BrandLogo, BrandStatusBadge } from "@/features/brands/components/brand-bits";
import { NewBrandButton } from "@/features/brands/components/brand-form-dialog";
import type { BrandListQuery } from "@/features/brands/schemas";
import type { BrandListData, BrandListItemDTO } from "@/features/brands/types";
import { SOCIAL_PLATFORM_LABEL } from "@/lib/domain/brands";

function TeamCounts({ b }: { b: BrandListItemDTO }) {
  return (
    <span className="inline-flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
      <span className="inline-flex items-center gap-1" title="Team members">
        <Users className="size-3.5" />
        {b.teamCount}
      </span>
      {b.clientCount > 0 && (
        <span title="Client users">
          {b.clientCount} client{b.clientCount === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );
}

function Uploader({ b }: { b: BrandListItemDTO }) {
  if (!b.primaryUploader) return <span className="text-sm text-tone-warning">Not set</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
      <Send className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{b.primaryUploader.name}</span>
    </span>
  );
}

export function BrandsList({ data, query }: { data: BrandListData; query: BrandListQuery }) {
  if (data.items.length === 0) {
    if (query.q) {
      return (
        <EmptyState
          icon={SearchX}
          title="No brands match your search"
          description="Try a different name, or check the Archived tab."
          action={
            <Button asChild variant="outline">
              <Link href="/admin/brands">Clear search</Link>
            </Button>
          }
        />
      );
    }
    if (query.status === "ARCHIVED") {
      return (
        <EmptyState
          icon={Archive}
          title="No archived brands"
          description="Archived brands are kept here with their history."
        />
      );
    }
    return (
      <EmptyState
        icon={Building2}
        title="No brands yet"
        description="Create your first brand, then assign its team, uploader and client users."
        action={<NewBrandButton variant="outline" />}
      />
    );
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (page: number) => {
    const p = new URLSearchParams();
    if (query.q) p.set("q", query.q);
    if (query.status) p.set("status", query.status);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `/admin/brands?${s}` : "/admin/brands";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden overflow-hidden rounded-xl border bg-card shadow-xs md:block">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[34%] pl-4">Brand</TableHead>
              <TableHead className="w-[16%]">Team</TableHead>
              <TableHead className="w-[18%]">Primary uploader</TableHead>
              <TableHead className="hidden w-[20%] lg:table-cell">Social</TableHead>
              <TableHead className="w-[12%]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((b) => (
              <TableRow key={b.id} className="group relative">
                <TableCell className="py-2.5 pl-4">
                  <Link
                    href={`/admin/brands/${b.id}`}
                    className="flex min-w-0 items-center gap-3 outline-none after:absolute after:inset-0 focus-visible:underline"
                  >
                    <BrandLogo name={b.name} logoUrl={b.logoUrl} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {b.slug}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <TeamCounts b={b} />
                </TableCell>
                <TableCell>
                  <Uploader b={b} />
                </TableCell>
                <TableCell className="hidden truncate text-sm text-muted-foreground lg:table-cell">
                  {b.socialHandles.length
                    ? b.socialHandles
                        .map((h) =>
                          h.platform === "OTHER" && h.label
                            ? h.label
                            : SOCIAL_PLATFORM_LABEL[h.platform],
                        )
                        .join(" · ")
                    : "—"}
                </TableCell>
                <TableCell>
                  <BrandStatusBadge status={b.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-2 md:hidden">
        {data.items.map((b) => (
          <li key={b.id}>
            <Link
              href={`/admin/brands/${b.id}`}
              className="flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-xs active:bg-subtle"
            >
              <BrandLogo name={b.name} logoUrl={b.logoUrl} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{b.name}</span>
                  {b.status === "ARCHIVED" && <BrandStatusBadge status={b.status} />}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <TeamCounts b={b} />
                  <Uploader b={b} />
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground tabular-nums">
            Page {data.page} of {pages}
          </p>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className={data.page <= 1 ? "pointer-events-none opacity-50" : undefined}
            >
              <Link href={href(data.page - 1)}>Previous</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className={data.page >= pages ? "pointer-events-none opacity-50" : undefined}
            >
              <Link href={href(data.page + 1)}>Next</Link>
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
