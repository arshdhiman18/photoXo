import "server-only";
import { Schema, type Model } from "mongoose";
import { defineModel } from "./define";

/** Atomic sequences, e.g. `${agencyId}:${brandId}:content` → MAM-0142. */
export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { collection: "counters", versionKey: false },
);

export const CounterModel: Model<CounterDoc> = defineModel<CounterDoc>("Counter", counterSchema);
