'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import * as repo from '@/lib/repository';
import { requireUser } from '@/lib/supabase/server';
import { attempt, formString, withMessage } from '@/lib/action-helpers';
import { notifyFeedbackByEmail } from '@/lib/notify-feedback';

const MESSAGE_MAX = 4000;

export async function submitFeedbackAction(formData: FormData): Promise<void> {
  const message = formString(formData, 'message');
  const contactEmail = formString(formData, 'contactEmail');
  // No hidden field to spoof -- taken from the request itself, best-effort context only (never security-relevant).
  const page = (() => {
    try {
      const ref = headers().get('referer');
      return ref ? new URL(ref).pathname : null;
    } catch {
      return null;
    }
  })();

  if (!message) redirect(withMessage('/settings?section=feedback', 'error', "Enter a message before sending — it can't be blank."));
  if (message.length > MESSAGE_MAX) redirect(withMessage('/settings?section=feedback', 'error', `Keep it under ${MESSAGE_MAX} characters (yours is ${message.length}).`));

  const user = await requireUser();

  const err = await attempt(() => repo.submitFeedback(message, contactEmail || null, page));
  if (err) redirect(withMessage('/settings?section=feedback', 'error', err));

  // Best-effort: the message is already safely saved above regardless of what happens here.
  const emailResult = await notifyFeedbackByEmail({
    message,
    fromEmail: contactEmail || user.email || 'unknown@unknown',
    fromName: null,
    page,
  });

  redirect(
    withMessage(
      '/settings?section=feedback',
      'notice',
      emailResult.sent ? 'Thanks! Your feedback was sent.' : "Thanks! Your feedback was saved and someone will read it soon.",
    ),
  );
}
