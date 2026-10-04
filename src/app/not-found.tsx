import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16 text-center">
        <div className="max-w-sm">
          <p className="font-mono text-sm text-muted-foreground">404</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight">
            This page doesn&apos;t exist
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            It may have moved, or you may not have access to it.
          </p>
          <Button asChild className="mt-6">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
