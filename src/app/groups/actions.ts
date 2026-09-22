'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import { attempt, formString, withMessage } from '@/lib/action-helpers';
import { canonicalTimezone } from '@/lib/timezones';
import { APP_TIMEZONE } from '@/lib/engine/time-utils';

export async function createGroupAction(formData: FormData): Promise<void> {
  const name = formString(formData, 'name');
  const timezone = canonicalTimezone(formString(formData, 'timezone') || APP_TIMEZONE);
  if (!name) redirect(withMessage('/groups', 'error', 'Group name is required'));

  let groupId = '';
  const err = await attempt(async () => {
    groupId = await repo.createGroup(name, timezone);
  });
  if (err) redirect(withMessage('/groups', 'error', err));
  revalidatePath('/groups');
  redirect(`/group/${groupId}`);
}

export async function joinGroupAction(formData: FormData): Promise<void> {
  const code = formString(formData, 'code');
  if (!code) redirect(withMessage('/groups', 'error', 'Invite code is required'));

  let result: { groupId: string; status: repo.JoinStatus } | null = null;
  const err = await attempt(async () => {
    result = await repo.joinGroupByCode(code);
  });
  if (err || !result) redirect(withMessage('/groups', 'error', err ?? 'Could not join that group'));
  revalidatePath('/groups');

  const { groupId, status } = result as { groupId: string; status: repo.JoinStatus };
  if (status === 'active') redirect(`/group/${groupId}`);
  redirect(withMessage('/groups', 'notice', "Request sent. You'll get access as soon as the group's organiser approves you."));
}

/** Leave a group, or cancel your own pending request. */
export async function leaveGroupAction(formData: FormData): Promise<void> {
  const groupId = formString(formData, 'groupId');
  const err = await attempt(() => repo.leaveGroup(groupId));
  revalidatePath('/groups');
  redirect(err ? withMessage('/groups', 'error', err) : withMessage('/groups', 'notice', 'Done.'));
}
