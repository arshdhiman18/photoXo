import "server-only";
import { MongoClient, type Db } from "mongodb";
import { ConnectionString } from "mongodb-connection-string-url";
import mongoose from "mongoose";
import { env } from "@/lib/env";

/**
 * One MongoClient (one connection pool) per server process, shared by
 * Better Auth (native driver) and Mongoose. Cached on globalThis so Next.js
 * dev hot-reloads reuse it instead of opening a new pool on every edit.
 */
type MongoCache = {
  client: MongoClient;
  ready: Promise<void> | null;
};

const globalForMongo = globalThis as typeof globalThis & { __photoxoMongo?: MongoCache };

/** Puts MONGODB_DB_NAME into the URI path so the driver and Mongoose agree on the database. */
export function withDatabaseName(uri: string, dbName: string): string {
  const cs = new ConnectionString(uri);
  cs.pathname = `/${dbName}`;
  return cs.toString();
}

function getCache(): MongoCache {
  if (!globalForMongo.__photoxoMongo) {
    const client = new MongoClient(withDatabaseName(env.MONGODB_URI, env.MONGODB_DB_NAME), {
      appName: "photoxo",
      maxPoolSize: env.NODE_ENV === "production" ? 10 : 5,
      serverSelectionTimeoutMS: 10_000,
    });
    globalForMongo.__photoxoMongo = { client, ready: null };
  }
  return globalForMongo.__photoxoMongo;
}

// Fail fast instead of silently queueing queries when the DB is unreachable.
mongoose.set("bufferTimeoutMS", 10_000);
mongoose.set("strictQuery", true);
// Operations inside withTransaction() automatically join its session.
mongoose.set("transactionAsyncLocalStorage", true);
// Indexes are created explicitly (`npm run db:indexes`) in production.
mongoose.set("autoIndex", env.NODE_ENV !== "production");

/** Native client (lazily connects on first operation). Used by Better Auth. */
export function getMongoClient(): MongoClient {
  return getCache().client;
}

export function getDb(): Db {
  return getMongoClient().db(env.MONGODB_DB_NAME);
}

/**
 * Ensures the shared client is connected and Mongoose is bound to it.
 * Idempotent and cheap after the first call — every repository awaits it.
 */
export function connectDb(): Promise<void> {
  const cache = getCache();
  if (!cache.ready) {
    cache.ready = (async () => {
      await cache.client.connect();
      if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) {
        mongoose.connection.setClient(cache.client);
      }
    })().catch((error: unknown) => {
      cache.ready = null; // allow a retry on the next request
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`MongoDB connection failed: ${reason}`, { cause: error });
    });
  }
  return cache.ready;
}

/** For scripts/tests only. */
export async function disconnectDb(): Promise<void> {
  const cache = globalForMongo.__photoxoMongo;
  if (!cache) return;
  await mongoose.connection.close().catch(() => undefined);
  await cache.client.close();
  globalForMongo.__photoxoMongo = undefined;
}
