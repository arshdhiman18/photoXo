"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { segment: "", label: "Overview" },
  { segment: "team", label: "Team" },
  { segment: "content", label: "Content" },
  { segment: "shoots", label: "Shoots" },
  { segment: "approvals", label: "Approvals" },
  { segment: "expenses", label: "Expenses" },
] as const;

/** Route-based tabs: each tab is a real URL (shareable, back-button friendly). */
export function BrandTabs({ brandId }: { brandId: string }) {
  const pathname = usePathname();
  const base = `/admin/brands/${brandId}`;
  return (
    <nav
      aria-label="Brand sections"
      className="-mx-4 [scrollbar-width:none] overflow-x-auto border-b px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => {
          const href = t.segment ? `${base}/${t.segment}` : base;
          const active = t.segment ? pathname.startsWith(href) : pathname === base;
          return (
            <li key={t.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground [@media(pointer:coarse)]:h-11",
                  active &&
                    "font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
