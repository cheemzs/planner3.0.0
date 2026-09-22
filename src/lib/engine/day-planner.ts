import type { AvailabilityConfig, ISODate, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { planHorizon, type Allocation } from './optimizer';
import { placeDay, type UnplacedEntry } from './day-placement';
import type { ScoringContext } from './scoring';
import { addDays } from './time-utils';

export interface DayPlanOptions {
  notBeforeMinutes?: number;
  /**
   * If provided, the horizon has already been solved elsewhere (typically
   * by the week planner) and we should just place these exact per-task
   * minute targets for the day rather than re-solving.
   */
  targetMinutesByTask?: Map<string, number>;
  explanations?: Map<string, string>;
  idPrefix?: string;
  /** How many days beyond `date` the optimizer should consider when deciding what belongs on `date`. */
  lookaheadDays?: number;
  /** The schedule as it existed before this replan, purely to discourage unnecessary churn. */
  previousAllocation?: Allocation;
}

export interface UnscheduledEntry {
  taskId: string;
  title: string;
  minutesUnscheduled: number;
  reason: string;
}

export interface DayPlanResult {
  date: ISODate;
  blocks: ScheduleBlock[];
  unscheduled: UnscheduledEntry[];
  freeMinutesTotal: number;
  scheduledMinutes: number;
  /** The full horizon allocation this day's plan was derived from, so callers (e.g. reschedule ops) can reuse it. */
  allocation?: Allocation;
}

const DEFAULT_LOOKAHEAD_DAYS = 13; // today + 13 = a 14-day horizon

/**
 * Produces a single day's schedule. Internally this still solves a small
 * multi-day horizon (today plus a lookahead) with the constraint-based
 * optimizer — so that a task due later this week doesn't get crammed
 * entirely into today just because "today" was asked for in isolation —
 * and then places only today's resulting slice into concrete time blocks.
 */
export function generateDayPlan(
  date: ISODate,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  existingBlocks: ScheduleBlock[],
  _scoringCtx: ScoringContext,
  options: DayPlanOptions = {},
): DayPlanResult {
  let targetsForDate: Map<string, number>;
  let explanations: Map<string, string>;
  let allocation: Allocation | undefined;

  if (options.targetMinutesByTask) {
    targetsForDate = options.targetMinutesByTask;
    explanations = options.explanations ?? new Map();
  } else {
    const horizonEnd = addDays(date, options.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS);
    const result = planHorizon(tasks, events, availability, existingBlocks, {
      horizonStart: date,
      horizonEnd,
      previousAllocation: options.previousAllocation,
    });
    allocation = result.allocation;
    explanations = result.explanation;
    targetsForDate = new Map();
    for (const [taskId, perDate] of result.allocation) {
      const minutes = perDate.get(date) ?? 0;
      if (minutes > 0) targetsForDate.set(taskId, minutes);
    }
  }

  const placement = placeDay(date, targetsForDate, tasks, events, availability, existingBlocks, explanations, {
    notBeforeMinutes: options.notBeforeMinutes,
    idPrefix: options.idPrefix,
  });

  const unscheduled: UnscheduledEntry[] = placement.unplaced.map((u: UnplacedEntry) => ({
    taskId: u.taskId,
    title: u.title,
    minutesUnscheduled: u.minutesUnplaced,
    reason: u.reason,
  }));

  return {
    date,
    blocks: placement.blocks,
    unscheduled,
    freeMinutesTotal: placement.freeMinutesTotal,
    scheduledMinutes: placement.placedMinutes,
    allocation,
  };
}
