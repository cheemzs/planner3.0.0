import type { AvailabilityConfig, ISODate, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { classifyFeasibility, topologicalOrder, type FeasibilityModel, type TaskFeasibility } from './constraints';
import { addDays, daysBetween } from './time-utils';
import { importanceOf } from './scoring';

export type Allocation = Map<string, Map<ISODate, number>>; // taskId -> date -> minutes

export interface ObjectiveWeights {
  workloadImbalance: number;
  contextSwitch: number;
  fragmentation: number;
  deadlineBuffer: number;
  change: number;
}

export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  workloadImbalance: 20,
  contextSwitch: 3,
  fragmentation: 4,
  deadlineBuffer: 15,
  change: 8,
};

export interface HorizonPlanOptions {
  horizonStart: ISODate;
  horizonEnd: ISODate;
  maxDailyChunkPerTask?: number;
  maxDailyShareOfDay?: number;
  /** The schedule as it exists today, used purely to penalise unnecessary churn — never a hard constraint. */
  previousAllocation?: Allocation;
  weights?: Partial<ObjectiveWeights>;
  iterationCap?: number;
}

export interface ObjectiveBreakdown {
  workloadImbalance: number;
  contextSwitch: number;
  fragmentation: number;
  deadlineBuffer: number;
  change: number;
  total: number;
}

export interface HorizonPlanResult {
  allocation: Allocation;
  feasibility: Map<string, TaskFeasibility>;
  objective: ObjectiveBreakdown;
  explanation: Map<string, string>;
  iterationsRun: number;
}

const DEFAULT_MAX_DAILY_CHUNK = 150;
const DEFAULT_MAX_SHARE = 0.6;
const DEFAULT_ITERATION_CAP = 150;

/**
 * Plans an entire horizon at once. This is the core solver:
 *
 *   1. Hard constraints first: cycle-check the dependency graph, compute
 *      real per-day capacity, and classify every task's feasibility via
 *      EDF admission control (constraints.ts). Nothing beyond what is
 *      structurally feasible is ever handed to the optimizer.
 *   2. Constrained construction: a topological, deadline-ordered pass
 *      allocates each task's feasible minutes across its feasible days,
 *      respecting per-day capacity, per-task daily chunk caps, and
 *      dependency sequencing (a task cannot start before its
 *      dependencies' last allocated day).
 *   3. Local search: a bounded, deterministic hill-climbing pass that
 *      moves whole day-allocations between days to reduce an explicit
 *      multi-term objective (workload balance, context-switching,
 *      fragmentation, deadline buffer, and change-minimization vs. any
 *      previous schedule), accepting a move only if it still satisfies
 *      every hard constraint and strictly reduces total cost.
 *
 * The result is "the best feasible schedule found", not "the highest
 * scoring tasks placed first".
 */
