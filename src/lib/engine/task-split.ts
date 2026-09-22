import type { NewPlanTask, PlanTask } from './types';

export interface SplitPhase {
  title: string;
  minutes: number;
}

/**
 * Splits a task's remaining effort into ordered sub-tasks, chained via
 * `dependsOn` so the planner will never schedule a later phase before an
 * earlier one. Phase *names* must come from the caller (the user or the
 * LLM relaying what the user said, e.g. "research 60, outline 30,
 * calculations 90, write-up 90, review 30") — the deterministic engine
 * does not invent semantic subtask content, only enforces that the
 * numbers add up and the ordering/dependency wiring is correct.
 *
 * If no explicit phases are given, falls back to an even, generic split
 * into <= maxChunk-minute phases (still genuinely useful for scheduling,
 * just without bespoke phase names).
 */
export function planTaskSplit(
  task: Pick<PlanTask, 'title' | 'remainingMinutes' | 'projectId' | 'deadline' | 'priority' | 'earliestStart' | 'preferredTimeOfDay' | 'tags'>,
  phases?: SplitPhase[],
  maxChunkMinutes = 90,
): (NewPlanTask & { _tempId: string })[] {
  let resolvedPhases = phases;

  if (!resolvedPhases || resolvedPhases.length === 0) {
    const count = Math.max(1, Math.ceil(task.remainingMinutes / maxChunkMinutes));
    const each = Math.round(task.remainingMinutes / count);
    resolvedPhases = Array.from({ length: count }, (_, i) => ({
      title: `${task.title} (Part ${i + 1} of ${count})`,
      minutes: i === count - 1 ? task.remainingMinutes - each * (count - 1) : each,
    }));
  } else {
    const sum = resolvedPhases.reduce((s, p) => s + p.minutes, 0);
    if (sum !== task.remainingMinutes) {
      // Preserve the user's relative proportions but rescale to match the
      // task's actual remaining effort, so totals stay consistent.
      const scale = task.remainingMinutes / sum;
      resolvedPhases = resolvedPhases.map((p) => ({ ...p, minutes: Math.max(1, Math.round(p.minutes * scale)) }));
    }
  }

  const subtasks: (NewPlanTask & { _tempId: string })[] = resolvedPhases.map((phase, i) => ({
    _tempId: `phase-${i}`,
    title: phase.title,
    projectId: task.projectId,
    priority: task.priority,
    estimatedMinutes: phase.minutes,
    remainingMinutes: phase.minutes,
    deadline: task.deadline,
    earliestStart: task.earliestStart,
    preferredTimeOfDay: task.preferredTimeOfDay,
    tags: task.tags,
    dependsOn: i === 0 ? [] : [`__prev__${i - 1}`],
  }));

  return subtasks;
}
