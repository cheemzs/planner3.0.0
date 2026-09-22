import type {
  AvailabilityConfig,
  ISODate,
  PlanEvent,
  PlanTask,
  ScheduleBlock,
} from './types';
import { rangesOverlap, timeToMinutes } from './time-utils';
import { generateDayPlan } from './day-planner';
import type { ScoringContext } from './scoring';

export interface ScheduleDiff {
  removed: ScheduleBlock[];
  added: ScheduleBlock[];
  summary: string;
}

function emptyDiff(summary: string): ScheduleDiff {
  return { removed: [], added: [], summary };
}

/**
 * The user could not finish (or didn't start) a task today. Removes any
 * remaining *auto-scheduled, unlocked* blocks for that task from `date`
 * onward within the plan, keeps `remainingMinutes` on the task as-is (the
 * caller is responsible for reducing it if partial progress was made —
 * see `applyInterruption`), and re-plans the affected days so the task's
 * outstanding time gets refit into the nearest feasible availability
 * before its deadline.
 */
export function handleSkippedTask(
  taskId: string,
  fromDate: ISODate,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  blocks: ScheduleBlock[],
  scoringCtx: ScoringContext,
  replanHorizonDays: string[],
): { diff: ScheduleDiff; blocks: ScheduleBlock[] } {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { diff: emptyDiff(`No task found with id ${taskId}.`), blocks };

  const removed = blocks.filter(
    (b) => b.refId === taskId && b.source === 'auto' && !b.locked && b.date >= fromDate,
  );
  let working = blocks.filter((b) => !removed.some((r) => r.id === b.id));

  const added: ScheduleBlock[] = [];
  for (const date of replanHorizonDays) {
    const result = generateDayPlan(date, tasks, events, availability, working, scoringCtx, {
      idPrefix: 'reschedule',
    });
    const dateRemoved = working.filter((b) => b.date === date && b.source === 'auto' && !b.locked);
    working = working.filter((b) => !(b.date === date && b.source === 'auto' && !b.locked));
    working = [...working, ...result.blocks];
    for (const b of result.blocks) {
      if (!dateRemoved.some((d) => d.refId === b.refId && d.start === b.start)) added.push(b);
    }
  }

  return {
    diff: {
      removed,
      added,
      summary: `Cleared ${removed.length} unfinished block(s) for "${task.title}" and re-planned ${replanHorizonDays.length} day(s) to fit the remaining ${task.remainingMinutes} minute(s) before its deadline.`,
    },
    blocks: working,
  };
}

/**
 * Records that a task was interrupted (took longer, was stopped early, or
 * only partially completed) and reduces its remaining effort accordingly.
 * Returns the updated task; the caller should persist it and then call
 * `handleSkippedTask`/day replanning for any leftover time.
 */
export function applyInterruption(task: PlanTask, minutesSpent: number): PlanTask {
  const remainingMinutes = Math.max(0, task.remainingMinutes - Math.max(0, minutesSpent));
  return {
    ...task,
    remainingMinutes,
    status: remainingMinutes === 0 ? 'completed' : 'in_progress',
    completedAt: remainingMinutes === 0 ? new Date().toISOString() : task.completedAt,
  };
}

/**
 * An unexpected fixed event appears (appointment, called-in-sick, etc).
 * Any auto-scheduled, unlocked blocks that overlap it are removed and the
 * rest of that day is re-planned around the new commitment. Manually
 * pinned/fixed blocks are left untouched.
 */
