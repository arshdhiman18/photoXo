import "server-only";
import mongoose from "mongoose";
import { connectDb } from "./connect";

/**
 * Run `fn` in a MongoDB transaction. With `transactionAsyncLocalStorage`
 * enabled (connect.ts), every Mongoose operation inside `fn` — repositories,
 * audit log writes — joins the session automatically, so a business change
 * and its ActivityLog entry commit or roll back together.
 *
 * Better Auth's own adapter calls (sessions/accounts) are NOT part of the
 * transaction; keep those outside or make them idempotent.
 *
 * `fn` may be retried on transient transaction errors, so it must only perform
 * database work (no emails/HTTP calls inside).
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  await connectDb();
  return mongoose.connection.transaction(fn);
}
