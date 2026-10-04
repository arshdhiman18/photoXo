import type { ContentStatus, ContentType, ProductionRoute } from "@/lib/domain/content";
import type { BrandRole } from "@/lib/domain/roles";
import type { CrewStatus, ShootStatus } from "@/lib/domain/shoots";
import type { ReferenceDTO } from "@/features/content/types";

export interface ShootLocationDTO {
  name: string;
  address: string | null;
}

export interface CrewMemberDTO {
  /** Crew entry id (not the user id) — target for crew actions. */
  id: string;
  userId: string;
  name: string;
  image: string | null;
  brandRole: BrandRole;
  status: CrewStatus;
  required: boolean;
  completedAt: string | null;
  completedOnBehalf: boolean;
  isMe: boolean;
}

export interface ShootContentDTO {
  id: string;
  code: string;
  title: string;
  contentType: ContentType;
  status: ContentStatus;
  route: ProductionRoute;
  hasReferences: boolean;
}

export interface ConflictDTO {
  userId: string;
  userName: string;
  shootId: string;
  shootTitle: string;
  brandName: string;
  date: string;
  startTime: string;
  endTime: string;
  locationName: string;
}

/** Board / list row (admin). */
export interface ShootListItemDTO {
  id: string;
  title: string;
  brand: { id: string; name: string };
  date: string;
  startTime: string;
  endTime: string;
  location: ShootLocationDTO;
  status: ShootStatus;
  contentCount: number;
  contentSummary: string;
  crew: Pick<CrewMemberDTO, "id" | "userId" | "name" | "image" | "brandRole" | "status">[];
  conflicts: ConflictDTO[];
}

export interface ShootHistoryItemDTO {
  id: string;
  action: string;
  label: string;
  actorName: string | null;
  at: string;
  detail: string | null;
}

/** Full internal view (admin/manager). */
export interface ShootAdminDTO {
  id: string;
  title: string;
  brand: { id: string; name: string };
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  location: ShootLocationDTO;
  notes: string | null;
  status: ShootStatus;
  contents: ShootContentDTO[];
  crew: CrewMemberDTO[];
  conflicts: ConflictDTO[];
  cancellationReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  history: ShootHistoryItemDTO[];
}

export type ShootNextAction = "START_SHOOT" | "START_MY_PART" | "COMPLETE_MY_PART" | null;

/** A shoot in a crew member's My Day. */
export interface MyShootDTO {
  id: string;
  title: string;
  brand: { id: string; name: string; logoUrl: string | null };
  date: string;
  startTime: string;
  endTime: string;
  location: ShootLocationDTO;
  status: ShootStatus;
  myRole: BrandRole;
  myStatus: CrewStatus;
  contentCount: number;
  contentSummary: string;
  nextAction: ShootNextAction;
}

/**
 * Crew member's shoot view: production info only. Co-crew are shown by name
 * and role (no contact details, no audit, no other people's internal data).
 */
export interface ShootStaffDTO extends MyShootDTO {
  notes: string | null;
  contents: (ShootContentDTO & { canOpen: boolean })[];
  references: (ReferenceDTO & { contentTitle: string })[];
  crew: Pick<CrewMemberDTO, "id" | "name" | "image" | "brandRole" | "status" | "isMe">[];
}

export interface EligibleContentDTO extends ShootContentDTO {
  /** Already attached to this shoot (edit mode). */
  attached: boolean;
}

export interface CrewCandidateDTO {
  userId: string;
  name: string;
  image: string | null;
  roles: BrandRole[];
}

export interface ShootOptionsDTO {
  content: EligibleContentDTO[];
  crew: CrewCandidateDTO[];
}
