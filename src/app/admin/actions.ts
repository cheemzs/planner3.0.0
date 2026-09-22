'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import { attempt, formString, withMessage } from '@/lib/action-helpers';

export async function setFeedbackHandledAction(formData: FormData): Promise<void> {
  const id = formString(formData, 'feedbackId');
  const handled = formString(formData, 'handled') === 'true';
  const err = await attempt(() => repo.setFeedbackHandled(id, handled));
  revalidatePath('/admin');
  if (err) redirect(withMessage('/admin', 'error', err));
}
