import { cookies } from "next/headers";
import { AdminShell } from "@/components/shell/admin-shell";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";
import { toShellUser } from "@/server/auth/shell-user";
import { canManageUsers } from "@/server/authz/permissions";
import { getUnreadCount } from "@/server/services/notifications.service";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireWorkspaceActor(Workspace.ADMIN);
  const sidebar = (await cookies()).get("sidebar_state")?.value;
  return (
    <AdminShell
      user={toShellUser(actor)}
      canAdminister={canManageUsers(actor)}
      defaultOpen={sidebar !== "false"}
      unread={await getUnreadCount(actor)}
    >
      {children}
    </AdminShell>
  );
}
