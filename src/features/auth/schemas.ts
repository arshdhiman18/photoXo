import { z } from "zod";
import { emailAddress, newPassword, personName } from "@/lib/validation";

export const loginSchema = z.object({
  email: emailAddress,
  password: z.string().min(1, "Enter your password").max(128),
});

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1).max(100),
    name: personName,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

export const forgotPasswordSchema = z.object({ email: emailAddress });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });
