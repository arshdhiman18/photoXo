"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * "Delete" with a confirmation step. When `disabledReason` is set, clicking
 * explains why it can't be deleted (and what to do instead) rather than
 * opening the confirmation.
 */
export function DeleteButton({
  label = "Delete",
  title,
  description,
  confirmLabel = "Delete permanently",
  disabledReason,
  run,
  onDeleted,
}: {
  label?: string;
  title: string;
  description: string;
  confirmLabel?: string;
  disabledReason?: string | null;
  run: () => Promise<ActionResult<unknown>>;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (disabledReason) {
    return (
      <Button
        variant="outline"
        onClick={() => toast.info("Can't delete this", { description: disabledReason })}
        title={disabledReason}
        className="text-muted-foreground"
      >
        <Trash2 data-icon="inline-start" />
        {label}
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="text-tone-danger">
        <Trash2 data-icon="inline-start" />
        {label}
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={title} description={description}>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await run();
                if (!res.ok) return void toast.error(res.error.message);
                setOpen(false);
                onDeleted();
              })
            }
          >
            {pending ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </ResponsiveDialog>
    </>
  );
}
