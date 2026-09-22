import type { ISODate, PlanEvent, PlanTask, ScheduleBlock } from './engine/types';
import * as repo from './repository';
import { generateDayPlan, type DayPlanResult } from './engine/day-planner';
import { generateWeekPlan, type WeekPlanResult } from './engine/week-planner';
import { analyseFeasibility, analyseWorkload, type FeasibilityReport, type WorkloadReport } from './engine/feasibility';
import { getNextAction, type NextActionResult } from './engine/next-action';
import { findFreeTimeFit, type FreeTimeFitResult } from './engine/free-time';
import {
  applyInterruption,
  handleSkippedTask,
  insertUnexpectedEvent,
  moveTask as moveTaskPure,
  replanDayWithNewTask,
  type ScheduleDiff,
} from './engine/reschedule';
import type { ScoringContext } from './engine/scoring';
import { addDays, minutesToTime, nowParts, startOfWeek } from './engine/time-utils';
import { computeFreeWindows, totalFreeMinutes } from './engine/availability';
import type { SplitPhase } from './engine/task-split';

const DEFAULT_AVG_DAILY_AVAILABLE_MINUTES_FALLBACK = 120;

function buildScoringContext(now: Date, tasks: PlanTask[], avgDailyAvailableMinutes: number): ScoringContext {
  return {
    now,
    avgDailyAvailableMinutes: Math.max(30, avgDailyAvailableMinutes),
    completedTaskIds: new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id)),
  };
}

async function estimateAvgDailyAvailableMinutes(aroundDate: ISODate): Promise<number> {
  const availability = await repo.getAvailability();
  const events = await repo.listEvents();
  const blocks = await repo.listStoredBlocks({});
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(aroundDate, i);
    total += totalFreeMinutes(availability, date, events, blocks);
  }
  return total / 7 || DEFAULT_AVG_DAILY_AVAILABLE_MINUTES_FALLBACK;
}

export async function planDay(date: ISODate, now: Date = new Date()): Promise<DayPlanResult> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const existingBlocks = await repo.listStoredBlocks({});

  const { date: today, time } = nowParts(now);
  const notBeforeMinutes = date === today ? timeToMinutesSafe(time) : undefined;

  const avgDaily = await estimateAvgDailyAvailableMinutes(date);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);

  const result = generateDayPlan(date, tasks, events, availability, existingBlocks, scoringCtx, { notBeforeMinutes });
  await repo.saveGeneratedBlocks([date], result.blocks);
  return result;
}

export async function planWeek(weekStart: ISODate, now: Date = new Date()): Promise<WeekPlanResult> {
  const monday = startOfWeek(weekStart);
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const existingBlocks = await repo.listStoredBlocks({});

  const avgDaily = await estimateAvgDailyAvailableMinutes(monday);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);

  const result = generateWeekPlan(monday, tasks, events, availability, existingBlocks, scoringCtx);
  const dates = result.days.map((d) => d.date);
  const allBlocks = result.days.flatMap((d) => d.blocks);
  await repo.saveGeneratedBlocks(dates, allBlocks);
  return result;
}

export interface MonthPlanSummary {
  month: string;
  weeks: { weekStart: ISODate; plan: WeekPlanResult }[];
  milestoneTasks: { taskId: string; title: string; deadline?: string }[];
  feasibility: FeasibilityReport;
}

