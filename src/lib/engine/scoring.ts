/**
 * Deterministic, explainable single-task scoring.
 *
 * IMPORTANT — scope of this module: this score is NOT how the planner
 * decides what goes on the schedule. Full-schedule construction (day,
 * week, month) is handled by the constraint-based optimizer
 * (constraints.ts + optimizer.ts), which satisfies hard constraints first
 * (dependencies, fixed events, availability, deadline feasibility) and
 * then optimizes an explicit multi-term objective across the whole
 * horizon — it never just sorts tasks by a score and places them
 * greedily.
 *
 * This scorer exists for the genuinely single-choice decisions where
 * "pick the one best option right now" is actually the correct framing,
 * not a simplification of a harder problem:
 *   - next-action.ts: "what should I do right now?"
 *   - free-time.ts: "I have 45 minutes, what should I work on?"
 * It is also used as one input signal inside the optimizer's objective
 * (see deadlineBuffer/urgency handling in optimizer.ts) — a component,
 * never the whole algorithm.
 */
import type { PlanTask, PriorityScore } from './types';
import { parseDate, splitDateTime, timeToMinutes } from './time-utils';

const PRIORITY_TO_IMPORTANCE: Record<PlanTask['priority'], number> = {
  low: 1.5,
  medium: 2.75,
  high: 4,
  critical: 5,
};

/** A task's 1-5 importance value, from its explicit field or its coarse priority label. Exported for reuse as an objective-function input elsewhere (e.g. optimizer.ts's deadline-buffer term) — importance is a component of scheduling cost, not the scheduler itself. */
export function importanceOf(task: Pick<PlanTask, 'importance' | 'priority'>): number {
  return task.importance ?? PRIORITY_TO_IMPORTANCE[task.priority];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface ScoringContext {
  /** Current time. */
  now: Date;
  /** Average minutes of schedulable availability per day, used to translate deadlines into time pressure. */
  avgDailyAvailableMinutes: number;
  /** IDs of tasks considered "done" for dependency-resolution purposes. */
  completedTaskIds: Set<string>;
}

/**
 * Scores a single task 0-100 across five transparent, independently-computed
 * factors (see PriorityScore.breakdown). This is intentionally *not*
 * "priority label -> rank" — a low-importance task with an imminent,
 * effort-heavy deadline can outscore a "critical"-labeled task that has
 * ample slack.
 */
export function scoreTask(task: PlanTask, ctx: ScoringContext): PriorityScore {
  const unmetDeps = (task.dependsOn ?? []).filter((id) => !ctx.completedTaskIds.has(id));
  if (unmetDeps.length > 0) {
    return {
      taskId: task.id,
      score: 0,
      breakdown: {
        deadlineUrgency: 0,
        importance: 0,
        overdue: 0,
        effortRisk: 0,
        dependencyPenalty: -100,
        flexibilityPenalty: 0,
      },
      explanation: `Blocked: waiting on ${unmetDeps.length} prerequisite task(s) to be completed first.`,
      schedulable: false,
      blockedReason: `Depends on incomplete task(s): ${unmetDeps.join(', ')}`,
    };
  }

  const nowEpochMinutes = Math.floor(ctx.now.getTime() / 60_000);

  const importanceValue = task.importance ?? PRIORITY_TO_IMPORTANCE[task.priority];
  const importanceScore = Math.round((clamp(importanceValue, 1, 5) / 5) * 25);

  let deadlineUrgency = 5; // baseline for tasks with no deadline: still worth *something*
  let overdueScore = 0;
  let flexibilityBonus = 0;

  if (task.deadline) {
    const deadlineEpochMinutes = epochMinutesOfIso(task.deadline);
    const minutesRemaining = deadlineEpochMinutes - nowEpochMinutes;
    const requiredMinutes = Math.max(0, task.remainingMinutes);

    if (minutesRemaining <= 0) {
      const overdueHours = Math.abs(minutesRemaining) / 60;
      overdueScore = Math.round(clamp(8 + overdueHours * 0.5, 0, 20));
      deadlineUrgency = 40;
    } else {
      const daysRemaining = minutesRemaining / (24 * 60);
      const availableMinutesEstimate = Math.max(
        1,
        daysRemaining * ctx.avgDailyAvailableMinutes,
      );

      // Ramps 0 -> 1 as the deadline goes from 21+ days out to "now" (section 8:
      // deadlines should matter well before they're imminent).
      const proximityFactor = clamp(1 - daysRemaining / 21, 0, 1);
      // How much of the estimated remaining availability this task alone would
      // consume; >=1 means it is at risk of not fitting without early starts.
      const pressureFactor = clamp(requiredMinutes / availableMinutesEstimate, 0, 2) / 2;

      deadlineUrgency = Math.round(40 * (0.5 * proximityFactor + 0.5 * pressureFactor));

      if (pressureFactor >= 0.5) {
        // Little slack between required effort and available time: treat as
        // "narrow window", nudging it up independent of the deadline date itself.
        flexibilityBonus = Math.round(clamp((pressureFactor - 0.5) * 10, 0, 5));
      }
    }
  }

  if (task.latestCompletion && task.latestCompletion !== task.deadline) {
    flexibilityBonus = Math.min(5, flexibilityBonus + 2);
  }

  const effortRisk = Math.round(clamp(task.remainingMinutes / 240, 0, 1) * 10);

  const score = clamp(
    deadlineUrgency + importanceScore + overdueScore + effortRisk + flexibilityBonus,
    0,
    100,
  );

  const parts: string[] = [];
  if (overdueScore > 0) parts.push('is overdue');
  if (task.deadline) {
    if (deadlineUrgency >= 25) parts.push('has an imminent or high-pressure deadline');
    else if (deadlineUrgency >= 10) parts.push('has an approaching deadline');
  }
  if (importanceScore >= 20) parts.push('is high importance');
  if (effortRisk >= 7) parts.push('still needs a large amount of remaining work');
  if (flexibilityBonus > 0) parts.push('has little scheduling slack left');
  const explanation =
    parts.length > 0
      ? `Prioritised because it ${parts.join(', ')}.`
      : 'Included with baseline priority; no urgent factors detected.';

  return {
    taskId: task.id,
    score,
    breakdown: {
      deadlineUrgency,
      importance: importanceScore,
      overdue: overdueScore,
      effortRisk,
      dependencyPenalty: 0,
      flexibilityPenalty: flexibilityBonus,
    },
    explanation,
    schedulable: true,
  };
}

function epochMinutesOfIso(iso: string): number {
  const { date, time } = splitDateTime(iso);
  const d = parseDate(date); // UTC-noon
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 60_000) + timeToMinutes(time);
}

export function scoreTasks(tasks: PlanTask[], ctx: ScoringContext): Map<string, PriorityScore> {
  const out = new Map<string, PriorityScore>();
  for (const t of tasks) out.set(t.id, scoreTask(t, ctx));
  return out;
}

export function rankTasks(tasks: PlanTask[], ctx: ScoringContext): PlanTask[] {
  const scores = scoreTasks(tasks, ctx);
  return [...tasks]
    .filter((t) => scores.get(t.id)!.schedulable)
    .sort((a, b) => scores.get(b.id)!.score - scores.get(a.id)!.score);
}
