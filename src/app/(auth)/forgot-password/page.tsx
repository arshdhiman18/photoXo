import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/common/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/password-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send a reset link if an active account exists."
      footer={
        <Link href="/login" className="text-muted-foreground hover:text-foreground">
          ← Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
