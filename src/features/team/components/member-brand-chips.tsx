import Link from "next/link";
import type { MemberBrandDTO } from "@/features/team/types";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";
import type { SystemRole } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";

/** Compact brand chips for a person; each links to the brand's team. */
export function MemberBrandChips({
  brands,
  role,
  limit = 3,
}: {
  brands: MemberBrandDTO[];
  role: SystemRole;
  limit?: number;
}) {
  if (brands.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        {role === "ADMIN" || role === "MANAGER" ? "All brands" : "—"}
      </span>
    );
  }
  const shown = brands.slice(0, limit);
  const rest = brands.length - shown.length;
  return (
    <ul className="flex min-w-0 flex-wrap gap-1">
      {shown.map((b) => (
        <li key={b.id} className="min-w-0">
          <Link
            href={`/admin/brands/${b.id}/team`}
            title={`${b.name}: ${b.roles.map((r) => BRAND_ROLE_LABEL[r]).join(", ")}${b.archived ? " (archived)" : ""}`}
            className={cn(
              "relative z-10 inline-flex h-5 max-w-[9rem] items-center rounded-md border bg-card px-1.5 text-xs hover:bg-subtle [@media(pointer:coarse)]:h-7",
              b.archived && "text-muted-foreground line-through decoration-muted-foreground/40",
            )}
          >
            <span className="truncate">{b.name}</span>
          </Link>
        </li>
      ))}
      {rest > 0 && (
        <li className="inline-flex h-5 items-center text-xs text-muted-foreground">+{rest}</li>
      )}
    </ul>
  );
}
