import type { AvailabilityConfig, ISODate, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { totalFreeMinutes } from './availability';
import { addDays } from './time-utils';

// ---------------------------------------------------------------------------
// Dependency graph: hard-constraint validation, run before anything else.
// ---------------------------------------------------------------------------

export interface CycleError {
  cycle: string[]; // task ids forming the cycle
}

/** Detects a cycle in the dependsOn graph among the given tasks. Returns the cycle path, or null if acyclic. */
export function detectDependencyCycle(tasks: PlanTask[]): CycleError | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(tasks.map((t) => [t.id, WHITE]));
  const stack: string[] = [];

  function visit(id: string): CycleError | null {
    color.set(id, GRAY);
    stack.push(id);
    const task = byId.get(id);
    for (const depId of task?.dependsOn ?? []) {
      if (!byId.has(depId)) continue; // dependency outside this task set (e.g. already completed/deleted) is not a cycle risk here
      const c = color.get(depId) ?? WHITE;
      if (c === GRAY) {
        const cycleStart = stack.indexOf(depId);
        return { cycle: [...stack.slice(cycleStart), depId] };
      }
      if (c === WHITE) {
        const found = visit(depId);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const t of tasks) {
    if (color.get(t.id) === WHITE) {
      const found = visit(t.id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Kahn's algorithm topological order (dependency-satisfied order). Tasks
 * whose dependencies are already completed (not present in `tasks`, or
 * present but marked completed) are treated as immediately ready. Throws if
 * a cycle exists — callers should run `detectDependencyCycle` first if they
 * want a graceful report instead of an exception.
 */
export function topologicalOrder(tasks: PlanTask[], completedIds: Set<string>): PlanTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const t of tasks) {
    const unmet = (t.dependsOn ?? []).filter((d) => byId.has(d) && !completedIds.has(d));
    indegree.set(t.id, unmet.length);
    for (const d of unmet) {
      dependents.set(d, [...(dependents.get(d) ?? []), t.id]);
    }
  }

  const queue = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: PlanTask[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(byId.get(id)!);
    for (const dep of dependents.get(id) ?? []) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      if (indegree.get(dep) === 0) queue.push(dep);
    }
  }

  if (order.length !== tasks.length) {
    throw new Error('Dependency cycle detected among tasks; cannot compute a topological order.');
  }
  return order;
}

// ---------------------------------------------------------------------------
// Day capacity: how much schedulable time actually exists each day,
// independent of which tasks might want it.
// ---------------------------------------------------------------------------

export interface DayCapacity {
  date: ISODate;
  totalMinutes: number;
}

export function computeDayCapacities(
  availability: AvailabilityConfig,
  events: PlanEvent[],
  existingBlocks: ScheduleBlock[],
  horizonStart: ISODate,
  horizonEnd: ISODate,
): DayCapacity[] {
  const out: DayCapacity[] = [];
  let d = horizonStart;
  while (d <= horizonEnd) {
    out.push({ date: d, totalMinutes: totalFreeMinutes(availability, d, events, existingBlocks) });
    d = addDays(d, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feasibility classification: a hard-constraint pass that runs BEFORE
// optimization. Determines, per task, how much of its remaining work can
// possibly fit before its deadline given competing demands from other
// tasks with equal-or-earlier deadlines (classic EDF admission control) —
// this is what lets the planner say "this genuinely does not fit" instead
// of silently producing an impossible schedule.
// ---------------------------------------------------------------------------

export type FeasibilityStatus = 'feasible' | 'partial' | 'infeasible';

export interface TaskFeasibility {
  taskId: string;
  title: string;
  status: FeasibilityStatus;
  requiredMinutes: number;
  /** How much of this task's remaining work the horizon can actually accommodate, given earlier-deadline commitments. */
  feasibleMinutes: number;
  deadline?: string;
  earliestDay: ISODate;
  deadlineDay: ISODate; // clipped to horizonEnd if no deadline / deadline beyond horizon
  reason?: string;
}

export interface FeasibilityModel {
  perTask: Map<string, TaskFeasibility>;
  dayCapacities: Map<ISODate, number>;
  cycle: CycleError | null;
}

/**
 * The mandatory pre-optimization step: for every task (in dependency-ready,
 * deadline order) determine how many of its minutes can structurally fit
 * before its own deadline once tasks with an equal-or-earlier deadline have
 * already taken their share of the shared capacity. This is a hard
 * constraint check, not a heuristic preference — it never asks "which task
 * is more important", only "does this even fit".
 */
export function classifyFeasibility(
  tasks: PlanTask[],
  availability: AvailabilityConfig,
  events: PlanEvent[],
  existingBlocks: ScheduleBlock[],
  horizonStart: ISODate,
  horizonEnd: ISODate,
): FeasibilityModel {
  const cycle = detectDependencyCycle(tasks);
  const dayCaps = computeDayCapacities(availability, events, existingBlocks, horizonStart, horizonEnd);
  const dayCapacities = new Map(dayCaps.map((d) => [d.date, d.totalMinutes]));

  function capacityBetween(from: ISODate, to: ISODate): number {
    let sum = 0;
    let d = from < horizonStart ? horizonStart : from;
    const end = to > horizonEnd ? horizonEnd : to;
    while (d <= end) {
      sum += dayCapacities.get(d) ?? 0;
      d = addDays(d, 1);
    }
    return sum;
  }

  const perTask = new Map<string, TaskFeasibility>();
  if (cycle) {
    for (const t of tasks) {
      perTask.set(t.id, {
        taskId: t.id,
        title: t.title,
        status: 'infeasible',
        requiredMinutes: t.remainingMinutes,
        feasibleMinutes: 0,
        deadline: t.deadline,
        earliestDay: horizonStart,
        deadlineDay: horizonEnd,
        reason: `Blocked by a circular dependency chain: ${cycle.cycle.join(' -> ')}.`,
      });
    }
    return { perTask, dayCapacities, cycle };
  }

  // Sort by deadline (earlier first; undated tasks last), the standard EDF
  // admission order — this determines *whose capacity claim is checked
  // first*, which is a feasibility concept, not a value judgement about
  // which task "matters more".
  const withWindows = tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'cancelled' && t.remainingMinutes > 0)
    .map((t) => {
      const earliestDay = t.earliestStart && t.earliestStart.slice(0, 10) > horizonStart
        ? t.earliestStart.slice(0, 10)
        : horizonStart;
      const rawDeadlineDay = t.deadline ? t.deadline.slice(0, 10) : horizonEnd;
      // Clamp into [horizonStart, horizonEnd]: a deadline before the horizon
      // starts (i.e. the task is already overdue) still means "as soon as
      // possible", not "there is no time left at all" — it should compete
      // for today's capacity like anything else due today, not be treated
      // as an already-closed window with zero capacity.
      const deadlineDay = rawDeadlineDay < horizonStart ? horizonStart : rawDeadlineDay > horizonEnd ? horizonEnd : rawDeadlineDay;
      return { task: t, earliestDay, deadlineDay };
    })
    .sort((a, b) => (a.deadlineDay < b.deadlineDay ? -1 : a.deadlineDay > b.deadlineDay ? 1 : 0));

  let cumulativeCommitted = 0;
  for (const { task, earliestDay, deadlineDay } of withWindows) {
    const windowCapacity = capacityBetween(earliestDay, deadlineDay);
    const availableAfterEarlier = Math.max(0, windowCapacity - cumulativeCommitted);
    const required = task.remainingMinutes;
    const feasibleMinutes = Math.min(required, availableAfterEarlier);
    const status: FeasibilityStatus =
      feasibleMinutes >= required ? 'feasible' : feasibleMinutes > 0 ? 'partial' : 'infeasible';

    perTask.set(task.id, {
      taskId: task.id,
      title: task.title,
      status,
      requiredMinutes: required,
      feasibleMinutes,
      deadline: task.deadline,
      earliestDay,
      deadlineDay,
      reason:
        status === 'feasible'
          ? undefined
          : task.deadline
            ? `Only ${feasibleMinutes} of ${required} required minute(s) fit before ${task.deadline} once earlier-deadline work is accounted for.`
            : `Only ${feasibleMinutes} of ${required} required minute(s) fit within the planning horizon.`,
    });

    // Only tasks with an actual deadline compete for shared "before this
    // deadline" capacity in the EDF sense; undated tasks don't constrain
    // anyone else's deadline feasibility.
    if (task.deadline) cumulativeCommitted += required;
  }

  return { perTask, dayCapacities, cycle: null };
}
