import { z } from "zod";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Database
    MONGODB_URI: z
      .string()
      .trim()
      .regex(/^mongodb(\+srv)?:\/\//, "must be a mongodb:// or mongodb+srv:// connection string"),
    MONGODB_DB_NAME: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default("photoxo"),

    // Authentication
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "must be at least 32 characters (generate with: openssl rand -base64 32)"),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,

    // Application
    APP_URL: z.url().transform((u) => u.replace(/\/+$/, "")),
    APP_TIMEZONE: z
      .string()
      .default("Asia/Kolkata")
      .refine(isValidTimeZone, "unknown IANA time zone"),
    APP_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/, "must be an ISO 4217 code, e.g. INR")
      .default("INR"),

    // Email
    RESEND_API_KEY: optionalString,
    RESEND_FROM_EMAIL: optionalString,

    // Media
    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,

    // Scheduled jobs endpoint (/api/jobs/tick): reminders, email delivery, retention
    CRON_SECRET: optionalString,
  })
  .superRefine((e, ctx) => {
    const isProd = e.NODE_ENV === "production";
    const require = (key: keyof typeof e, why: string) => {
      if (!e[key]) ctx.addIssue({ code: "custom", path: [key], message: why });
    };

    if (isProd) {
      require("RESEND_API_KEY", "required in production (invitations must really be delivered)");
      require("RESEND_FROM_EMAIL", "required in production");
      require("CRON_SECRET", "required in production (reminders, email delivery and retention run through /api/jobs/tick)");
      if (!e.APP_URL.startsWith("https://") && !/^http:\/\/localhost(:\d+)?$/.test(e.APP_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "must use https in production",
        });
      }
    }
    if (Boolean(e.RESEND_API_KEY) !== Boolean(e.RESEND_FROM_EMAIL)) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_FROM_EMAIL"],
        message: "RESEND_API_KEY and RESEND_FROM_EMAIL must be set together",
      });
    }
    if (Boolean(e.GOOGLE_CLIENT_ID) !== Boolean(e.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      });
    }
    if (e.CRON_SECRET && e.CRON_SECRET.length < 24) {
      ctx.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "must be at least 24 characters (generate with: openssl rand -base64 32)" });
    }
    const cloudinary = [e.CLOUDINARY_CLOUD_NAME, e.CLOUDINARY_API_KEY, e.CLOUDINARY_API_SECRET];
    if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["CLOUDINARY_CLOUD_NAME"],
        message:
          "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set together",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  • ${i}`).join("\n")}\n` +
        `See .env.example for the expected variables.`,
    );
    this.name = "EnvValidationError";
  }
}

/** Pure parser (unit-tested). Throws EnvValidationError listing every problem; never echoes values. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}
