import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getActor } from "@/server/auth/session";
import { homePathFor } from "@/server/authz/permissions";

export const metadata: Metadata = { title: "No access" };

/** Shown when an authenticated user opens a workspace their role can't enter. */
export default async function ForbiddenPage() {
  const actor = await getActor();
  return (
    <div className="flex min-h-dvh flex-col bg-subtle">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto mb-4 inline-flex size-11 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-xs">
            <ShieldAlert className="size-5" strokeWidth={1.75} />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">
            You don&apos;t have permission to access this workspace
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Your account doesn&apos;t include this area. If you think this is a mistake, contact
            your administrator.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href={actor ? homePathFor(actor) : "/login"}>
              {actor ? "Go to your workspace" : "Sign in"}
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
