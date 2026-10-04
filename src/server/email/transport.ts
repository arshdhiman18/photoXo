import "server-only";
import { env } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * - `sent`: accepted by the email provider.
 * - `logged`: development only — no provider configured, the message was
 *   written to the server console instead. Never returned in production
 *   (env validation requires Resend there).
 */
export type EmailDelivery = { status: "sent"; id: string } | { status: "logged" };

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

async function sendViaResend(msg: EmailMessage): Promise<EmailDelivery> {
  // Plain fetch against Resend's REST API — avoids an SDK dependency.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new EmailDeliveryError(
      `Resend rejected the message (${res.status}). ${detail.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as { id?: string };
  return { status: "sent", id: body.id ?? "unknown" };
}

function logToConsole(msg: EmailMessage): EmailDelivery {
  console.info(
    [
      "",
      "┌─ [email:dev] Not sent — RESEND_API_KEY is not configured ─────────────",
      `│ To:      ${msg.to}`,
      `│ Subject: ${msg.subject}`,
      "│",
      ...msg.text.split("\n").map((l) => `│ ${l}`),
      "└────────────────────────────────────────────────────────────────────────",
    ].join("\n"),
  );
  return { status: "logged" };
}

export async function sendEmail(msg: EmailMessage): Promise<EmailDelivery> {
  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) return sendViaResend(msg);
  if (env.NODE_ENV === "production") {
    // Unreachable given env validation, but never fake delivery in production.
    throw new EmailDeliveryError("Email provider is not configured.");
  }
  return logToConsole(msg);
}
