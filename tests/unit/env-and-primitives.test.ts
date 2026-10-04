import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env.schema";
import { signCloudinaryParams } from "@/server/media/cloudinary";
import { generateToken, hashToken, isWellFormedToken } from "@/server/auth/tokens";
import { inviteUserSchema } from "@/features/team/schemas";
import { acceptInvitationSchema } from "@/features/auth/schemas";

const base = {
  MONGODB_URI: "mongodb://127.0.0.1:27017",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000/",
};

describe("environment validation", () => {
  it("accepts a minimal development config and applies defaults", () => {
    const env = parseServerEnv({ ...base, NODE_ENV: "development" });
    expect(env).toMatchObject({
      APP_URL: "http://localhost:3000",
      APP_TIMEZONE: "Asia/Kolkata",
      APP_CURRENCY: "INR",
      MONGODB_DB_NAME: "photoxo",
    });
  });

  it("lists every problem without echoing secret values", () => {
    try {
      parseServerEnv({ MONGODB_URI: "postgres://nope", BETTER_AUTH_SECRET: "short-secret-value" });
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("MONGODB_URI");
      expect(msg).toContain("BETTER_AUTH_SECRET");
      expect(msg).toContain("APP_URL");
      expect(msg).not.toContain("short-secret-value");
    }
  });

  it("requires Resend in production (no fake email delivery)", () => {
    expect(() =>
      parseServerEnv({ ...base, NODE_ENV: "production", APP_URL: "https://app.example.com" }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it("requires https in production", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        NODE_ENV: "production",
        APP_URL: "http://app.example.com",
        RESEND_API_KEY: "re_x",
        RESEND_FROM_EMAIL: "PhotoXo <no-reply@example.com>",
      }),
    ).toThrow(/https/);
  });

  it("requires a strong CRON_SECRET in production", () => {
    const prod = { ...base, NODE_ENV: "production", APP_URL: "https://app.example.com", RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "PhotoXo <no-reply@example.com>" };
    expect(() => parseServerEnv(prod)).toThrow(/CRON_SECRET/);
    expect(() => parseServerEnv({ ...prod, CRON_SECRET: "short" })).toThrow(/CRON_SECRET/);
    expect(parseServerEnv({ ...prod, CRON_SECRET: "x".repeat(32) }).CRON_SECRET).toHaveLength(32);
  });

  it("rejects half-configured providers and bad timezones", () => {
    expect(() => parseServerEnv({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE/);
    expect(() => parseServerEnv({ ...base, CLOUDINARY_CLOUD_NAME: "demo" })).toThrow(/CLOUDINARY/);
    expect(() => parseServerEnv({ ...base, APP_TIMEZONE: "Mars/Olympus" })).toThrow(/APP_TIMEZONE/);
  });
});

describe("tokens", () => {
  it("are 256-bit, url-safe, and only the hash is deterministic", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(isWellFormedToken(a.token)).toBe(true);
    expect(hashToken(a.token)).toBe(a.hash);
    expect(a.hash).not.toContain(a.token);
  });
});

describe("cloudinary signing", () => {
  it("matches Cloudinary's documented signature example", () => {
    // https://cloudinary.com/documentation/authentication_signatures
    const sig = signCloudinaryParams(
      {
        eager: "w_400,h_300,c_pad|w_260,h_200,c_crop",
        public_id: "sample_image",
        timestamp: 1315060510,
      },
      "abcd",
    );
    expect(sig).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("excludes file, api_key, resource_type and cloud_name", () => {
    const a = signCloudinaryParams({ timestamp: 1, public_id: "x" }, "s");
    const b = signCloudinaryParams(
      { timestamp: 1, public_id: "x", api_key: "k", file: "f", cloud_name: "c" },
      "s",
    );
    expect(a).toBe(b);
  });
});

describe("input schemas", () => {
  it("invite: rejects ADMIN and unknown keys", () => {
    expect(inviteUserSchema.safeParse({ name: "Al", email: "a@b.co", role: "ADMIN" }).success).toBe(
      false,
    );
    expect(
      inviteUserSchema.safeParse({ name: "Al", email: "a@b.co", role: "STAFF", agencyId: "x" })
        .success,
    ).toBe(false);
    expect(inviteUserSchema.parse({ name: " Al ", email: " A@B.CO ", role: "STAFF" })).toEqual({
      name: "Al",
      email: "a@b.co",
      role: "STAFF",
    });
  });

  it("accept invitation: enforces password policy and confirmation", () => {
    const ok = {
      token: "t",
      name: "Rahul",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
    };
    expect(acceptInvitationSchema.safeParse(ok).success).toBe(true);
    expect(
      acceptInvitationSchema.safeParse({ ...ok, password: "short", confirmPassword: "short" })
        .success,
    ).toBe(false);
    expect(
      acceptInvitationSchema.safeParse({ ...ok, confirmPassword: "different value!!" }).success,
    ).toBe(false);
    expect(
      acceptInvitationSchema.safeParse({
        ...ok,
        password: "aaaaaaaaaaaaaa",
        confirmPassword: "aaaaaaaaaaaaaa",
      }).success,
    ).toBe(false);
  });
});
