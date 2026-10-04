import type { Metadata } from "next";
import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { AuthCard } from "@/components/common/auth-card";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "@/features/auth/components/accept-invite-form";
import { previewInvitation } from "@/server/services/invitations.service";

export const metadata: Metadata = { title: "Set up your account" };

const MESSAGES = {
  invalid: {
    title: "This invitation link isn't valid",
    body: "It may have been revoked or replaced by a newer invitation. Ask your administrator to send a new one.",
  },
  expired: {
    title: "This invitation has expired",
    body: "Invitation links are valid for 7 days. Ask your administrator to resend it.",
  },
  used: {
    title: "This invitation was already used",
    body: "Your account is set up. Sign in with your email and password.",
  },
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewInvitation(token);

  if (invite.state !== "valid") {
    const m = MESSAGES[invite.state];
    return (
      <AuthCard title={m.title} description={m.body}>
        <div className="flex flex-col items-start gap-4">
          <span className="inline-flex size-10 items-center justify-center rounded-lg border bg-subtle text-muted-foreground">
            <LinkIcon className="size-4" />
          </span>
          <Button
            asChild
            variant={invite.state === "used" ? "default" : "outline"}
            className="w-full"
          >
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join ${invite.agencyName}`}
      description={
        <>
          You&apos;ve been invited as{" "}
          <span className="font-medium text-foreground">{invite.roleLabel}</span>. Choose a password
          to activate your account.
        </>
      }
    >
      <AcceptInviteForm token={token} email={invite.email} defaultName={invite.name} />
    </AuthCard>
  );
}
