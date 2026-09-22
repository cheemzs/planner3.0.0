import { defaultAvailability } from '../src/lib/engine/availability.js';
import type { AvailabilityConfig, NewPlanTask, PlanTask, PlanEvent, NewPlanEvent } from '../src/lib/engine/types.js';

let counter = 0;
export function resetCounter(): void {
  counter = 0;
}

export function makeTask(overrides: Partial<NewPlanTask> & { title: string }): PlanTask {
  counter += 1;
  const id = `t${counter}`;
  const now = '2026-06-01T08:00';
  const estimatedMinutes = overrides.estimatedMinutes ?? 60;
  return {
    id,
    title: overrides.title,
    description: overrides.description,
    projectId: overrides.projectId,
    goalId: overrides.goalId,
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 'medium',
    importance: overrides.importance,
    difficulty: overrides.difficulty,
    estimatedMinutes,
    remainingMinutes: overrides.remainingMinutes ?? estimatedMinutes,
    deadline: overrides.deadline,
    earliestStart: overrides.earliestStart,
    latestCompletion: overrides.latestCompletion,
    preferredTimeOfDay: overrides.preferredTimeOfDay,
    minChunkMinutes: overrides.minChunkMinutes,
    maxChunkMinutes: overrides.maxChunkMinutes,
    dependsOn: overrides.dependsOn ?? [],
    recurrence: overrides.recurrence,
    tags: overrides.tags ?? [],
    autoSchedulable: overrides.autoSchedulable,
    createdAt: now,
    updatedAt: now,
    completedAt: overrides.completedAt,
  };
}

export function makeEvent(overrides: Partial<NewPlanEvent> & { title: string; date: string; start: string; end: string }): PlanEvent {
  counter += 1;
  const id = `e${counter}`;
  const now = '2026-06-01T08:00';
  return {
    id,
    title: overrides.title,
    description: overrides.description,
    date: overrides.date,
    start: overrides.start,
    end: overrides.end,
    fixed: overrides.fixed ?? true,
    recurrence: overrides.recurrence,
    category: overrides.category,
    createdAt: now,
    updatedAt: now,
  };
}

export function simpleAvailability(): AvailabilityConfig {
  return {
    default: {
      wake: '07:00',
      sleep: '22:00',
      workWindows: [{ start: '09:00', end: '18:00' }],
      breaks: [{ start: '12:00', end: '13:00' }],
    },
    perWeekday: [],
    overrides: [],
    targetUtilization: 0.75,
    bufferMinutes: 10,
  };
}

export { defaultAvailability };
