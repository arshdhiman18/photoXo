import { randomBytes } from "node:crypto";
import { inject } from "vitest";

// Test environment — set before any application module (and env.ts) loads.
// Each test file gets its own database for isolation.
Object.assign(process.env, {
  NODE_ENV: "test",
  MONGODB_URI: inject("mongoUri"),
  MONGODB_DB_NAME: `photoxo_test_${randomBytes(4).toString("hex")}`,
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  APP_URL: "http://localhost:3000",
  APP_TIMEZONE: "Asia/Kolkata",
  APP_CURRENCY: "INR",
  RESEND_API_KEY: "",
  RESEND_FROM_EMAIL: "",
});