export function planHorizon(
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  existingBlocks: ScheduleBlock[],
  options: HorizonPlanOptions,
): HorizonPlanResult {
  const { horizonStart, horizonEnd } = options;
  const maxDailyChunk = options.maxDailyChunkPerTask ?? DEFAULT_MAX_DAILY_CHUNK;
  const maxShare = options.maxDailyShareOfDay ?? DEFAULT_MAX_SHARE;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const iterationCap = options.iterationCap ?? DEFAULT_ITERATION_CAP;

  const eligible = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.remainingMinutes > 0 && t.autoSchedulable !== false,
  );
  const completedIds = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id));

  // --- Step 1: hard constraints ---
  const feasibility = classifyFeasibility(eligible, availability, events, existingBlocks, horizonStart, horizonEnd);

  if (feasibility.cycle) {
    const explanation = new Map<string, string>();
    for (const [id, f] of feasibility.perTask) explanation.set(id, f.reason ?? 'Blocked by a dependency cycle.');
    return {
      allocation: new Map(),
      feasibility: feasibility.perTask,
      objective: { workloadImbalance: 0, contextSwitch: 0, fragmentation: 0, deadlineBuffer: 0, change: 0, total: 0 },
      explanation,
      iterationsRun: 0,
    };
  }

  let order: PlanTask[];
  try {
    order = topologicalOrder(eligible, completedIds);
  } catch {
    order = [...eligible]; // defensive fallback; classifyFeasibility already checked for cycles above
  }

  // Deadline-ordered within dependency-ready groups: topologicalOrder only
  // guarantees dependency ordering, so stable-sort by deadline day as a
  // secondary key purely to decide *construction order* (a feasibility
  // concern — whose window closes first), not task value.
  order = [...order].sort((a, b) => {
    const fa = feasibility.perTask.get(a.id);
    const fb = feasibility.perTask.get(b.id);
    const da = fa?.deadlineDay ?? horizonEnd;
    const db = fb?.deadlineDay ?? horizonEnd;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  // Re-stabilize against the dependency-respecting order: a task must never
  // be moved before an unresolved dependency just because its deadline is
  // earlier. We do this by re-running a constrained topo-sort using the
  // deadline order as the tie-break preference.
  order = topoSortWithPreference(eligible, completedIds, order);

  // --- Step 2: constrained construction ---
  const dayRemaining = new Map(feasibility.dayCapacities);
  const allocation: Allocation = new Map();
  const finishDay = new Map<string, ISODate>();

  for (const task of order) {
    const fm = feasibility.perTask.get(task.id);
    if (!fm) continue;

    let earliest = fm.earliestDay;
    for (const depId of task.dependsOn ?? []) {
      const depFinish = finishDay.get(depId);
      if (depFinish) {
        const pushed = addDays(depFinish, 1);
        if (pushed > earliest) earliest = pushed;
      }
    }

    const perTaskAlloc = new Map<ISODate, number>();
    if (earliest > fm.deadlineDay) {
      // Dependency chain alone pushes this task past its own deadline —
      // structurally infeasible regardless of capacity.
      allocation.set(task.id, perTaskAlloc);
      continue;
    }

    const days: ISODate[] = [];
    for (let d = earliest; d <= fm.deadlineDay; d = addDays(d, 1)) days.push(d);

    const minChunk = task.minChunkMinutes ?? 15;
    const taskMaxChunk = Math.min(task.maxChunkMinutes ?? maxDailyChunk, maxDailyChunk);

    let need = fm.feasibleMinutes;
    need = roundRobinAllocate(days, need, perTaskAlloc, dayRemaining, taskMaxChunk, maxShare, feasibility.dayCapacities, minChunk);
    if (need > 0) {
      // Relax the "share of day" cap — still respects real capacity and chunk size.
      need = roundRobinAllocate(days, need, perTaskAlloc, dayRemaining, taskMaxChunk, 1, feasibility.dayCapacities, minChunk);
    }
    if (need > 0) {
      // Last resort: relax chunk cap too, but never exceed real remaining capacity.
      need = roundRobinAllocate(days, need, perTaskAlloc, dayRemaining, Infinity, 1, feasibility.dayCapacities, 1);
    }

    allocation.set(task.id, perTaskAlloc);
    const usedDays = [...perTaskAlloc.keys()].sort();
    if (usedDays.length > 0) finishDay.set(task.id, usedDays[usedDays.length - 1]);
  }

  // --- Step 3: local search refinement ---
  const taskById = new Map(eligible.map((t) => [t.id, t]));
  const { iterations } = localSearch(
    allocation,
    taskById,
    feasibility,
    dayRemaining,
    weights,
    options.previousAllocation,
    iterationCap,
  );

  const objective = computeObjective(allocation, taskById, feasibility, options.previousAllocation, weights);
  const explanation = buildExplanations(allocation, taskById, feasibility);

  return { allocation, feasibility: feasibility.perTask, objective, explanation, iterationsRun: iterations };
}

/** Allocates `need` minutes of a task across `days`, respecting day capacity, a per-day chunk cap, a share-of-day cap, and a minimum useful chunk size. Returns leftover unallocated minutes. */
function roundRobinAllocate(
  days: ISODate[],
  need: number,
  perTaskAlloc: Map<ISODate, number>,
  dayRemaining: Map<ISODate, number>,
  maxChunk: number,
  maxShare: number,
  dayCapacities: Map<ISODate, number>,
  minChunk: number,
): number {
  let progressed = true;
  while (need > 0 && progressed) {
    progressed = false;
    for (const date of days) {
      if (need <= 0) break;
      const left = dayRemaining.get(date) ?? 0;
      if (left <= 0) continue;
      const dayCap = dayCapacities.get(date) ?? 0;
      const already = perTaskAlloc.get(date) ?? 0;
      const chunkRoom = Math.max(0, maxChunk - already);
      let chunk: number;
      if (maxShare >= 1) {
        chunk = Math.min(need, left, chunkRoom);
      } else {
        const shareCap = Math.max(0, Math.floor(dayCap * maxShare) - already);
        chunk = Math.min(need, left, chunkRoom, shareCap);
      }
      if (chunk < minChunk && chunk < need) continue; // not worth a tiny fragment unless it's the final remainder
      if (chunk <= 0) continue;
      perTaskAlloc.set(date, already + chunk);
      dayRemaining.set(date, left - chunk);
      need -= chunk;
      progressed = true;
    }
  }
  return need;
}

/** Re-orders a Kahn topological pass using `preference` as the tie-break among ready tasks, instead of arbitrary discovery order. */
function topoSortWithPreference(tasks: PlanTask[], completedIds: Set<string>, preference: PlanTask[]): PlanTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const prefIndex = new Map(preference.map((t, i) => [t.id, i]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    const unmet = (t.dependsOn ?? []).filter((d) => byId.has(d) && !completedIds.has(d));
    indegree.set(t.id, unmet.length);
    for (const d of unmet) dependents.set(d, [...(dependents.get(d) ?? []), t.id]);
  }
  let ready = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0);
  const order: PlanTask[] = [];
  const seen = new Set<string>();
  while (ready.length > 0) {
    ready.sort((a, b) => (prefIndex.get(a.id) ?? 0) - (prefIndex.get(b.id) ?? 0));
    const next = ready.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    order.push(next);
    const newlyReady: PlanTask[] = [];
    for (const dep of dependents.get(next.id) ?? []) {
      indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      if (indegree.get(dep) === 0) {
        const t = byId.get(dep);
        if (t) newlyReady.push(t);
      }
    }
    ready = [...ready, ...newlyReady];
  }
  return order.length === tasks.length ? order : preference; // fallback if something odd happened
}

