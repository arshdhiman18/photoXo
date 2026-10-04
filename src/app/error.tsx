"use client";

import { ErrorState } from "@/components/common/error-state";

export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <ErrorState {...props} />
    </main>
  );
}
