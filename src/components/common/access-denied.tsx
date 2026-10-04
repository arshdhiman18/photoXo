import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Rendered when an authenticated user lacks a permission inside a workspace they can enter. */
export function AccessDenied({
  title = "You don't have permission to view this page",
  description = "This area is limited to administrators. If you need access, ask an admin.",
  backHref,
  backLabel = "Back to dashboard",
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-xs">
        <ShieldAlert className="size-5" strokeWidth={1.75} />
      </span>
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      {backHref && (
        <Button asChild variant="outline" className="mt-5">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      )}
    </div>
  );
}
