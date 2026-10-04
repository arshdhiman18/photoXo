import "server-only";
import type { ShellUser } from "@/components/shell/types";
import type { Actor } from "@/server/authz/actor";

export const toShellUser = (a: Actor): ShellUser => ({
  id: a.userId,
  name: a.name,
  email: a.email,
  image: a.image,
  role: a.systemRole,
});
