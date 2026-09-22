import type { AvailabilityConfig, ISODate, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { totalFreeMinutes } from './availability';
import { addDays } from './time-utils';
import { classifyFeasibility } from './constraints';

export interface AtRiskTask {
  taskId: string;
  title: string;
  deadline: string;
  requiredMinutes: number;
  availableMinutesBeforeDeadline: number;
  shortfallMinutes: number;
}

export interface FeasibilityReport {
  rangeStart: ISODate;
  rangeEnd: ISODate;
  totalRequiredMinutes: number;
  totalAvailableMinutes: number;
  feasible: boolean;
  atRiskTasks: AtRiskTask[];
  recommendations: string[];
}

/**
 * Earliest-Deadline-First feasibility check: processes tasks in deadline
 * order and, for each one, asks "after every task with an equal-or-earlier
 * deadline has taken its share, is there still enough available time left
 * before *this* task's deadline?". This is the standard way to detect
 * "you have 17 hours of work but only 10 hours before your deadlines" —
 * simply summing total work vs total time available hides which specific
 * deadline is actually at risk.
 */
export function analyseFeasibility(
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  _now: Date,
  rangeStart: ISODate,
  rangeEnd: ISODate,
  existingBlocks: ScheduleBlock[] = [],
): FeasibilityReport {
  const pending = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.remainingMinutes > 0,
  );

  // Delegate to the same hard-constraint feasibility model the optimizer
  // uses (constraints.ts), so "is this feasible" is answered identically
  // whether it's asked via a standalone report or as part of planning.
  const model = classifyFeasibility(pending, availability, events, existingBlocks, rangeStart, rangeEnd);

  const atRiskTasks: AtRiskTask[] = [];
  for (const t of pending) {
    if (!t.deadline) continue;
    const deadlineDate = t.deadline.slice(0, 10);
    if (deadlineDate > rangeEnd) continue;
    const fm = model.perTask.get(t.id);
    if (!fm || fm.status === 'feasible') continue;
    atRiskTasks.push({
      taskId: t.id,
      title: t.title,
      deadline: t.deadline,
      requiredMinutes: fm.requiredMinutes,
      availableMinutesBeforeDeadline: fm.feasibleMinutes,
      shortfallMinutes: fm.requiredMinutes - fm.feasibleMinutes,
    });
  }

  const totalRequiredMinutes = pending.reduce((s, t) => s + t.remainingMinutes, 0);
  let totalAvailableMinutes = 0;
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    totalAvailableMinutes += totalFreeMinutes(availability, cursor, events, existingBlocks);
    cursor = addDays(cursor, 1);
  }

  const recommendations: string[] = [];
  if (atRiskTasks.length > 0) {
    const sorted = [...atRiskTasks].sort((a, b) => b.shortfallMinutes - a.shortfallMinutes);
    for (const risk of sorted.slice(0, 5)) {
      const hours = (risk.shortfallMinutes / 60).toFixed(1);
      recommendations.push(
        `"${risk.title}" is short by about ${hours}h before its deadline (${risk.deadline}). Consider starting it sooner, reducing its scope, deprioritising a lower-value task earlier in the queue, or moving the deadline.`,
      );
    }
  } else if (totalRequiredMinutes > totalAvailableMinutes * 0.85) {
    recommendations.push(
      'Your workload is close to your available capacity for this period. Consider leaving less flexible time for new tasks.',
    );
  }

  return {
    rangeStart,
    rangeEnd,
    totalRequiredMinutes,
    totalAvailableMinutes,
    feasible: atRiskTasks.length === 0,
    atRiskTasks,
    recommendations,
  };
}

export interface WorkloadReport {
  rangeStart: ISODate;
  rangeEnd: ISODate;
  totalTasks: number;
  totalRequiredMinutes: number;
  totalAvailableMinutes: number;
  utilizationRatio: number;
  overdueCount: number;
  overdueTasks: { taskId: string; title: string; deadline?: string }[];
  byPriority: Record<PlanTask['priority'], number>;
}

export function analyseWorkload(
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  now: Date,
  rangeStart: ISODate,
  rangeEnd: ISODate,
  existingBlocks: ScheduleBlock[] = [],
): WorkloadReport {
  const pending = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.remainingMinutes > 0,
  );

  let cursor = rangeStart;
  let totalAvailableMinutes = 0;
  while (cursor <= rangeEnd) {
    totalAvailableMinutes += totalFreeMinutes(availability, cursor, events, existingBlocks);
    cursor = addDays(cursor, 1);
  }

  const totalRequiredMinutes = pending.reduce((s, t) => s + t.remainingMinutes, 0);
  const nowMs = now.getTime();
  const overdueTasks = pending
    .filter((t) => t.deadline && new Date(`${t.deadline}:00`).getTime() < nowMs)
    .map((t) => ({ taskId: t.id, title: t.title, deadline: t.deadline }));

  const byPriority: Record<PlanTask['priority'], number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const t of pending) byPriority[t.priority] += 1;

  return {
    rangeStart,
    rangeEnd,
    totalTasks: pending.length,
    totalRequiredMinutes,
    totalAvailableMinutes,
    utilizationRatio: totalAvailableMinutes > 0 ? totalRequiredMinutes / totalAvailableMinutes : Infinity,
    overdueCount: overdueTasks.length,
    overdueTasks,
    byPriority,
  };
}
