/**
 * Creates/updates MongoDB indexes. Run on deploy (production has
 * Mongoose autoIndex disabled):
 *
 *   npm run db:indexes
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { connectDb, disconnectDb, getDb } = await import("../src/server/db/connect");
  const models = await import("../src/server/db/models");
  await connectDb();
  try {
    // Every exported *Model — new models can never be forgotten here.
    const all = Object.entries(models)
      .filter(([name]) => name.endsWith("Model"))
      .map(
        ([, m]) =>
          m as { createIndexes(): Promise<unknown>; collection: { collectionName: string } },
      );
    for (const model of all) {
      await model.createIndexes();
      console.log(`✔ ${model.collection.collectionName}`);
    }

    // Better Auth collections (schema owned by Better Auth; we add lookup indexes).
    const db = getDb();
    await db.collection("sessions").createIndexes([
      { key: { token: 1 }, unique: true },
      { key: { userId: 1 } },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 }, // TTL cleanup of expired sessions
    ]);
    await db
      .collection("accounts")
      .createIndexes([{ key: { userId: 1 } }, { key: { providerId: 1, accountId: 1 } }]);
    await db
      .collection("verifications")
      .createIndexes([
        { key: { identifier: 1 } },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
      ]);
    await db.collection("rateLimits").createIndexes([{ key: { key: 1 } }]);
    console.log("✔ sessions, accounts, verifications, rateLimits");
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
