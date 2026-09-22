'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import type { AvailabilityConfig } from '@/lib/engine/types';

export async function updateSimpleAvailabilityAction(formData: FormData): Promise<void> {
  const current = await repo.getAvailability();
  const wake = (formData.get('wake') ?? '07:00').toString();
  const sleep = (formData.get('sleep') ?? '23:00').toString();
  const workStart = (formData.get('workStart') ?? '16:00').toString();
  const workEnd = (formData.get('workEnd') ?? '21:00').toString();
  const breakStart = (formData.get('breakStart') ?? '').toString();
  const breakEnd = (formData.get('breakEnd') ?? '').toString();
  const targetUtilization = Number(formData.get('targetUtilization') ?? 0.75);
  const bufferMinutes = Number(formData.get('bufferMinutes') ?? 10);

  const updated: AvailabilityConfig = {
    ...current,
    default: {
      wake,
      sleep,
      workWindows: [{ start: workStart, end: workEnd }],
      breaks: breakStart && breakEnd ? [{ start: breakStart, end: breakEnd }] : [],
    },
    targetUtilization: Number.isFinite(targetUtilization) ? targetUtilization : 0.75,
    bufferMinutes: Number.isFinite(bufferMinutes) ? bufferMinutes : 10,
  };

  await repo.setAvailability(updated);
  revalidatePath('/settings');
  redirect('/settings?section=availability');
}

export async function updateAdvancedAvailabilityAction(formData: FormData): Promise<void> {
  const raw = (formData.get('json') ?? '').toString();
  let parsed: AvailabilityConfig;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  await repo.setAvailability(parsed);
  revalidatePath('/settings');
  redirect('/settings?section=availability');
}
