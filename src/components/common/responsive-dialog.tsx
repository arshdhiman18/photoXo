"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";

/**
 * Centered dialog on ≥640px, bottom sheet on phones (thumb-reachable,
 * keyboard-friendly). Same content either way.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)", true);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* DialogContent is a grid: min-w-0 on its children stops one long
            unbreakable value (e.g. a URL) from stretching the dialog. */}
        <DialogContent className="sm:max-w-md [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="pb-safe max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl"
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />
        <SheetHeader className="text-left">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-w-0 px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
