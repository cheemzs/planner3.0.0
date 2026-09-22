import type { AvailabilityConfig, ISODate, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { planHorizon, type Allocation, type ObjectiveBreakdown } from './optimizer';
import { placeDay } from './day-placement';
import type { DayPlanResult } from './day-planner';
import type { ScoringContext } from './scoring';
import { addDays, weekDates } from './time-utils';

export interface WeekPlanOptions {
  idPrefix?: string;
  previousAllocation?: Allocation;
}

export interface DayWorkload {
  date: ISODate;
  freeMinutes: number;
  scheduledMinutes: number;
  utilization: number;
  taskCount: number;
  overloaded: boolean;
}

export interface WeekPlanResult {
  weekStart: ISODate;
  days: DayPlanResult[];
  workload: DayWorkload[];
  allocations: Allocation;
  unmetDeadlines: { taskId: string; title: string; deadline: string; shortfallMinutes: number }[];
  objective: ObjectiveBreakdown;
}

/**
 * Plans a full week as a single constrained-optimization problem (see
 * optimizer.ts), then places each day's resulting slice into concrete
 * blocks. This does NOT generate seven independent daily plans — the
 * allocation across all seven days is solved together, so a task due
 * Friday genuinely gets spread across the earlier days that have room
 * for it rather than being decided one day at a time.
 */
export function generateWeekPlan(
  weekStart: ISODate,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  existingBlocks: ScheduleBlock[],
  _scoringCtx: ScoringContext,
  options: WeekPlanOptions = {},
): WeekPlanResult {
  const dates = weekDates(weekStart);
  const horizonEnd = dates[dates.length - 1];

  const solved = planHorizon(tasks, events, availability, existingBlocks, {
    horizonStart: weekStart,
    horizonEnd,
    previousAllocation: options.previousAllocation,
  });

  const days: DayPlanResult[] = [];
  const workload: DayWorkload[] = [];

  for (const date of dates) {
    const targetMinutesByTask = new Map<string, number>();
    for (const [taskId, perDate] of solved.allocation) {
      const minutes = perDate.get(date);
      if (minutes && minutes > 0) targetMinutesByTask.set(taskId, minutes);
    }

    const placement = placeDay(date, targetMinutesByTask, tasks, events, availability, existingBlocks, solved.explanation, {
      idPrefix: options.idPrefix ?? 'wk',
    });

    days.push({
      date,
      blocks: placement.blocks,
      unscheduled: placement.unplaced.map((u) => ({
        taskId: u.taskId,
        title: u.title,
        minutesUnscheduled: u.minutesUnplaced,
        reason: u.reason,
      })),
      freeMinutesTotal: placement.freeMinutesTotal,
      scheduledMinutes: placement.placedMinutes,
    });

    const freeMinutes = placement.freeMinutesTotal;
    workload.push({
      date,
      freeMinutes,
      scheduledMinutes: placement.placedMinutes,
      utilization: freeMinutes > 0 ? placement.placedMinutes / freeMinutes : 0,
      taskCount: new Set(placement.blocks.filter((b) => b.type === 'task').map((b) => b.refId)).size,
      overloaded: freeMinutes > 0 && placement.placedMinutes / freeMinutes > 0.9,
    });
  }

  const unmetDeadlines: WeekPlanResult['unmetDeadlines'] = [];
  for (const [taskId, fm] of solved.feasibility) {
    if (fm.status === 'infeasible' || fm.status === 'partial') {
      if (fm.deadlineDay >= weekStart && fm.deadlineDay <= horizonEnd) {
        unmetDeadlines.push({
          taskId,
          title: fm.title,
          deadline: fm.deadline ?? fm.deadlineDay,
          shortfallMinutes: fm.requiredMinutes - fm.feasibleMinutes,
        });
      }
    }
  }

  return { weekStart, days, workload, allocations: solved.allocation, unmetDeadlines, objective: solved.objective };
}

export function weekEnd(weekStart: ISODate): ISODate {
  return addDays(weekStart, 6);
}
