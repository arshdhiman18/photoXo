import { WorkShell } from "@/components/shell/work-shell";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { toShellUser } from "@/server/auth/shell-user";
import { canAccessWorkspace } from "@/server/authz/permissions";
import { getUnreadCount } from "@/server/services/notifications.service";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireWorkspaceActor(Workspace.WORK);
  const switchTo = canAccessWorkspace(actor, Workspace.ADMIN)
    ? [{ href: "/admin", label: "Open Admin" }]
    : undefined;
  return (
    <WorkShell user={toShellUser(actor)} switchTo={switchTo} unread={await getUnreadCount(actor)}>
      {children}
    </WorkShell>
  );
}
