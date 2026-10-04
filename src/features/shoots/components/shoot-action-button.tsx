"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeMyPartAction, startShootAction } from "@/features/shoots/actions";
import type { ShootNextAction } from "@/features/shoots/types";

const COPY: Record<NonNullable<ShootNextAction>, { label: string; done: string }> = {
  START_SHOOT: { label: "Start shoot", done: "Shoot started" },
  START_MY_PART: { label: "Start my part", done: "You're on" },
  COMPLETE_MY_PART: { label: "Mark my part done", done: "Your part is done" },
};

/** Crew member's single next step on a shoot. The server re-checks everything. */
export function ShootActionButton({
  shootId,
  action,
  className,
}: {
  shootId: string;
  action: ShootNextAction;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!action) return null;
  const copy = COPY[action];
  const Icon = action === "COMPLETE_MY_PART" ? CheckCheck : Play;

  return (
    <Button
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res =
            action === "COMPLETE_MY_PART"
              ? await completeMyPartAction({ shootId })
              : await startShootAction({ shootId });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          toast.success(copy.done);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Icon data-icon="inline-start" />}
      {copy.label}
    </Button>
  );
}
