import "server-only";
import { parseServerEnv } from "./env.schema";

/**
 * Validated server environment. Importing this module from client code fails
 * the build (`server-only`), so secrets can never reach the browser bundle.
 * Invalid configuration throws at startup with a readable message.
 */
export const env = parseServerEnv(process.env);
export type { ServerEnv } from "./env.schema";
