import "server-only";
import mongoose, { type Model, type Schema } from "mongoose";

/**
 * Registers a model once per process. In development, Next.js hot reload
 * re-evaluates model modules; reusing the cached model would keep a *stale
 * schema* (e.g. new enum values rejected), so the old model is replaced.
 * In production the module is evaluated once and the cache is reused.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  if (existing && process.env.NODE_ENV === "production") return existing;
  if (existing) mongoose.deleteModel(name);
  return mongoose.model<T>(name, schema);
}
