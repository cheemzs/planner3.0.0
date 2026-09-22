'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import { attempt, withMessage } from '@/lib/action-helpers';

/** Rotates the signed-in user's ICS subscribe token, invalidating any previously shared URL. */
export async function regenerateIcsTokenAction(): Promise<void> {
  const err = await attempt(() => repo.regenerateIcsToken());
  revalidatePath('/settings');
  redirect(
    err
      ? withMessage('/settings?section=calendar', 'error', err)
      : withMessage('/settings?section=calendar', 'notice', 'Calendar link regenerated — the old URL no longer works.'),
  );
}
