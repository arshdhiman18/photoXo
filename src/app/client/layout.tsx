import { ClientShell } from "@/components/shell/client-shell";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { toShellUser } from "@/server/auth/shell-user";
import { getUnreadCount } from "@/server/services/notifications.service";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireWorkspaceActor(Workspace.CLIENT);
  return (
    <ClientShell user={toShellUser(actor)} unread={await getUnreadCount(actor)}>
      {children}
    </ClientShell>
  );
}
