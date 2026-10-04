/**
 * Local development database: a single-node MongoDB replica set (transactions
 * supported) persisted in ./.data/mongo. Use when you don't have Atlas
 * credentials yet.
 *
 *   npm run dev:db
 *   MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true
 *
 * Development only — never used in production.
 */
import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const portInUse = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });

async function main() {
  if (await portInUse(27017)) {
    console.log(
      "Port 27017 is already in use — a local MongoDB (possibly a previous dev:db) is running. Nothing to do.",
    );
    return;
  }
  const dbPath = path.resolve(".data/mongo");
  mkdirSync(dbPath, { recursive: true });

  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: "rs0", count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 27017, dbPath }], // binds to 127.0.0.1 by default
  });

  console.log("\nLocal MongoDB replica set running");
  console.log(`  URI:  mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true`);
  console.log(`  Data: ${dbPath}`);
  console.log("  Ctrl+C to stop.\n");

  const stop = async () => {
    await replSet.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
