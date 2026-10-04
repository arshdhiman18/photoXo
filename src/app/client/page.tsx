import { redirect } from "next/navigation";
import { Workspace } from "@/lib/domain/roles";
import { requireWorkspaceActor } from "@/server/auth/session";

/** The client home is their approval inbox. */
export default async function ClientHomePage() {
  await requireWorkspaceActor(Workspace.CLIENT);
  redirect("/client/approvals");
}
