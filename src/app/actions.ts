'use server';

import { revalidatePath } from 'next/cache';
import { todayIso } from '@/lib/engine/time-utils';
import * as engine from '@/lib/engine-service';

export async function planTodayAction(formData: FormData): Promise<void> {
  const date = (formData.get('date') ?? '').toString() || todayIso();
  await engine.planDay(date);
  revalidatePath('/schedule');
}

export async function replanTodayAction(formData: FormData): Promise<void> {
  const date = (formData.get('date') ?? '').toString() || todayIso();
  await engine.replanDay(date);
  revalidatePath('/schedule');
}

export async function planWeekAction(formData: FormData): Promise<void> {
  const weekStart = (formData.get('weekStart') ?? '').toString() || todayIso();
  await engine.planWeek(weekStart);
  revalidatePath('/schedule');
}

export async function planMonthAction(formData: FormData): Promise<void> {
  const monthStart = (formData.get('monthStart') ?? '').toString() || todayIso();
  await engine.planMonth(monthStart);
  revalidatePath('/schedule');
}