// ---------------------------------------------------------------------------
// Objective function
// ---------------------------------------------------------------------------

function computeObjective(
  allocation: Allocation,
  taskById: Map<string, PlanTask>,
  feasibility: FeasibilityModel,
  previousAllocation: Allocation | undefined,
  weights: ObjectiveWeights,
): ObjectiveBreakdown {
  const dayTotals = new Map<ISODate, number>();
  const dayTaskCounts = new Map<ISODate, Set<string>>();

  for (const [taskId, perDate] of allocation) {
    for (const [date, minutes] of perDate) {
      if (minutes <= 0) continue;
      dayTotals.set(date, (dayTotals.get(date) ?? 0) + minutes);
      const set = dayTaskCounts.get(date) ?? new Set<string>();
      set.add(taskId);
      dayTaskCounts.set(date, set);
    }
  }

  // Workload imbalance: population stddev of daily utilization ratios among days with capacity.
  const utilizations: number[] = [];
  for (const [date, cap] of feasibility.dayCapacities) {
    if (cap <= 0) continue;
    utilizations.push((dayTotals.get(date) ?? 0) / cap);
  }
  const workloadImbalance = stddev(utilizations);

  // Context switching: distinct tasks beyond the first, per day.
  let contextSwitch = 0;
  for (const set of dayTaskCounts.values()) contextSwitch += Math.max(0, set.size - 1);

  // Fragmentation: days used beyond the theoretical minimum for each task.
  let fragmentation = 0;
  for (const [taskId, perDate] of allocation) {
    const task = taskById.get(taskId);
    if (!task) continue;
    const used = [...perDate.values()].filter((m) => m > 0);
    if (used.length === 0) continue;
    const total = used.reduce((s, m) => s + m, 0);
    const maxChunk = task.maxChunkMinutes ?? DEFAULT_MAX_DAILY_CHUNK;
    const minDaysNeeded = Math.max(1, Math.ceil(total / maxChunk));
    fragmentation += Math.max(0, used.length - minDaysNeeded);
  }

  // Deadline buffer: penalise tasks whose last allocated day sits right on
  // (or after) their deadline. Scaled by importance (1-5 -> 0.3-1.0x) so a
  // thin buffer on a merely-nice-to-have task costs less than the same
  // thin buffer on a high-importance one — this is the one place a
  // priority-style signal feeds the objective, as a weight on a
  // constraint-derived cost, never as the thing that decides placement.
  let deadlineBuffer = 0;
  for (const [taskId, perDate] of allocation) {
    const fm = feasibility.perTask.get(taskId);
    if (!fm?.deadline) continue;
    const task = taskById.get(taskId);
    const usedDays = [...perDate.entries()].filter(([, m]) => m > 0).map(([d]) => d);
    if (usedDays.length === 0) continue;
    const lastDay = usedDays.sort().at(-1)!;
    const bufferDays = daysBetween(lastDay, fm.deadlineDay);
    const importanceWeight = task ? 0.3 + 0.7 * (importanceOf(task) / 5) : 1;
    deadlineBuffer += Math.max(0, 1 - bufferDays) * importanceWeight;
  }

  // Change minimization: how many (task, date) cells differ from the previous allocation.
  let change = 0;
  if (previousAllocation) {
    const allKeys = new Set<string>();
    for (const [taskId, perDate] of allocation) for (const date of perDate.keys()) allKeys.add(`${taskId}|${date}`);
    for (const [taskId, perDate] of previousAllocation) for (const date of perDate.keys()) allKeys.add(`${taskId}|${date}`);
    for (const key of allKeys) {
      const [taskId, date] = key.split('|');
      const a = allocation.get(taskId)?.get(date) ?? 0;
      const b = previousAllocation.get(taskId)?.get(date) ?? 0;
      if (a !== b) change += 1;
    }
  }

  const total =
    weights.workloadImbalance * workloadImbalance +
    weights.contextSwitch * contextSwitch +
    weights.fragmentation * fragmentation +
    weights.deadlineBuffer * deadlineBuffer +
    weights.change * change;

  return { workloadImbalance, contextSwitch, fragmentation, deadlineBuffer, change, total };
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Local search: deterministic, bounded, first-improvement hill climbing.
// Every candidate move is validated against hard constraints before it is
// ever scored, so the optimizer can never "improve" its way into an
// infeasible schedule.
// ---------------------------------------------------------------------------

function localSearch(
  allocation: Allocation,
  taskById: Map<string, PlanTask>,
  feasibility: FeasibilityModel,
  dayRemaining: Map<ISODate, number>,
  weights: ObjectiveWeights,
  previousAllocation: Allocation | undefined,
  iterationCap: number,
): { iterations: number } {
  let iterations = 0;
  let improved = true;

  while (improved && iterations < iterationCap) {
    improved = false;
    iterations += 1;
    const currentCost = computeObjective(allocation, taskById, feasibility, previousAllocation, weights).total;

    for (const [taskId, perDate] of allocation) {
      const task = taskById.get(taskId);
      const fm = feasibility.perTask.get(taskId);
      if (!task || !fm) continue;
      const sourceDays = [...perDate.entries()].filter(([, m]) => m > 0).map(([d]) => d);

      for (const sourceDay of sourceDays) {
        const amount = perDate.get(sourceDay)!;
        for (let d = fm.earliestDay; d <= fm.deadlineDay; d = addDays(d, 1)) {
          if (d === sourceDay) continue;
          const destCapacity = dayRemaining.get(d) ?? 0;
          const destExisting = perDate.get(d) ?? 0;
          const maxChunk = Math.min(task.maxChunkMinutes ?? DEFAULT_MAX_DAILY_CHUNK, DEFAULT_MAX_DAILY_CHUNK);
          if (destExisting + amount > maxChunk) continue;
          if (amount > destCapacity) continue;

          // Apply the move tentatively.
          perDate.set(sourceDay, 0);
          perDate.set(d, destExisting + amount);
          dayRemaining.set(sourceDay, (dayRemaining.get(sourceDay) ?? 0) + amount);
          dayRemaining.set(d, destCapacity - amount);

          const newCost = computeObjective(allocation, taskById, feasibility, previousAllocation, weights).total;
          if (newCost < currentCost - 1e-9) {
            improved = true;
            break;
          }

          // Revert.
          perDate.set(sourceDay, amount);
          perDate.set(d, destExisting);
          dayRemaining.set(sourceDay, (dayRemaining.get(sourceDay) ?? 0) - amount);
          dayRemaining.set(d, destCapacity);
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return { iterations };
}

// ---------------------------------------------------------------------------
// Explanations: derived directly from the constraint/feasibility model and
// the final allocation, never invented independently of them.
// ---------------------------------------------------------------------------

function buildExplanations(
  allocation: Allocation,
  taskById: Map<string, PlanTask>,
  feasibility: FeasibilityModel,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [taskId, fm] of feasibility.perTask) {
    const task = taskById.get(taskId);
    if (!task) continue;
    const perDate = allocation.get(taskId) ?? new Map();
    const totalAllocated = [...perDate.values()].reduce((s, m) => s + m, 0);
    const days = [...perDate.entries()].filter(([, m]) => m > 0).map(([d]) => d).sort();

    if (fm.status === 'infeasible' || totalAllocated === 0) {
      out.set(taskId, fm.reason ?? `Could not fit "${task.title}" into the available capacity before its deadline.`);
      continue;
    }

    const parts: string[] = [];
    if (fm.status === 'partial') {
      parts.push(`only ${totalAllocated} of ${fm.requiredMinutes} required minutes fit — ${fm.reason ?? ''}`.trim());
    } else if (task.deadline) {
      parts.push(`due ${task.deadline}, needs ~${fm.requiredMinutes} min`);
    }
    if (days.length > 1) parts.push(`spread across ${days.length} days (${days[0]}..${days.at(-1)}) to avoid a single overloaded session`);
    else if (days.length === 1) parts.push(`placed on ${days[0]}`);
    out.set(taskId, `"${task.title}": ${parts.join('; ')}.`);
  }
  return out;
}
