'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import * as engine from '@/lib/engine-service';
import type { NewPlanEvent } from '@/lib/engine/types';

function str(v: FormDataEntryValue | null): string | undefined {
  const s = (v ?? '').toString().trim();
  return s.length > 0 ? s : undefined;
}

export async function createEventAction(formData: FormData): Promise<void> {
  const daysOfWeek = formData.getAll('daysOfWeek').map((v) => Number(v));
  const input: NewPlanEvent = {
    title: (formData.get('title') ?? '').toString().trim(),
    description: str(formData.get('description')),
    date: (formData.get('date') ?? '').toString(),
    start: (formData.get('start') ?? '').toString(),
    end: (formData.get('end') ?? '').toString(),
    fixed: formData.get('fixed') !== 'off',
    category: str(formData.get('category')),
    recurrence: daysOfWeek.length > 0 ? { daysOfWeek } : undefined,
  };
  if (!input.title || !input.date || !input.start || !input.end) {
    throw new Error('Title, date, start, and end are required');
  }

  // Route through the reschedule engine so anything already auto-planned
  // that now conflicts with this event gets automatically refit, matching
  // the "unexpected event" behavior.
  if (input.fixed) {
    await engine.addUnexpectedEvent(input);
  } else {
    await repo.createEvent(input);
  }

  revalidatePath('/tasks');
  revalidatePath('/schedule');
  redirect('/tasks?section=events');
}

export async function deleteEventAction(formData: FormData): Promise<void> {
  const eventId = (formData.get('eventId') ?? '').toString();
  await repo.deleteEvent(eventId);
  revalidatePath('/tasks');
  redirect('/tasks?section=events');
}
