'use server';

import { revalidatePath } from 'next/cache';
import * as repo from '@/lib/repository';

/** Records that the signed-in user has seen this version's "what's new" modal, so it stops showing. */
export async function markChangelogSeenAction(formData: FormData): Promise<void> {
  const version = (formData.get('version') ?? '').toString();
  if (!version) return;
  await repo.markChangelogSeen(version);
  // The layout (which decides whether to show the modal) wraps every page.
  revalidatePath('/', 'layout');
}
