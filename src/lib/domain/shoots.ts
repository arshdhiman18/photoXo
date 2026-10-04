/**
 * Shoot domain — single source of truth for shoot/crew states and crew
 * eligibility. Route definitions stay in content.ts (not duplicated here).
 */
import { BrandRole } from "./roles";
import { PRODUCTION_ROUTE_DEFS, type ProductionRoute } from "./content";

export const ShootStatus = {
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  PARTIALLY_COMPLETED: "PARTIALLY_COMPLETED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type ShootStatus = (typeof ShootStatus)[keyof typeof ShootStatus];
export const SHOOT_STATUSES = Object.values(ShootStatus);

export const SHOOT_STATUS_LABEL: Record<ShootStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  PARTIALLY_COMPLETED: "Partially complete",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SHOOT_STATUS_TONE: Record<ShootStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  SCHEDULED: "neutral",
  IN_PROGRESS: "info",
  PARTIALLY_COMPLETED: "warning",
  COMPLETED: "success",
  CANCELLED: "danger",
};

/** Shoots that hold their content and crew (a content item may be in at most one). */
export const ACTIVE_SHOOT_STATUSES: ShootStatus[] = ["SCHEDULED", "IN_PROGRESS", "PARTIALLY_COMPLETED"];
/** Shoots whose details, content and crew may still change. */
export const EDITABLE_SHOOT_STATUSES: ShootStatus[] = ACTIVE_SHOOT_STATUSES;

export const CrewStatus = {
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type CrewStatus = (typeof CrewStatus)[keyof typeof CrewStatus];
export const CREW_STATUSES = Object.values(CrewStatus);
export const CREW_STATUS_LABEL: Record<CrewStatus, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "On shoot",
  COMPLETED: "Done",
  CANCELLED: "Removed",
};

/**
 * Brand roles that qualify someone as physical shoot crew (configurable here).
 * EDITOR / DESIGNER / UPLOADER / CLIENT are deliberately excluded; add a role
 * here if the business wants, e.g., editors on set.
 */
export const SHOOT_CREW_ROLES: BrandRole[] = [
  BrandRole.BRAND_MANAGER,
  BrandRole.VIDEOGRAPHER,
  BrandRole.PHOTOGRAPHER,
  BrandRole.ASSISTANT,
  BrandRole.OTHER_PRODUCTION,
];

/** Whether a production route includes a physical shoot (route config is the source of truth). */
export function routeHasShoot(route: ProductionRoute): boolean {
  return PRODUCTION_ROUTE_DEFS[route].steps.some((s) => s.kind === "SHOOT");
}

/** Index of the SHOOT step in a route, or -1. */
export function shootStepIndex(route: ProductionRoute): number {
  return PRODUCTION_ROUTE_DEFS[route].steps.findIndex((s) => s.kind === "SHOOT");
}

export const MAX_SHOOT_CONTENT = 50;
export const MAX_SHOOT_CREW = 20;

/** "HH:mm" 24h. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * THE shoot completion rule (single source of truth, pure, unit-tested).
 *
 * Considers non-removed crew; if any are marked `required`, only they count.
 *  · all counted crew COMPLETED          → COMPLETED
 *  · at least one counted crew COMPLETED → PARTIALLY_COMPLETED
 *  · otherwise                           → IN_PROGRESS
 * A shoot with no counted crew can never complete.
 */
export function evaluateShootProgress(
  crew: { status: CrewStatus; required: boolean }[],
): "IN_PROGRESS" | "PARTIALLY_COMPLETED" | "COMPLETED" {
  const active = crew.filter((c) => c.status !== CrewStatus.CANCELLED);
  const required = active.filter((c) => c.required);
  const counted = required.length > 0 ? required : active;
  if (counted.length === 0) return "IN_PROGRESS";
  const done = counted.filter((c) => c.status === CrewStatus.COMPLETED).length;
  if (done === counted.length) return "COMPLETED";
  return done > 0 ? "PARTIALLY_COMPLETED" : "IN_PROGRESS";
}

/** Next self-service action for a crew member (drives My Day buttons). */
export function crewNextAction(
  shootStatus: ShootStatus,
  myStatus: CrewStatus,
): "START_SHOOT" | "START_MY_PART" | "COMPLETE_MY_PART" | null {
  if (shootStatus === "CANCELLED" || shootStatus === "COMPLETED") return null;
  if (myStatus === "COMPLETED" || myStatus === "CANCELLED") return null;
  if (shootStatus === "SCHEDULED") return "START_SHOOT";
  return myStatus === "ASSIGNED" ? "START_MY_PART" : "COMPLETE_MY_PART";
}
