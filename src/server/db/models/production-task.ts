import "server-only";
import { Schema, type Model, type Types } from "mongoose";
import {
  TASK_STATUSES,
  TASK_TYPES,
  type TaskSource,
  type TaskStatus,
  type TaskType,
} from "@/lib/domain/content";
import { defineModel } from "./define";

/**
 * A unit of production work on one content item. Never a stand-in for a
 * Shoot (physical events get their own entity in Stage 4).
 */
export interface ProductionTaskDoc {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  brandId: Types.ObjectId;
  contentId: Types.ObjectId;
  taskType: TaskType;
  title: string;
  /** Single accountable assignee (null = unassigned). */
  assignedTo: Types.ObjectId | null;
  status: TaskStatus;
  /** ROUTE = generated from the content's production route; MANUAL = added by a manager. */
  source: TaskSource;
  /** Index of the route step that generated it (ROUTE tasks). */
  routeStep: number | null;
  /** Set while the task waits for the content's shoot (route step after SHOOT). */
  waitingOn: "SHOOT" | null;
  sequence: number;
  dueDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ProductionTaskDoc>(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    contentId: { type: Schema.Types.ObjectId, ref: "Content", required: true },
    taskType: { type: String, enum: TASK_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: TASK_STATUSES, required: true },
    source: { type: String, enum: ["ROUTE", "MANUAL"], required: true },
    routeStep: { type: Number, default: null },
    waitingOn: { type: String, enum: ["SHOOT", null], default: null },
    sequence: { type: Number, required: true },
    dueDate: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "productionTasks" },
);

taskSchema.index({ agencyId: 1, assignedTo: 1, status: 1, dueDate: 1 });
taskSchema.index({ agencyId: 1, contentId: 1, sequence: 1 });
taskSchema.index({ agencyId: 1, brandId: 1, status: 1 });
// Overdue-task reminder scan.
taskSchema.index({ agencyId: 1, status: 1, dueDate: 1 });

export const ProductionTaskModel: Model<ProductionTaskDoc> = defineModel<ProductionTaskDoc>(
  "ProductionTask",
  taskSchema,
);
