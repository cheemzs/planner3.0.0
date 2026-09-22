/**
 * Best-effort email notification when someone submits feedback. The
 * feedback is ALWAYS saved to Postgres first (see repo.submitFeedback) --
 * that's the durable record. This is only a "someone should look at this"
 * nudge, so a failure here must never fail the submission itself.
 *
 * Sending real email needs a real email-sending account, which needs a real
 * secret. I'm not able to create or ship one on your behalf, and I'm not
 * going to invent a placeholder key and pretend it works. Instead: this
 * reads RESEND_API_KEY from the environment (https://resend.com — free tier
 * covers this comfortably) and sends through their HTTP API if it's set. If
 * it's isn't, submissions still save fine; you'd just check them in the
 * in-app admin inbox (/admin) or the Supabase table editor instead of email.
 * See README.md "Feedback email" for exact setup steps.
 */

const FEEDBACK_TO = 'lucas.cheam@gmail.com';

export interface FeedbackEmailInput {
  message: string;
  fromEmail: string;
  fromName: string | null;
  page: string | null;
}

export async function notifyFeedbackByEmail(input: FeedbackEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'not_configured' };

  // Most providers, Resend included, require the "from" address to be on a
  // domain you've verified with them -- they won't let you send arbitrary
  // "from" addresses (that's an anti-spoofing rule, not a bug). So the
  // submitter's address goes in reply-to instead: hitting Reply in the
  // inbox still goes straight to them.
  const from = process.env.RESEND_FROM_EMAIL || 'Planner Feedback <onboarding@resend.dev>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [FEEDBACK_TO],
        reply_to: input.fromEmail,
        subject: `Planner feedback${input.page ? ` — ${input.page}` : ''}`,
        text: [
          `From: ${input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail}`,
          input.page ? `Page: ${input.page}` : null,
          '',
          input.message,
        ]
          .filter((line) => line !== null)
          .join('\n'),
      }),
    });
    if (!res.ok) return { sent: false, reason: `provider_error_${res.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: 'network_error' };
  }
}
