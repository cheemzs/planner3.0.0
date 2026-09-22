'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import { attempt, withMessage } from '@/lib/action-helpers';
import { validateDisplayName } from '@/lib/profile';

/**
 * Saves the signed-in user's display name. Note what is NOT read from the
 * form: any user id. Whose profile to update is decided solely by the
 * session (inside repo.updateMyDisplayName), so a forged form field can't
 * point this at someone else -- and Postgres RLS would refuse it anyway.
 */
export async function updateProfileAction(formData: FormData): Promise<void> {
  const result = validateDisplayName((formData.get('displayName') ?? '').toString());
  if (!result.ok) redirect(withMessage('/settings?section=profile', 'error', result.error));

  const err = await attempt(() => repo.updateMyDisplayName(result.value));
  // The name is shown in the sidebar on every page and in every group roster.
  revalidatePath('/', 'layout');
  redirect(err ? withMessage('/settings?section=profile', 'error', err) : withMessage('/settings?section=profile', 'notice', 'Profile saved.'));
}

/** Saves the signed-in user's theme. Same own-session-only path as the display name above. */
export async function updateThemeAction(formData: FormData): Promise<void> {
  const raw = (formData.get('theme') ?? '').toString();
  if (!repo.isTheme(raw)) redirect(withMessage('/settings?section=profile', 'error', 'Pick a valid theme.'));

  const err = await attempt(() => repo.updateMyTheme(raw));
  // The theme affects <html data-theme> on every page.
  revalidatePath('/', 'layout');
  redirect(err ? withMessage('/settings?section=profile', 'error', err) : withMessage('/settings?section=profile', 'notice', 'Theme updated.'));
}
