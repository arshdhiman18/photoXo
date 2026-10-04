import "server-only";
import { defineModel } from "./define";
import { Schema, type Model, type Types } from "mongoose";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_KINDS,
  type ActivityAction,
  type ActivityEntityKind,
} from "@/lib/domain/activity";

/** Append-only audit trail. Never updated or deleted by application code. */
export interface ActivityLogDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  /** null = system / CLI (e.g. first-admin bootstrap). */
  actorId: Types.ObjectId | null;
  action: ActivityAction;
  entity: { kind: ActivityEntityKind; id: Types.ObjectId };
  brandId: Types.ObjectId | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const activityLogSchema = new Schema<ActivityLogDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, enum: ACTIVITY_ACTIONS, required: true },
    entity: {
      kind: { type: String, enum: ACTIVITY_ENTITY_KINDS, required: true },
      id: { type: Schema.Types.ObjectId, required: true },
    },
    brandId: { type: Schema.Types.ObjectId, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "activityLogs",
    minimize: false,
  },
);

activityLogSchema.index({ agencyId: 1, "entity.kind": 1, "entity.id": 1, createdAt: -1 });
activityLogSchema.index({ agencyId: 1, createdAt: -1 });
// Content timeline: events on related entities (tasks, versions, approvals, postings) carry meta.contentId.
activityLogSchema.index(
  { agencyId: 1, "meta.contentId": 1, createdAt: -1 },
  { partialFilterExpression: { "meta.contentId": { $exists: true } } },
);

export const ActivityLogModel: Model<ActivityLogDoc> = defineModel<ActivityLogDoc>(
  "ActivityLog",
  activityLogSchema,
);
