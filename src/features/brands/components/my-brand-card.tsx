import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BrandLogo } from "@/features/brands/components/brand-bits";
import type { MyBrandDTO } from "@/features/brands/types";
import { BRAND_ROLE_LABEL } from "@/lib/domain/brands";

export function MyBrandCard({ brand, href }: { brand: MyBrandDTO; href?: string }) {
  const body = (
    <>
      <BrandLogo name={brand.name} logoUrl={brand.logoUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{brand.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {brand.myRoles.map((r) => BRAND_ROLE_LABEL[r]).join(" · ")}
        </span>
      </span>
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const cls = "flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-xs";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-subtle active:bg-subtle`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
