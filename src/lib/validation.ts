import { z } from "zod";

/** Shared field validators (client + server). */
export const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export const personName = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name is too long");

export const emailAddress = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Length-based policy (NIST 800-63B): long passphrases over composition rules. */
export const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`)
  .refine((p) => p.trim().length === p.length, "Password can't start or end with a space")
  .refine((p) => new Set(p).size >= 5, "Password is too repetitive");
