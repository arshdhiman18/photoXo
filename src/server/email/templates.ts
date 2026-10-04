import "server-only";
import { SYSTEM_ROLE_LABEL, type SystemRole } from "@/lib/domain/roles";
import { sendEmail, type EmailDelivery } from "./transport";

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(opts: {
  heading: string;
  body: string;
  cta: { label: string; url: string };
  footnote: string;
}) {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-size:15px;font-weight:600;letter-spacing:-0.01em">PhotoXo</td></tr>
<tr><td style="padding:8px 28px 0;font-size:20px;font-weight:600;letter-spacing:-0.02em">${opts.heading}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:14px;line-height:22px;color:#3f3f46">${opts.body}</td></tr>
<tr><td style="padding:24px 28px"><a href="${opts.cta.url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px">${opts.cta.label}</a></td></tr>
<tr><td style="padding:0 28px 28px;font-size:12px;line-height:18px;color:#71717a">${opts.footnote}<br><br>If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${opts.cta.url}</span></td></tr>
</table></td></tr></table></body></html>`;
}

export function sendInvitationEmail(input: {
  to: string;
  name: string;
  role: SystemRole;
  agencyName: string;
  inviterName: string;
  url: string;
  expiresInDays: number;
}): Promise<EmailDelivery> {
  const role = SYSTEM_ROLE_LABEL[input.role];
  const text = [
    `Hi ${input.name},`,
    "",
    `${input.inviterName} invited you to join ${input.agencyName} on PhotoXo as ${role}.`,
    "",
    `Set up your account: ${input.url}`,
    "",
    `This link expires in ${input.expiresInDays} days and can be used once.`,
  ].join("\n");
  return sendEmail({
    to: input.to,
    subject: `You're invited to ${input.agencyName} on PhotoXo`,
    text,
    html: layout({
      heading: `Join ${escapeHtml(input.agencyName)}`,
      body: `Hi ${escapeHtml(input.name)},<br>${escapeHtml(input.inviterName)} invited you to PhotoXo as <strong>${role}</strong>. Set a password to activate your account.`,
      cta: { label: "Set up your account", url: input.url },
      footnote: `This link expires in ${input.expiresInDays} days and can be used once. If you weren't expecting this, you can ignore this email.`,
    }),
  });
}

export function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  url: string;
}): Promise<EmailDelivery> {
  return sendEmail({
    to: input.to,
    subject: "Reset your PhotoXo password",
    text: [
      `Hi ${input.name},`,
      "",
      `Reset your password: ${input.url}`,
      "",
      "This link expires in 1 hour.",
    ].join("\n"),
    html: layout({
      heading: "Reset your password",
      body: `Hi ${escapeHtml(input.name)},<br>We received a request to reset your PhotoXo password.`,
      cta: { label: "Choose a new password", url: input.url },
      footnote:
        "This link expires in 1 hour. If you didn't request it, you can safely ignore this email — your password won't change.",
    }),
  });
}

/** Notification email (content is the already-rendered, audience-safe notification text). */
export function renderNotificationEmail(input: { title: string; message: string; url: string; agencyName: string }) {
  return {
    subject: input.title,
    text: [input.title, "", input.message, "", `Open in PhotoXo: ${input.url}`].join("\n"),
    html: layout({
      heading: escapeHtml(input.title),
      body: escapeHtml(input.message),
      cta: { label: "Open in PhotoXo", url: input.url },
      footnote: `You're receiving this because you work with ${escapeHtml(input.agencyName)} on PhotoXo. You can turn off email notifications in your notification settings.`,
    }),
  };
}
