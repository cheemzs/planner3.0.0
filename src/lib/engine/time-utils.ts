import type { ClockTime, ISODate, ISODateTime } from './types';

/** Parses "HH:mm" into minutes since midnight. Handles "24:00" as end-of-day. */
export function timeToMinutes(t: ClockTime): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) throw new Error(`Invalid time string: "${t}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || min < 0 || min > 59 || h < 0 || h > 24) {
    throw new Error(`Invalid time string: "${t}"`);
  }
  return h * 60 + min;
}

export function minutesToTime(mins: number): ClockTime {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(mins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isoDateTime(date: ISODate, time: ClockTime): ISODateTime {
  return `${date}T${time}`;
}

export function splitDateTime(dt: ISODateTime): { date: ISODate; time: ClockTime } {
  const [date, time] = dt.split('T');
  if (!date || !time) throw new Error(`Invalid ISODateTime: "${dt}"`);
  return { date, time };
}

/** Parses "YYYY-MM-DD" into a UTC-noon Date to avoid DST edge effects on day-math. */
export function parseDate(date: ISODate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date string: "${date}"`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
}

export function formatDate(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Inclusive day difference: daysBetween('2026-01-01','2026-01-03') === 2 */
export function daysBetween(from: ISODate, to: ISODate): number {
  const a = parseDate(from).getTime();
  const b = parseDate(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function dayOfWeek(date: ISODate): number {
  return parseDate(date).getUTCDay();
}

/** Monday-start week. Returns the ISO date of the Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  const dow = dayOfWeek(date); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(date, mondayOffset);
}

export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function startOfMonth(date: ISODate): ISODate {
  const [y, m] = date.split('-');
  return `${y}-${m}-01`;
}

export function daysInMonth(date: ISODate): number {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function compareDateTime(a: ISODateTime, b: ISODateTime): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The timezone the whole app runs in. All schedules, availability hours and
 * "today"/"now" are wall-clock times in Singapore Time (SGT, UTC+8, no DST).
 * We never read the server's own clock zone (it's UTC on Vercel), so results
 * are identical wherever the code runs.
 */
export const APP_TIMEZONE = 'Asia/Singapore';

/** Calendar date and minutes-since-midnight at instant `at`, as seen in `timeZone`. Unknown zones fall back to UTC. */
export function nowInTimezone(timeZone: string, at: Date = new Date()): { date: ISODate; minutes: number } {
  const make = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23', // "00" at midnight, never "24"
    });
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = make(timeZone);
  } catch {
    fmt = make('UTC');
  }
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Wall-clock date + time in SGT for the given instant (default: now). */
export function nowParts(now: Date, timeZone: string = APP_TIMEZONE): { date: ISODate; time: ClockTime } {
  const n = nowInTimezone(timeZone, now);
  return { date: n.date, time: minutesToTime(n.minutes) };
}

/** Today's date in SGT. */
export function todayIso(now: Date = new Date()): ISODate {
  return nowParts(now).date;
}

export function nowDateTime(now: Date = new Date()): ISODateTime {
  const { date, time } = nowParts(now);
  return isoDateTime(date, time);
}

export interface MinuteRange {
  start: number; // minutes since midnight
  end: number;
}

/** Subtracts a set of "busy" ranges from a set of "free" ranges. Assumes each input list is already sorted. */
export function subtractRanges(free: MinuteRange[], busy: MinuteRange[]): MinuteRange[] {
  if (busy.length === 0) return free.map((r) => ({ ...r }));
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start);
  const merged: MinuteRange[] = [];
  for (const b of sortedBusy) {
    if (b.end <= b.start) continue;
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ ...b });
    }
  }

  const result: MinuteRange[] = [];
  for (const f of free) {
    let cursor = f.start;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= f.end) continue;
      if (b.start > cursor) {
        result.push({ start: cursor, end: Math.min(b.start, f.end) });
      }
      cursor = Math.max(cursor, b.end);
      if (cursor >= f.end) break;
    }
    if (cursor < f.end) result.push({ start: cursor, end: f.end });
  }
  return result.filter((r) => r.end > r.start);
}

export function rangeMinutes(r: MinuteRange): number {
  return Math.max(0, r.end - r.start);
}

export function totalMinutes(ranges: MinuteRange[]): number {
  return ranges.reduce((sum, r) => sum + rangeMinutes(r), 0);
}

export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Intersects several lists of free-time ranges (one list per person) down
 * to the windows where *everyone* is free — used by the group availability
 * finder. An empty input list, or any single person having zero free
 * ranges that day, correctly yields no common time.
 */
export function intersectRanges(rangeLists: MinuteRange[][]): MinuteRange[] {
  if (rangeLists.length === 0) return [];
  let common = [...rangeLists[0]].map((r) => ({ ...r }));
  for (const ranges of rangeLists.slice(1)) {
    const next: MinuteRange[] = [];
    for (const a of common) {
      for (const b of ranges) {
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        if (start < end) next.push({ start, end });
      }
    }
    common = next;
    if (common.length === 0) break;
  }
  return common.sort((a, b) => a.start - b.start);
}
