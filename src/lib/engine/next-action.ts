import type { AvailabilityConfig, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { computeFreeWindows, eventsOnDate } from './availability';
import { rankTasks, scoreTask, type ScoringContext } from './scoring';
import { minutesToTime, nowParts, timeToMinutes } from './time-utils';

export type NextActionKind = 'in_fixed_event' | 'in_scheduled_task' | 'suggest_task' | 'suggest_break' | 'nothing_fits';

export interface NextActionResult {
  kind: NextActionKind;
  message: string;
  taskId?: string;
  until?: string; // "HH:mm" this action/window runs until
  minutesAvailable?: number;
  alternatives?: { taskId: string; title: string; score: number }[];
}

const MICRO_TASK_THRESHOLD = 10;

export function getNextAction(
  now: Date,
  tasks: PlanTask[],
  events: PlanEvent[],
  blocks: ScheduleBlock[],
  availability: AvailabilityConfig,
  scoringCtx: ScoringContext,
): NextActionResult {
  const { date, time } = nowParts(now);
  const nowMin = timeToMinutes(time);

  const currentEvent = eventsOnDate(events, date).find(
    (e) => timeToMinutes(e.start) <= nowMin && nowMin < timeToMinutes(e.end),
  );
  if (currentEvent) {
    return {
      kind: 'in_fixed_event',
      message: `You're currently in "${currentEvent.title}" until ${currentEvent.end}.`,
      until: currentEvent.end,
    };
  }

  const currentBlock = blocks.find(
    (b) => b.date === date && b.type === 'task' && timeToMinutes(b.start) <= nowMin && nowMin < timeToMinutes(b.end),
  );
  if (currentBlock) {
    return {
      kind: 'in_scheduled_task',
      message: `Your plan has you working on "${currentBlock.title}" until ${currentBlock.end}.${currentBlock.reason ? ` (${currentBlock.reason})` : ''}`,
      taskId: currentBlock.refId,
      until: currentBlock.end,
    };
  }

  // Find the next commitment (fixed event or scheduled block) to bound the
  // usable window.
  const upcoming = [
    ...eventsOnDate(events, date).map((e) => timeToMinutes(e.start)),
    ...blocks.filter((b) => b.date === date).map((b) => timeToMinutes(b.start)),
  ]
    .filter((t) => t > nowMin)
    .sort((a, b) => a - b);
  const windowEnd = upcoming[0] ?? computeDayEnd(availability, date);
  const minutesAvailable = Math.max(0, windowEnd - nowMin);

  const eligible = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      t.remainingMinutes > 0 &&
      (!t.earliestStart || t.earliestStart <= `${date}T${time}`),
  );
  const ranked = rankTasks(eligible, scoringCtx);

  const fitting = ranked.filter((t) => (t.minChunkMinutes ?? 20) <= minutesAvailable);

  if (fitting.length === 0) {
    if (ranked.length > 0 && minutesAvailable >= MICRO_TASK_THRESHOLD) {
      return {
        kind: 'nothing_fits',
        message: `You have about ${minutesAvailable} minute(s) free, which isn't enough to meaningfully start any pending task. Consider a short break, or admin/quick-win items not tracked as timed tasks.`,
        minutesAvailable,
      };
    }
    return {
      kind: 'suggest_break',
      message:
        minutesAvailable < MICRO_TASK_THRESHOLD
          ? `Only ${minutesAvailable} minute(s) until your next commitment — take a short break.`
          : 'Nothing pending fits right now — good time for a break.',
      minutesAvailable,
    };
  }

  const best = fitting[0];
  const score = scoreTask(best, scoringCtx);
  const alternatives = fitting.slice(1, 4).map((t) => ({
    taskId: t.id,
    title: t.title,
    score: scoreTask(t, scoringCtx).score,
  }));

  return {
    kind: 'suggest_task',
    message: `Work on "${best.title}" — you have ${minutesAvailable} minute(s) until ${minutesToTime(windowEnd)}. ${score.explanation}`,
    taskId: best.id,
    until: minutesToTime(windowEnd),
    minutesAvailable,
    alternatives,
  };
}

function computeDayEnd(availability: AvailabilityConfig, date: string): number {
  const windows = computeFreeWindows(availability, date, [], []);
  if (windows.length === 0) return timeToMinutes('22:00');
  return windows[windows.length - 1].end;
}
