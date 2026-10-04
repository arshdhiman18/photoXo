import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/common/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { authFeatures } from "@/server/auth/auth";
import { getActor } from "@/server/auth/session";
import { homePathFor } from "@/server/authz/permissions";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-origin relative paths are honoured as post-login destinations. */
function safeNext(next: unknown): string | undefined {
  if (typeof next !== "string") return undefined;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return undefined;
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const actor = await getActor();
  if (actor) redirect(safeNext(params.next) ?? homePathFor(actor));

  return (
    <AuthCard title="Sign in to PhotoXo" description="Use the email address your agency invited.">
      <LoginForm
        next={safeNext(params.next)}
        googleEnabled={authFeatures.google}
        reset={params.reset === "1"}
      />
    </AuthCard>
  );
}
