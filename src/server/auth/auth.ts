import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/lib/env";
import { UserStatus } from "@/lib/domain/roles";
import { getDb, getMongoClient } from "@/server/db/connect";
import { sendPasswordResetEmail } from "@/server/email/templates";
import { findUserStatusById, findUserStatusByEmail } from "./user-status";

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const options = {
  appName: "PhotoXo",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  telemetry: { enabled: false },

  // Collections: users, sessions, accounts, verifications, rateLimits
  database: mongodbAdapter(getDb(), { client: getMongoClient(), usePlural: true }),

  emailAndPassword: {
    enabled: true,
    // There is no public registration. Accounts are created only by admins
    // (invitations) or the create-admin bootstrap.
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      // Only active accounts can reset. Invited users must use their invite
      // link; suspended/deactivated users must contact an admin. Silently
      // skipping avoids account enumeration.
      const status = await findUserStatusByEmail(user.email);
      if (status !== UserStatus.ACTIVE) return;
      await sendPasswordResetEmail({ to: user.email, name: user.name, url });
    },
  },

  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          // Google can only sign in users who already exist (invited by an admin).
          disableImplicitSignUp: true,
          disableSignUp: true,
          prompt: "select_account",
        },
      }
    : undefined,

  account: {
    accountLinking: {
      enabled: googleEnabled,
      // Google verifies email ownership; link only to existing users.
      trustedProviders: googleEnabled ? ["google"] : [],
      allowDifferentEmails: false,
    },
  },

  user: {
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days, rolling
    updateAge: 60 * 60 * 24, // refresh at most daily
    // Cookie cache disabled on purpose: every request re-validates the
    // session against the database so suspension takes effect immediately.
    cookieCache: { enabled: false },
  },

  rateLimit: {
    enabled: env.NODE_ENV === "production",
    storage: "database", // serverless-safe (memory storage is per instance)
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
      "/reset-password": { window: 300, max: 5 },
    },
  },

  advanced: {
    useSecureCookies: env.APP_URL.startsWith("https://"),
    cookiePrefix: "photoxo",
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },

  databaseHooks: {
    user: {
      create: {
        // Defence in depth: Better Auth must never create users itself
        // (sign-up, implicit OAuth sign-up, plugins). Our services insert
        // users directly with agency/role/status.
        before: async () => {
          throw new APIError("FORBIDDEN", {
            message: "Accounts are created by invitation only.",
          });
        },
      },
    },
    session: {
      create: {
        // Only ACTIVE users may obtain a session (blocks invited, suspended
        // and deactivated accounts at sign-in, including via Google).
        before: async (session) => {
          const status = await findUserStatusById(String(session.userId));
          if (status !== UserStatus.ACTIVE) {
            throw new APIError("FORBIDDEN", {
              message:
                status === UserStatus.INVITED
                  ? "Your account is awaiting activation. Use the link in your invitation email."
                  : "This account is not active. Contact your administrator.",
            });
          }
        },
      },
    },
  },

  // Must be last: lets server actions that call auth.api set cookies.
  plugins: [nextCookies()],
} satisfies BetterAuthOptions;

export const auth = betterAuth(options);
export const authFeatures = { google: googleEnabled } as const;