export async function planMonth(monthStart: ISODate, now: Date = new Date()): Promise<MonthPlanSummary> {
  const [y, m] = monthStart.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${monthStart.slice(0, 7)}-${String(daysInMonth).padStart(2, '0')}`;

  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();

  const milestoneTasks = tasks
    .filter((t) => t.deadline && t.deadline.slice(0, 10) >= monthStart && t.deadline.slice(0, 10) <= monthEnd)
    .filter((t) => t.priority === 'high' || t.priority === 'critical' || (t.estimatedMinutes ?? 0) >= 180)
    .map((t) => ({ taskId: t.id, title: t.title, deadline: t.deadline }))
    .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''));

  const weeks: MonthPlanSummary['weeks'] = [];
  let cursor = startOfWeek(monthStart);
  while (cursor <= monthEnd) {
    const plan = await planWeek(cursor, now);
    weeks.push({ weekStart: cursor, plan });
    cursor = addDays(cursor, 7);
  }

  const blocks = await repo.listStoredBlocks({});
  const feasibility = analyseFeasibility(tasks, events, availability, now, monthStart, monthEnd, blocks);

  return { month: monthStart.slice(0, 7), weeks, milestoneTasks, feasibility };
}

export async function nextAction(now: Date = new Date()): Promise<NextActionResult> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const { date } = nowParts(now);
  const blocks = await repo.listStoredBlocks({ date });
  const avgDaily = await estimateAvgDailyAvailableMinutes(date);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);
  return getNextAction(now, tasks, events, blocks, availability, scoringCtx);
}

export async function freeTimeFit(windowMinutes: number, now: Date = new Date()): Promise<FreeTimeFitResult> {
  const tasks = await repo.listTasks({});
  const { date } = nowParts(now);
  const avgDaily = await estimateAvgDailyAvailableMinutes(date);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);
  return findFreeTimeFit(windowMinutes, tasks, scoringCtx);
}

export async function checkFeasibility(rangeStart: ISODate, rangeEnd: ISODate, now: Date = new Date()): Promise<FeasibilityReport> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({});
  return analyseFeasibility(tasks, events, availability, now, rangeStart, rangeEnd, blocks);
}

export async function workloadReport(rangeStart: ISODate, rangeEnd: ISODate, now: Date = new Date()): Promise<WorkloadReport> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({});
  return analyseWorkload(tasks, events, availability, now, rangeStart, rangeEnd, blocks);
}

export async function findFreeTime(date: ISODate): Promise<{ start: string; end: string }[]> {
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({ date });
  return computeFreeWindows(availability, date, events, blocks).map((w) => ({
    start: minutesToTime(w.start),
    end: minutesToTime(w.end),
  }));
}

async function persistReschedule(affectedDates: ISODate[], blocks: ScheduleBlock[]): Promise<void> {
  const byDate = new Map<ISODate, ScheduleBlock[]>();
  for (const b of blocks) {
    if (b.type === 'event') continue;
    const arr = byDate.get(b.date) ?? [];
    arr.push(b);
    byDate.set(b.date, arr);
  }
  for (const date of affectedDates) {
    await repo.saveGeneratedBlocks([date], byDate.get(date) ?? []);
  }
}

export async function rescheduleSkippedTask(
  taskId: string,
  fromDate: ISODate,
  horizonDays = 7,
  now: Date = new Date(),
): Promise<ScheduleDiff> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({});
  const avgDaily = await estimateAvgDailyAvailableMinutes(fromDate);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);

  const horizon = Array.from({ length: horizonDays }, (_, i) => addDays(fromDate, i + 1));
  const { diff, blocks: newBlocks } = handleSkippedTask(taskId, fromDate, tasks, events, availability, blocks, scoringCtx, horizon);
  await persistReschedule([fromDate, ...horizon], newBlocks);
  return diff;
}

export async function recordInterruption(taskId: string, minutesSpent: number): Promise<PlanTask> {
  const task = await repo.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const updated = applyInterruption(task, minutesSpent);
  return repo.updateTask(taskId, updated);
}

export async function addUnexpectedEvent(
  input: Omit<PlanEvent, 'id' | 'createdAt' | 'updatedAt'>,
  now: Date = new Date(),
): Promise<ScheduleDiff> {
  const created = await repo.createEvent(input);
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({});
  const avgDaily = await estimateAvgDailyAvailableMinutes(created.date);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);

  const { diff, blocks: newBlocks } = insertUnexpectedEvent(created, tasks, events, availability, blocks, scoringCtx);
  await persistReschedule([created.date], newBlocks);
  return diff;
}

export async function moveTask(taskId: string, fromDate: ISODate, toDate: ISODate, now: Date = new Date()): Promise<ScheduleDiff> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({});
  const avgDaily = await estimateAvgDailyAvailableMinutes(toDate);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);

  const { diff, blocks: newBlocks } = moveTaskPure(taskId, fromDate, toDate, tasks, events, availability, blocks, scoringCtx);
  await persistReschedule([fromDate, toDate], newBlocks);
  return diff;
}

export async function replanDay(date: ISODate, now: Date = new Date()): Promise<ScheduleDiff> {
  const tasks = await repo.listTasks({});
  const events = await repo.listEvents();
  const availability = await repo.getAvailability();
  const blocks = await repo.listStoredBlocks({});
  const avgDaily = await estimateAvgDailyAvailableMinutes(date);
  const scoringCtx = buildScoringContext(now, tasks, avgDaily);

  const { diff, blocks: newBlocks } = replanDayWithNewTask(date, tasks, events, availability, blocks, scoringCtx);
  await persistReschedule([date], newBlocks);
  return diff;
}

export async function splitTask(taskId: string, phases?: SplitPhase[]): Promise<PlanTask[]> {
  return repo.splitTask(taskId, phases);
}

function timeToMinutesSafe(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