export function insertUnexpectedEvent(
  event: PlanEvent,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  blocks: ScheduleBlock[],
  scoringCtx: ScoringContext,
): { diff: ScheduleDiff; blocks: ScheduleBlock[]; events: PlanEvent[] } {
  const eventRange = { start: timeToMinutes(event.start), end: timeToMinutes(event.end) };
  const conflicting = blocks.filter(
    (b) =>
      b.date === event.date &&
      b.source === 'auto' &&
      !b.locked &&
      rangesOverlap(eventRange, { start: timeToMinutes(b.start), end: timeToMinutes(b.end) }),
  );

  const nextEvents = [...events, event];
  let working = blocks.filter(
    (b) => !(b.date === event.date && b.source === 'auto' && !b.locked),
  );

  const result = generateDayPlan(event.date, tasks, nextEvents, availability, working, scoringCtx, {
    idPrefix: 'reschedule',
  });
  working = [...working, ...result.blocks];

  const removedTaskTitles = [...new Set(conflicting.map((b) => b.title))];
  return {
    diff: {
      removed: conflicting,
      added: result.blocks.filter((b) => b.type === 'task'),
      summary:
        conflicting.length > 0
          ? `Added "${event.title}" (${event.start}-${event.end}) and rescheduled ${removedTaskTitles.length} affected task(s) around it: ${removedTaskTitles.join(', ')}.`
          : `Added "${event.title}" (${event.start}-${event.end}); no scheduled work conflicted with it.`,
    },
    blocks: working,
    events: nextEvents,
  };
}

/**
 * Moves a task's auto-scheduled work from one date to another. Removes its
 * existing unlocked auto blocks on `fromDate` and re-plans `toDate` with
 * this task included at its normal priority, so it competes fairly for
 * time against whatever else is already there rather than being force-
 * inserted.
 */
export function moveTask(
  taskId: string,
  fromDate: ISODate,
  toDate: ISODate,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  blocks: ScheduleBlock[],
  scoringCtx: ScoringContext,
): { diff: ScheduleDiff; blocks: ScheduleBlock[] } {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { diff: emptyDiff(`No task found with id ${taskId}.`), blocks };

  const removedFrom = blocks.filter(
    (b) => b.refId === taskId && b.date === fromDate && b.source === 'auto' && !b.locked,
  );
  let working = blocks.filter((b) => !removedFrom.some((r) => r.id === b.id));

  working = working.filter((b) => !(b.date === toDate && b.source === 'auto' && !b.locked));

  const result = generateDayPlan(toDate, tasks, events, availability, working, scoringCtx, {
    idPrefix: 'reschedule',
  });
  working = [...working, ...result.blocks];

  const movedIn = result.blocks.some((b) => b.refId === taskId);
  return {
    diff: {
      removed: removedFrom,
      added: result.blocks.filter((b) => b.refId === taskId),
      summary: movedIn
        ? `Moved "${task.title}" from ${fromDate} to ${toDate} and re-planned ${toDate} around it.`
        : `Removed "${task.title}" from ${fromDate}, but it did not fit into ${toDate}'s available time (see unscheduled list) — it remains pending.`,
    },
    blocks: working,
  };
}

/**
 * A new urgent task appears. Adds it to the pool and re-plans `date`; since
 * it competes on the same deterministic score as everything else, it will
 * naturally displace lower-priority auto-scheduled work (never fixed
 * events) if its score warrants it.
 */
export function replanDayWithNewTask(
  date: ISODate,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  blocks: ScheduleBlock[],
  scoringCtx: ScoringContext,
): { diff: ScheduleDiff; blocks: ScheduleBlock[] } {
  const before = blocks.filter((b) => b.date === date && b.source === 'auto' && !b.locked);
  const working = blocks.filter((b) => !(b.date === date && b.source === 'auto' && !b.locked));
  const result = generateDayPlan(date, tasks, events, availability, working, scoringCtx, {
    idPrefix: 'reschedule',
  });
  const after = result.blocks.filter((b) => b.type === 'task');

  const beforeIds = new Set(before.map((b) => `${b.refId}:${b.start}`));
  const afterIds = new Set(after.map((b) => `${b.refId}:${b.start}`));
  const removed = before.filter((b) => !afterIds.has(`${b.refId}:${b.start}`));
  const added = after.filter((b) => !beforeIds.has(`${b.refId}:${b.start}`));

  return {
    diff: {
      removed,
      added,
      summary: `Re-planned ${date}: ${added.length} block(s) added/changed, ${removed.length} removed.`,
    },
    blocks: [...working, ...result.blocks],
  };
}
