import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BrandLogo } from "@/features/brands/components/brand-bits";
import { contentTypeLabel } from "@/features/content/components/content-bits";
import type { ClientApprovalItemDTO } from "@/features/approvals/types";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<ClientApprovalItemDTO["state"], string> = {
  AWAITING: "text-tone-info",
  CHANGES: "text-tone-warning",
  APPROVED: "text-tone-success",
};

/** Client-safe rows: title, brand, type and a client-facing label only. */
export function ClientApprovalList({ items }: { items: ClientApprovalItemDTO[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/client/content/${c.id}`}
            className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs hover:bg-subtle"
          >
            <BrandLogo name={c.brand.name} logoUrl={c.brand.logoUrl} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-pretty">{c.title}</span>
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                {c.brand.name} · {contentTypeLabel(c.contentType)}
              </span>
              <span className={cn("mt-1.5 block text-sm font-medium sm:hidden", STATE_TONE[c.state])}>{c.statusLabel}</span>
            </span>
            <span className={cn("hidden shrink-0 text-sm font-medium sm:block", STATE_TONE[c.state])}>{c.statusLabel}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
