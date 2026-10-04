"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Error boundary body. Never shows raw error details (digest only, for support). */
export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border bg-card text-tone-danger shadow-xs">
        <TriangleAlert className="size-5" strokeWidth={1.75} />
      </span>
      <h1 className="text-base font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        We couldn&apos;t load this page. Try again — if it keeps happening, let your administrator
        know.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">Ref: {error.digest}</p>
      )}
      <Button variant="outline" className="mt-5" onClick={reset}>
        <RotateCcw data-icon="inline-start" />
        Try again
      </Button>
    </div>
  );
}
