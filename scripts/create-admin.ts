/**
 * One-time bootstrap: creates the agency and its first ADMIN.
 *
 *   npm run create-admin
 *
 * Prompts for agency name, admin name, email and password (hidden input).
 * Refuses to run once PhotoXo has been initialised — it cannot be used to
 * create additional admins. No defaults, no hardcoded credentials.
 *
 * Non-interactive use (CI/provisioning): pipe the answers on stdin, one per
 * line: agency name, admin name, email, password, password confirmation.
 */
import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline";
import { z } from "zod";

loadEnvConfig(process.cwd());

const answersSchema = z.object({
  agencyName: z.string().trim().min(2, "Agency name must be at least 2 characters").max(120),
  adminName: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
});

function createPrompter() {
  const interactive = Boolean(process.stdin.isTTY);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: interactive,
  });
  const queued: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  rl.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queued.push(line);
  });

  let muted = false;
  const rlAny = rl as unknown as {
    _writeToOutput: (s: string) => void;
    output: NodeJS.WriteStream;
  };
  const originalWrite = rlAny._writeToOutput?.bind(rl);
  if (interactive && originalWrite) {
    rlAny._writeToOutput = (s: string) => {
      if (!muted) originalWrite(s);
      else if (s.includes("\n")) originalWrite("\n");
      else originalWrite("*".repeat(s.length > 0 ? 1 : 0));
    };
  }

  function ask(question: string, hidden = false): Promise<string> {
    process.stdout.write(question);
    if (!interactive) process.stdout.write("\n");
    muted = hidden && interactive;
    return new Promise((resolve) => {
      const done = (line: string) => {
        muted = false;
        resolve(line);
      };
      const q = queued.shift();
      if (q !== undefined) done(q);
      else waiting.push(done);
    });
  }

  return { ask, close: () => rl.close() };
}

async function main() {
  // Imported after env is loaded (env.ts validates at import time).
  const { initializeAgencyWithFirstAdmin } =
    await import("../src/server/services/bootstrap.service");
  const { disconnectDb } = await import("../src/server/db/connect");
  const { newPassword } = await import("../src/lib/validation");
  const { env } = await import("../src/lib/env");

  console.log("\nPhotoXo · first admin setup\n");
  const prompt = createPrompter();
  try {
    const raw = {
      agencyName: await prompt.ask("Agency name: "),
      adminName: await prompt.ask("Your full name: "),
      adminEmail: await prompt.ask("Your email: "),
    };
    const parsed = answersSchema.safeParse(raw);
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("\n"));

    const password = await prompt.ask("Password (min 12 characters): ", true);
    const pwCheck = newPassword.safeParse(password);
    if (!pwCheck.success) throw new Error(pwCheck.error.issues.map((i) => i.message).join("\n"));
    const confirm = await prompt.ask("Confirm password: ", true);
    if (confirm !== password) throw new Error("Passwords don't match.");

    const result = await initializeAgencyWithFirstAdmin({
      ...parsed.data,
      adminPassword: password,
      timezone: env.APP_TIMEZONE,
      currency: env.APP_CURRENCY,
    });

    console.log(
      `\n✔ Created agency "${parsed.data.agencyName}" (${env.APP_TIMEZONE}, ${env.APP_CURRENCY})`,
    );
    console.log(`✔ Created admin ${parsed.data.adminEmail} (id ${result.userId})`);
    console.log(`\nSign in at ${env.APP_URL}/login\n`);
  } finally {
    prompt.close();
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
