import type { SystemRole } from "@/lib/domain/roles";

/**
 * The authenticated principal for a request. Built exclusively from the
 * verified session + a fresh database read (see server/auth/session.ts).
 * Never constructed from request input.
 */
export interface Actor {
  readonly userId: string;
  readonly agencyId: string;
  readonly systemRole: SystemRole;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}
