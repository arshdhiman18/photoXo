import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { contentTypeLabel } from "@/features/content/components/content-bits";
import type { ContentClientDTO } from "@/features/content/types";

/** Client-safe list: title, brand, type and a client-facing status label only. */
export function ClientContentList({ items }: { items: ContentClientDTO[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/client/content/${c.id}`}
            className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs hover:bg-subtle"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-pretty">{c.title}</span>
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                {c.brand.name} · {contentTypeLabel(c.contentType)}
              </span>
              <span className="mt-2 block text-sm font-medium sm:hidden">{c.statusLabel}</span>
            </span>
            <span className="hidden shrink-0 text-sm font-medium sm:block">{c.statusLabel}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
