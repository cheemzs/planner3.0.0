import type { ISODate } from './types';
import { dayOfWeek, intersectRanges, type MinuteRange } from './time-utils';

/**
 * Group "insights": given each member's free time per day, answers
 * questions like "when are the most people free together?" and "which
 * weekday works best?". Pure functions only -- no I/O, no clock.
 *
 * A "window" here is always a CONTINUOUS block of at least `minMinutes`
 * during which a specific set of people are all free the whole time. (Not
 * just "3 people are free at 9:00 and a different 3 at 9:30".)
 */

export interface GroupDay {
  date: ISODate;
  /** Free minute-ranges for each member that day (missing key = no free time). */
  freeByUser: Record<string, MinuteRange[]>;
}

export interface PeakWindow {
  date: ISODate;
  /** Minutes since midnight. */
  start: number;
  end: number;
  minutes: number;
  freeUserIds: string[];
  busyUserIds: string[];
  /** Every member is free for the whole window. */
  everyone: boolean;
}

export type DaypartName = 'morning' | 'afternoon' | 'evening';

export const DAYPARTS: { name: DaypartName; label: string; range: MinuteRange }[] = [
  { name: 'morning', label: 'Mornings', range: { start: 5 * 60, end: 12 * 60 } },
  { name: 'afternoon', label: 'Afternoons', range: { start: 12 * 60, end: 17 * 60 } },
  { name: 'evening', label: 'Evenings', range: { start: 17 * 60, end: 22 * 60 } },
];

export interface DayHeat {
  date: ISODate;
  /** Most members who are all free through one continuous block of >= minMinutes (0 if none). */
  peakCount: number;
  peakMinutes: number;
  /** Total minutes (in blocks >= minMinutes) during which EVERYONE is free. */
  everyoneMinutes: number;
}

export interface WeekdayStat {
  dayOfWeek: number; // 0=Sun..6=Sat
  days: number;
  avgPeakCount: number;
  avgEveryoneMinutes: number;
}

export interface DaypartStat {
  name: DaypartName;
  label: string;
  avgPeakCount: number;
  daysWithEveryone: number;
}

export interface GroupInsights {
  memberCount: number;
  minMinutes: number;
  daysAnalysed: number;
  /** Best time overall: most people free together, then longest, then soonest. Null if fewer than 2 people can ever coincide. */
  bestOverall: PeakWindow | null;
  /** Longest block when literally everyone is free. Null if that never happens. */
  bestEveryone: PeakWindow | null;
  /** Soonest day on which everyone is free. */
  nextEveryone: PeakWindow | null;
  /** Runner-up slots (one per day), best first, excluding bestOverall. */
  runnerUps: PeakWindow[];
  daysWithEveryone: number;
  totalEveryoneMinutes: number;
  perDay: DayHeat[];
  /** Only populated when there are enough days (>= 14) for a weekday pattern to mean anything. */
  weekdays: WeekdayStat[];
  bestWeekday: WeekdayStat | null;
  dayparts: DaypartStat[];
  bestDaypart: DaypartStat | null;
}

/** Sorts and merges overlapping/touching ranges (so 9-12 + 12-15 is one 9-15 block). */
export function mergeRanges(ranges: MinuteRange[]): MinuteRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MinuteRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

function clipRanges(ranges: MinuteRange[], to: MinuteRange): MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const r of ranges) {
    const start = Math.max(r.start, to.start);
    const end = Math.min(r.end, to.end);
    if (start < end) out.push({ start, end });
  }
  return out;
}

/**
 * The best single window on one day: the largest set of members who are
 * ALL free through one continuous block of at least `minMinutes`. Ties go
 * to the longer block, then the earlier one. Returns null if nobody has a
 * long-enough free block.
 *
 * Why candidate starts only: for any fixed group of people, the latest
 * "everyone has started being free" moment is the start of one of their
 * ranges, so trying each range-start as the window start finds every
 * maximal window.
 */
export function peakWindowForDay(day: GroupDay, memberIds: string[], minMinutes: number): PeakWindow | null {
  const min = Math.max(1, minMinutes);
  const merged: Record<string, MinuteRange[]> = {};
  const candidates = new Set<number>();
  for (const id of memberIds) {
    const m = mergeRanges(day.freeByUser[id] ?? []);
    merged[id] = m;
    for (const r of m) if (r.end - r.start >= min) candidates.add(r.start);
  }

  let best: { start: number; end: number; free: string[] } | null = null;
  for (const s of [...candidates].sort((a, b) => a - b)) {
    const free: string[] = [];
    let end = Infinity;
    for (const id of memberIds) {
      const r = merged[id].find((x) => x.start <= s && x.end >= s + min);
      if (r) {
        free.push(id);
        end = Math.min(end, r.end);
      }
    }
    if (free.length === 0) continue;
    const better =
      !best ||
      free.length > best.free.length ||
      (free.length === best.free.length && end - s > best.end - best.start);
    if (better) best = { start: s, end, free };
  }
  if (!best) return null;

  const freeSet = new Set(best.free);
  return {
    date: day.date,
    start: best.start,
    end: best.end,
    minutes: best.end - best.start,
    freeUserIds: memberIds.filter((id) => freeSet.has(id)),
    busyUserIds: memberIds.filter((id) => !freeSet.has(id)),
    everyone: best.free.length === memberIds.length,
  };
}

