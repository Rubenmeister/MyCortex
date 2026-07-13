import { getEnv } from './env.js';

/**
 * Email sending via Resend (https://resend.com).
 *
 * We keep this in a tiny helper rather than pulling in the Resend SDK
 * because the HTTP surface we need (a single POST) is trivial. If we
 * outgrow this (templates, batch, etc.) we'll swap to @resend/node.
 *
 * Gracefully degrades when RESEND_API_KEY is not configured — sendEmail
 * returns `{ sent: false, reason: 'not_configured' }` so callers can
 * decide whether to fail the request or just skip the email.
 */

type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: 'not_configured' | string };

type SendArgs = {
  to: string | string[];
  subject: string;
  /** Either plain text OR html. At least one is required. */
  html?: string;
  text?: string;
  /** Override the From address. Defaults to RESEND_FROM_EMAIL. */
  from?: string;
  /** Optional reply-to. Useful for support emails. */
  replyTo?: string;
  /** Tags propagate to Resend's dashboard for filtering/analytics. */
  tags?: Array<{ name: string; value: string }>;
};

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: 'not_configured' };
  }
  const from = args.from ?? env.RESEND_FROM_EMAIL ?? 'MyCortex <onboarding@resend.dev>';
  if (!args.html && !args.text) {
    return { sent: false, reason: 'missing_body' };
  }

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
  };
  if (args.html) body.html = args.html;
  if (args.text) body.text = args.text;
  if (args.replyTo) body.reply_to = args.replyTo;
  if (args.tags) body.tags = args.tags;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 200);
    return { sent: false, reason: `${res.status}:${errText}` };
  }
  const json = (await res.json()) as { id: string };
  return { sent: true, id: json.id };
}

/**
 * Render the workspace invitation email. Plain HTML + matching text
 * version for clients that don't render HTML.
 */
export function renderInvitationEmail(args: {
  workspaceName: string;
  inviterEmail: string;
  inviterName?: string | null;
  role: string;
  acceptUrl: string;
}): { subject: string; html: string; text: string } {
  const inviter = args.inviterName ?? args.inviterEmail;
  const subject = `${inviter} te invitó a ${args.workspaceName} en MyCortex`;
  const text = [
    `${inviter} (${args.inviterEmail}) te invitó a colaborar en el workspace`,
    `"${args.workspaceName}" en MyCortex como ${args.role}.`,
    ``,
    `Acepta la invitación aquí:`,
    args.acceptUrl,
    ``,
    `Si no esperabas esta invitación, ignora este mail.`,
    ``,
    `— MyCortex`,
  ].join('\n');

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fafafa;padding:32px 16px;color:#222;line-height:1.5;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eaeaea;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 16px;color:#111;">Te invitaron a MyCortex</h1>
    <p style="margin:0 0 12px;color:#444;">
      <strong>${escapeHtml(inviter)}</strong> (<a href="mailto:${escapeHtml(args.inviterEmail)}" style="color:#0066cc;">${escapeHtml(args.inviterEmail)}</a>) te invitó a colaborar en el workspace
      <strong>"${escapeHtml(args.workspaceName)}"</strong> como <strong>${escapeHtml(args.role)}</strong>.
    </p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(args.acceptUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
        Aceptar invitación
      </a>
    </p>
    <p style="font-size:12px;color:#888;margin:24px 0 0;">
      Si no esperabas esta invitación, ignora este mail. El link expira en 7 días.
    </p>
    <hr style="border:none;border-top:1px solid #eaeaea;margin:24px 0;">
    <p style="font-size:11px;color:#aaa;margin:0;">
      MyCortex · Tu segundo cerebro
    </p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
