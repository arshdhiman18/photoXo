import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { homePathFor } from "@/server/authz/permissions";

/** Entry point: route each user to their home workspace. */
export default async function RootPage() {
  const actor = await getActor();
  redirect(actor ? homePathFor(actor) : "/login");
}
