"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/common/responsive-dialog";
import { Button } from "@/components/ui/button";
import { archiveBrandAction, reactivateBrandAction } from "@/features/brands/actions";
import { BrandFormDialog } from "@/features/brands/components/brand-form-dialog";
import type { BrandDetailDTO } from "@/features/brands/types";

export function BrandHeaderActions({ brand }: { brand: BrandDetailDTO }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();
  const archived = brand.status === "ARCHIVED";

  function toggleArchive() {
    start(async () => {
      const res = archived
        ? await reactivateBrandAction({ brandId: brand.id })
        : await archiveBrandAction({ brandId: brand.id });
      if (!res.ok) return void toast.error(res.error.message);
      toast.success(archived ? `${brand.name} reactivated` : `${brand.name} archived`);
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="outline" onClick={() => setEditOpen(true)}>
        <Pencil data-icon="inline-start" />
        Edit
      </Button>
      {archived ? (
        <Button variant="outline" onClick={toggleArchive} disabled={pending}>
          <ArchiveRestore data-icon="inline-start" />
          {pending ? "Reactivating…" : "Reactivate"}
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setConfirmOpen(true)}>
          <Archive data-icon="inline-start" />
          Archive
        </Button>
      )}

      {editOpen && <BrandFormDialog open={editOpen} onOpenChange={setEditOpen} brand={brand} />}

      <ResponsiveDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Archive ${brand.name}?`}
        description="The brand and its history are kept. It disappears from active lists and its team is frozen until reactivated."
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={toggleArchive} disabled={pending}>
            {pending ? "Archiving…" : "Archive brand"}
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
