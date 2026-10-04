import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/common/auth-card";
import { Button } from "@/components/ui/button";
import { ResetPasswordForm } from "@/features/auth/components/password-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;

  if (typeof token !== "string" || error) {
    return (
      <AuthCard
        title="This reset link isn't valid"
        description="Reset links expire after 1 hour and can be used once."
      >
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description="You'll be signed out of other devices.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