/** Blocks of at least `minMinutes` during which every member is free. */
export function everyoneWindowsForDay(day: GroupDay, memberIds: string[], minMinutes: number): MinuteRange[] {
  if (memberIds.length === 0) return [];
  const lists = memberIds.map((id) => mergeRanges(day.freeByUser[id] ?? []));
  return intersectRanges(lists).filter((r) => r.end - r.start >= minMinutes);
}

function compareWindows(a: PeakWindow, b: PeakWindow): number {
  return (
    b.freeUserIds.length - a.freeUserIds.length ||
    b.minutes - a.minutes ||
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    a.start - b.start
  );
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function analyzeGroup(days: GroupDay[], memberIds: string[], opts: { minMinutes: number }): GroupInsights {
  const minMinutes = Math.max(1, opts.minMinutes);
  const n = memberIds.length;

  const perDay: DayHeat[] = [];
  const peaks: PeakWindow[] = [];
  const bestEveryonePerDay: PeakWindow[] = [];
  let totalEveryoneMinutes = 0;
  let daysWithEveryone = 0;

  for (const day of days) {
    const peak = peakWindowForDay(day, memberIds, minMinutes);
    const everyone = everyoneWindowsForDay(day, memberIds, minMinutes);
    const everyoneMinutes = everyone.reduce((s, r) => s + (r.end - r.start), 0);

    perDay.push({
      date: day.date,
      peakCount: peak?.freeUserIds.length ?? 0,
      peakMinutes: peak?.minutes ?? 0,
      everyoneMinutes,
    });
    if (peak) peaks.push(peak);

    if (n > 0 && everyone.length > 0) {
      daysWithEveryone += 1;
      totalEveryoneMinutes += everyoneMinutes;
      const longest = everyone.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
      bestEveryonePerDay.push({
        date: day.date,
        start: longest.start,
        end: longest.end,
        minutes: longest.end - longest.start,
        freeUserIds: [...memberIds],
        busyUserIds: [],
        everyone: true,
      });
    }
  }

  // "Best" only means something when at least two people actually coincide.
  const meaningfulMin = Math.min(2, n);
  const rankable = peaks.filter((p) => p.freeUserIds.length >= meaningfulMin).sort(compareWindows);
  const bestOverall = rankable[0] ?? null;
  const runnerUps = rankable.slice(1, 6);

  const bestEveryone =
    n >= 2 && bestEveryonePerDay.length > 0
      ? [...bestEveryonePerDay].sort((a, b) => b.minutes - a.minutes || (a.date < b.date ? -1 : 1))[0]
      : null;
  const nextEveryone =
    n >= 2 && bestEveryonePerDay.length > 0
      ? [...bestEveryonePerDay].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0]
      : null;

  // Weekday pattern -- needs at least two weeks of data to be more than noise.
  let weekdays: WeekdayStat[] = [];
  let bestWeekday: WeekdayStat | null = null;
  if (days.length >= 14 && n >= 2) {
    weekdays = Array.from({ length: 7 }, (_, dow) => {
      const rows = perDay.filter((d) => dayOfWeek(d.date) === dow);
      return {
        dayOfWeek: dow,
        days: rows.length,
        avgPeakCount: avg(rows.map((r) => r.peakCount)),
        avgEveryoneMinutes: avg(rows.map((r) => r.everyoneMinutes)),
      };
    }).filter((w) => w.days > 0);
    const ranked = [...weekdays].sort(
      (a, b) => b.avgPeakCount - a.avgPeakCount || b.avgEveryoneMinutes - a.avgEveryoneMinutes || a.dayOfWeek - b.dayOfWeek,
    );
    bestWeekday = ranked[0] && ranked[0].avgPeakCount > 0 ? ranked[0] : null;
  }

  // Time-of-day pattern: re-run the peak search with everyone's free time clipped to each daypart.
  let dayparts: DaypartStat[] = [];
  let bestDaypart: DaypartStat | null = null;
  if (n >= 2 && days.length > 0) {
    dayparts = DAYPARTS.map((dp) => {
      const counts: number[] = [];
      let withEveryone = 0;
      for (const day of days) {
        const clipped: GroupDay = {
          date: day.date,
          freeByUser: Object.fromEntries(
            memberIds.map((id) => [id, clipRanges(mergeRanges(day.freeByUser[id] ?? []), dp.range)]),
          ),
        };
        const peak = peakWindowForDay(clipped, memberIds, minMinutes);
        counts.push(peak?.freeUserIds.length ?? 0);
        if (peak?.everyone) withEveryone += 1;
      }
      return { name: dp.name, label: dp.label, avgPeakCount: avg(counts), daysWithEveryone: withEveryone };
    });
    const ranked = [...dayparts].sort((a, b) => b.avgPeakCount - a.avgPeakCount || b.daysWithEveryone - a.daysWithEveryone);
    bestDaypart = ranked[0] && ranked[0].avgPeakCount > 0 ? ranked[0] : null;
  }

  return {
    memberCount: n,
    minMinutes,
    daysAnalysed: days.length,
    bestOverall,
    bestEveryone,
    nextEveryone,
    runnerUps,
    daysWithEveryone,
    totalEveryoneMinutes,
    perDay,
    weekdays,
    bestWeekday,
    dayparts,
    bestDaypart,
  };
}
