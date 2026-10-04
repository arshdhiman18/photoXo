import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import {
  CREW_STATUSES,
  SHOOT_STATUSES,
  type CrewStatus,
  type ShootStatus,
} from "@/lib/domain/shoots";
import { BrandRole, type BrandRole as BrandRoleT } from "@/lib/domain/roles";
import { defineModel } from "./define";

/**
 * One crew assignment. Entries are never removed: removal sets CANCELLED so
 * who-was-assigned history survives. Only the user id is stored (profiles are
 * read live); brandRole is a historical snapshot of the role they attended as.
 */
export interface CrewEntry {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  brandRole: BrandRoleT;
  status: CrewStatus;
  /** Whether this person's completion is required for the shoot to complete. */
  required: boolean;
  assignedAt: Date;
  assignedBy: Types.ObjectId;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Who marked it complete (the crew member, or a manager on their behalf). */
  completedBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  notes: string | null;
}

export interface ShootLocation {
  name: string;
  address: string | null;
}

export interface RescheduleEntry {
  from: { date: string; startTime: string; endTime: string; location: ShootLocation };
  to: { date: string; startTime: string; endTime: string; location: ShootLocation };
  reason: string | null;
  by: Types.ObjectId;
  at: Date;
}

/**
 * A physical production event for ONE brand, producing MANY content items.
 * Never one shoot per content item. Rescheduling keeps the same record.
 */
export interface ShootDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  title: string;
  /** Agency-local calendar date "YYYY-MM-DD" and wall-clock times "HH:mm". */
  date: string;
  startTime: string;
  endTime: string;
  /** UTC instants derived from date/times in the agency time zone (overlap queries). */
  startAt: Date;
  endAt: Date;
  timezone: string;
  location: ShootLocation;
  notes: string | null;
  status: ShootStatus;
  /** Normalised relationship to Content (no content data duplicated here). */
  contentIds: Types.ObjectId[];
  crew: CrewEntry[];
  rescheduleHistory: RescheduleEntry[];
  /** Optimistic-concurrency counter, bumped by every mutation. */
  revision: number;
  startedAt: Date | null;
  startedBy: Types.ObjectId | null;
  partiallyCompletedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancellationReason: string | null;
  archivedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<ShootLocation>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    address: { type: String, default: null, maxlength: 300 },
  },
  { _id: false },
);

const crewSchema = new Schema<CrewEntry>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  brandRole: { type: String, enum: Object.values(BrandRole), required: true },
  status: { type: String, enum: CREW_STATUSES, required: true },
  required: { type: Boolean, required: true, default: true },
  assignedAt: { type: Date, required: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  completedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  cancelledAt: { type: Date, default: null },
  notes: { type: String, default: null, maxlength: 500 },
});

const slot = { date: String, startTime: String, endTime: String, location: locationSchema };

const shootSchema = new Schema<ShootDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    timezone: { type: String, required: true },
    location: { type: locationSchema, required: true },
    notes: { type: String, default: null, maxlength: 2000 },
    status: { type: String, enum: SHOOT_STATUSES, required: true },
    contentIds: { type: [Schema.Types.ObjectId], ref: "Content", default: [] },
    crew: { type: [crewSchema], default: [] },
    rescheduleHistory: {
      type: [
        new Schema(
          {
            from: slot,
            to: slot,
            reason: { type: String, default: null },
            by: { type: Schema.Types.ObjectId, ref: "User", required: true },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    revision: { type: Number, required: true, default: 0 },
    startedAt: { type: Date, default: null },
    startedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    partiallyCompletedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancellationReason: { type: String, default: null, maxlength: 500 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "shoots" },
);

shootSchema.index({ agencyId: 1, startAt: 1 }); // board / date ranges
shootSchema.index({ agencyId: 1, brandId: 1, startAt: 1 });
shootSchema.index({ agencyId: 1, status: 1, startAt: 1 });
// Overdue-shoot reminder scan.
shootSchema.index({ agencyId: 1, status: 1, endAt: 1 });
shootSchema.index({ agencyId: 1, "crew.userId": 1, startAt: 1 }); // My Day + conflicts
shootSchema.index({ agencyId: 1, contentIds: 1 }); // shoots for a content item

export const ShootModel: Model<ShootDoc> = defineModel<ShootDoc>("Shoot", shootSchema);
