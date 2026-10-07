"use client";

import { useRef, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { InviteLinkDTO } from "@/features/team/types";

export interface IssuedInvite extends InviteLinkDTO {
  name: string;
  email: string;
}

/**
 * Shows a freshly issued invitation link so the admin can share it directly
 * (copy, or WhatsApp). The link is shown once — issuing a new one revokes it.
 */
export function InviteLinkDialog({
  invite,
  onOpenChange,
}: {
  invite: IssuedInvite | null;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  if (!invite) return null;

  const first = invite.name.split(" ")[0];
  const message =
    `Hi ${first}, you've been invited to join ${invite.agencyName} on PhotoXo. ` +
    `Open this link to set your password (it expires in ${invite.expiresInDays} days):\n${invite.url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite!.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
      toast.info("Press Ctrl+C (or long-press → Copy) to copy the selected link");
    }
  }

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => {
        if (!o) setCopied(false);
        onOpenChange(o);
      }}
      title={`Share ${first}'s invite link`}
      description={`Send this link to ${invite.email} on WhatsApp or any chat. It expires in ${invite.expiresInDays} days.`}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-link">Invite link</Label>
          <Input
            id="invite-link"
            ref={inputRef}
            readOnly
            value={invite.url}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button asChild>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle data-icon="inline-start" />
              Share on WhatsApp
            </a>
          </Button>
        </div>

        <div className="rounded-lg border bg-subtle px-3 py-2.5 text-xs text-muted-foreground">
          <p>
            Anyone with this link can set the password for this account — send it only to {first}.
            Getting a new link from the member&apos;s menu cancels this one.
          </p>
          {invite.delivery === "sent" && (
            <p className="mt-1.5">We also emailed it to {invite.email}.</p>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}
