import type { AvailabilityConfig, ISODate, PlanEvent, PlanTask, ScheduleBlock } from './types';
import { computeFreeWindows, eventsOnDate } from './availability';
import { type MinuteRange, isoDateTime, minutesToTime, nowParts, rangeMinutes, timeToMinutes } from './time-utils';

const DEFAULT_MIN_CHUNK = 15;
const DEFAULT_BUFFER = 10;

export interface PlacementOptions {
  notBeforeMinutes?: number;
  idPrefix?: string;
  bufferMinutes?: number;
}

export interface UnplacedEntry {
  taskId: string;
  title: string;
  minutesUnplaced: number;
  reason: string;
}

export interface DayPlacementResult {
  date: ISODate;
  blocks: ScheduleBlock[];
  unplaced: UnplacedEntry[];
  freeMinutesTotal: number;
  placedMinutes: number;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function windowMatchesPreference(window: MinuteRange, task: PlanTask): boolean {
  if (!task.preferredTimeOfDay || task.preferredTimeOfDay === 'any') return true;
  const mid = (window.start + window.end) / 2;
  if (task.preferredTimeOfDay === 'morning') return mid < 12 * 60;
  if (task.preferredTimeOfDay === 'afternoon') return mid >= 12 * 60 && mid < 17 * 60;
  return mid >= 17 * 60;
}

/**
 * Places already-decided minute allocations (task -> minutes for this day,
 * as produced by the optimizer) into concrete free-time windows. This
 * layer does not decide *what* gets worked on — only *when within the
 * day* — so it never overrides the optimizer's allocation, it only
 * refuses to place a chunk if it genuinely cannot fit (which the
 * optimizer's own capacity accounting should already prevent in all but
 * unusual edge cases, e.g. a same-day manual block appearing after
 * planning ran).
 */
export function placeDay(
  date: ISODate,
  targetMinutesByTask: Map<string, number>,
  tasks: PlanTask[],
  events: PlanEvent[],
  availability: AvailabilityConfig,
  existingBlocks: ScheduleBlock[],
  explanations: Map<string, string>,
  options: PlacementOptions = {},
): DayPlacementResult {
  const idPrefix = options.idPrefix ?? 'blk';
  const buffer = options.bufferMinutes ?? availability.bufferMinutes ?? DEFAULT_BUFFER;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const freeWindows = computeFreeWindows(availability, date, events, existingBlocks, {
    notBeforeMinutes: options.notBeforeMinutes,
  }).map((w) => ({ ...w }));
  const freeMinutesTotal = freeWindows.reduce((s, w) => s + rangeMinutes(w), 0);

  const now = nowParts(new Date());
  const createdAt = isoDateTime(now.date, now.time);

  const blocks: ScheduleBlock[] = [];
  const unplaced: UnplacedEntry[] = [];

  // Stable placement order: tasks with a preferred time-of-day and larger
  // chunks first (so they get first pick of matching windows), tie-broken
  // by task id for determinism.
  const ordered = [...targetMinutesByTask.entries()]
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [taskId, minutes] of ordered) {
    const task = taskById.get(taskId);
    if (!task) continue;
    const minChunk = task.minChunkMinutes ?? DEFAULT_MIN_CHUNK;

    const candidateWindows = freeWindows
      .map((w, idx) => ({ w, idx }))
      .filter(({ w }) => rangeMinutes(w) >= Math.min(minChunk, minutes))
      .sort((a, b) => {
        const prefA = windowMatchesPreference(a.w, task) ? 0 : 1;
        const prefB = windowMatchesPreference(b.w, task) ? 0 : 1;
        if (prefA !== prefB) return prefA - prefB;
        return a.w.start - b.w.start;
      });

    let remaining = minutes;
    for (const { w } of candidateWindows) {
      if (remaining <= 0) break;
      const available = rangeMinutes(w);
      if (available < Math.min(minChunk, remaining)) continue;
      const chunk = Math.min(remaining, available);
      if (chunk < minChunk && chunk < remaining) continue;

      const start = w.start;
      const end = start + chunk;
      blocks.push({
        id: nextId(idPrefix),
        date,
        start: minutesToTime(start),
        end: minutesToTime(end),
        type: 'task',
        refId: task.id,
        title: task.title,
        locked: false,
        source: 'auto',
        reason: explanations.get(task.id),
        createdAt,
        updatedAt: createdAt,
      });
      w.start = Math.min(end + buffer, w.end);
      remaining -= chunk;
    }

    if (remaining > 0) {
      unplaced.push({
        taskId,
        title: task.title,
        minutesUnplaced: remaining,
        reason: 'The optimizer allocated time for this task today, but no matching free window was available at placement time.',
      });
    }
  }

  for (const ev of eventsOnDate(events, date)) {
    blocks.push({
      id: nextId(idPrefix),
      date,
      start: ev.start,
      end: ev.end,
      type: 'event',
      refId: ev.id,
      title: ev.title,
      locked: ev.fixed,
      source: 'manual',
      createdAt,
      updatedAt: createdAt,
    });
  }

  blocks.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  const placedMinutes = blocks
    .filter((b) => b.type === 'task')
    .reduce((s, b) => s + (timeToMinutes(b.end) - timeToMinutes(b.start)), 0);

  return { date, blocks, unplaced, freeMinutesTotal, placedMinutes };
}
