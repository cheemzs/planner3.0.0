'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import { attempt, formOptionalDate, formString, withMessage } from '@/lib/action-helpers';
import { isPeriodKind, isValidTimezone } from '@/lib/engine/group-period';
import { canonicalTimezone } from '@/lib/timezones';

/**
 * Organiser actions. The real authorisation lives in Postgres (each
 * function checks the caller is the group's organiser) -- these just
 * translate form posts and report the outcome on the manage page.
 */

const manage = (groupId: string) => `/group/${groupId}/manage`;

async function finish(groupId: string, err: string | null, okMessage: string, hash = ''): Promise<never> {
  revalidatePath(`/group/${groupId}`);
  revalidatePath(manage(groupId));
  revalidatePath('/groups');
  return redirect(err ? withMessage(manage(groupId) + hash, 'error', err) : withMessage(manage(groupId) + hash, 'notice', okMessage));
}

export async function resolveRequestAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');
  const userId = formString(formData, 'userId');
  const approve = formString(formData, 'decision') === 'approve';
  const err = await attempt(() => repo.resolveJoinRequest(groupId, userId, approve));
  await finish(groupId, err, approve ? 'Approved — they can now see the group.' : 'Request declined.', '#requests');
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');
  const err = await attempt(() => repo.removeMember(groupId, formString(formData, 'userId')));
  await finish(groupId, err, 'Member removed.', '#members');
}

export async function transferOrganiserAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');
  const err = await attempt(() => repo.transferOrganiser(groupId, formString(formData, 'userId')));
  if (!err) {
    // They're no longer the organiser, so the manage page is off-limits now.
    revalidatePath(`/group/${groupId}`);
    revalidatePath('/groups');
    redirect(`/group/${groupId}`);
  }
  await finish(groupId, err, '', '#members');
}

export async function regenerateCodeAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');
  const err = await attempt(() => repo.regenerateInviteCode(groupId));
  await finish(groupId, err, 'New invite code generated. The old one no longer works.', '#invite');
}

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');

  const err = await attempt(async () => {
    const name = formString(formData, 'name');
    if (!name) throw new Error('Group name is required');

    const timezone = canonicalTimezone(formString(formData, 'timezone'));
    if (!isValidTimezone(timezone)) throw new Error('Pick a valid timezone');

    const kind = formString(formData, 'periodKind');
    if (!isPeriodKind(kind)) throw new Error('Pick a planning period');

    const periodStart = formOptionalDate(formData, 'periodStart', 'The start date');
    const periodEnd = kind === 'custom' ? formOptionalDate(formData, 'periodEnd', 'The end date') : null;
    if (kind === 'custom' && (!periodStart || !periodEnd)) throw new Error('A custom period needs both a start and an end date');

    const minBlock = Number(formString(formData, 'minBlockMinutes'));
    if (!Number.isInteger(minBlock) || minBlock < 15 || minBlock > 720) throw new Error('Minimum block must be between 15 and 720 minutes');

    await repo.updateGroupSettings(groupId, {
      name,
      timezone,
      periodKind: kind,
      periodStart,
      periodEnd,
      minBlockMinutes: minBlock,
      requireApproval: formData.get('requireApproval') === 'on',
    });
  });
  await finish(groupId, err, 'Settings saved.', '#settings');
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');
  const err = await attempt(() => repo.deleteGroup(groupId));
  if (err) await finish(groupId, err, '', '#danger');
  revalidatePath('/groups');
  redirect(withMessage('/groups', 'notice', 'Group deleted.'));
}
