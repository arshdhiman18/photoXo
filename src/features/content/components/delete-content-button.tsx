"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeleteButton } from "@/components/common/delete-button";
import { deleteContentAction } from "@/features/content/actions";

export function DeleteContentButton({
  contentId,
  title,
  blockedReason,
}: {
  contentId: string;
  title: string;
  blockedReason: string | null;
}) {
  const router = useRouter();
  return (
    <DeleteButton
      title={`Delete “${title}”?`}
      description="It's removed permanently, with its tasks. This can't be undone."
      disabledReason={blockedReason ? `${blockedReason} Cancel or archive it instead.` : null}
      run={() => deleteContentAction({ contentId })}
      onDeleted={() => {
        toast.success("Content deleted");
        router.push("/admin/content");
      }}
    />
  );
}
