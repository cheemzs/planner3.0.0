'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import * as engine from '@/lib/engine-service';
import type { NewPlanTask, PlanTask } from '@/lib/engine/types';
import type { SplitPhase } from '@/lib/engine/task-split';

function str(v: FormDataEntryValue | null): string | undefined {
  const s = (v ?? '').toString().trim();
  return s.length > 0 ? s : undefined;
}
function num(v: FormDataEntryValue | null): number | undefined {
  const s = str(v);
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const dependsOnRaw = formData.getAll('dependsOn').map((v) => v.toString()).filter(Boolean);
  const tagsRaw = str(formData.get('tags'));

  const input: NewPlanTask = {
    title: (formData.get('title') ?? '').toString().trim(),
    description: str(formData.get('description')),
    priority: (str(formData.get('priority')) as NewPlanTask['priority']) ?? 'medium',
    difficulty: num(formData.get('difficulty')),
    estimatedMinutes: num(formData.get('estimatedMinutes')) ?? 30,
    deadline: str(formData.get('deadline')),
    earliestStart: str(formData.get('earliestStart')),
    preferredTimeOfDay: str(formData.get('preferredTimeOfDay')) as NewPlanTask['preferredTimeOfDay'],
    minChunkMinutes: num(formData.get('minChunkMinutes')),
    maxChunkMinutes: num(formData.get('maxChunkMinutes')),
    dependsOn: dependsOnRaw,
    tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [],
    autoSchedulable: formData.get('autoSchedulable') !== 'off',
  };

  if (!input.title) throw new Error('Title is required');

  await repo.createTask(input);
  revalidatePath('/tasks');
  redirect('/tasks');
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  const patch: Partial<PlanTask> = {
    title: str(formData.get('title')),
    description: str(formData.get('description')),
    priority: str(formData.get('priority')) as PlanTask['priority'],
    difficulty: num(formData.get('difficulty')),
    estimatedMinutes: num(formData.get('estimatedMinutes')),
    remainingMinutes: num(formData.get('remainingMinutes')),
    deadline: str(formData.get('deadline')),
    earliestStart: str(formData.get('earliestStart')),
    preferredTimeOfDay: str(formData.get('preferredTimeOfDay')) as PlanTask['preferredTimeOfDay'],
  };
  const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await repo.updateTask(taskId, cleaned);
  revalidatePath('/tasks');
  redirect('/tasks');
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  await repo.deleteTask(taskId);
  revalidatePath('/tasks');
  redirect('/tasks');
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  await repo.completeTask(taskId);
  revalidatePath('/schedule');
  revalidatePath('/tasks');
}

/** "I couldn't do it" — clears today's leftover time for this task and refits it into the coming days. */
export async function skipTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  const date = (formData.get('date') ?? '').toString();
  await engine.rescheduleSkippedTask(taskId, date);
  revalidatePath('/schedule');
  revalidatePath('/tasks');
}

/** "Interrupted" — logs actual time spent, reducing remaining effort, then refits any leftover. */
export async function interruptTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  const date = (formData.get('date') ?? '').toString();
  const minutesSpent = num(formData.get('minutesSpent')) ?? 0;
  const updated = await engine.recordInterruption(taskId, minutesSpent);
  if (updated.remainingMinutes > 0) {
    await engine.rescheduleSkippedTask(taskId, date);
  }
  revalidatePath('/schedule');
  revalidatePath('/tasks');
}

export async function splitTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  const titles = formData.getAll('phaseTitle').map((v) => v.toString());
  const minutes = formData.getAll('phaseMinutes').map((v) => Number(v));
  let phases: SplitPhase[] | undefined;
  const collected: SplitPhase[] = [];
  for (let i = 0; i < titles.length; i++) {
    if (titles[i].trim() && minutes[i] > 0) collected.push({ title: titles[i].trim(), minutes: minutes[i] });
  }
  if (collected.length > 0) phases = collected;

  await repo.splitTask(taskId, phases);
  revalidatePath('/tasks');
  redirect('/tasks');
}

export async function moveTaskAction(formData: FormData): Promise<void> {
  const taskId = (formData.get('taskId') ?? '').toString();
  const fromDate = (formData.get('fromDate') ?? '').toString();
  const toDate = (formData.get('toDate') ?? '').toString();
  await engine.moveTask(taskId, fromDate, toDate);
  revalidatePath('/schedule');
}
