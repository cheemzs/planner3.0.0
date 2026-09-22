import type { ISODate } from './types';
import { addDays, daysBetween, formatDate, parseDate } from './time-utils';

/**
 * The span of time a group is planning for. Chosen by the group's
 * organiser. Pure functions only -- no I/O, no "current time" reads: the
 * caller passes `today` in (already resolved to the group's timezone).
 */
export type PeriodKind = 'week' | 'two_weeks' | 'month' | 'two_months' | 'quarter' | 'half_year' | 'year' | 'custom';

export const PERIOD_KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: '1 week' },
  { kind: 'two_weeks', label: '2 weeks' },
  { kind: 'month', label: '1 month' },
  { kind: 'two_months', label: '2 months' },
  { kind: 'quarter', label: '3 months' },
  { kind: 'half_year', label: '6 months' },
  { kind: 'year', label: '1 year' },
  { kind: 'custom', label: 'Custom dates' },
];

/** Hard ceiling on any range we'll ever compute over (matches the DB constraint on custom periods). */
export const MAX_RANGE_DAYS = 400;

export function isPeriodKind(v: string): v is PeriodKind {
  return PERIOD_KINDS.some((p) => p.kind === v);
}

export function periodKindLabel(kind: PeriodKind): string {
  return PERIOD_KINDS.find((p) => p.kind === kind)?.label ?? kind;
}

const MONTHS_FOR: Partial<Record<PeriodKind, number>> = {
  month: 1,
  two_months: 2,
  quarter: 3,
  half_year: 6,
  year: 12,
};

/**
 * Adds calendar months, clamping to the last day of the target month
 * (Jan 31 + 1 month = Feb 28/29, never "Mar 3").
 */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = parseDate(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatDate(target);
}

export interface PeriodSettings {
  kind: PeriodKind;
  /** null = rolling: the window always starts today. */
  start: ISODate | null;
  /** Only meaningful for kind === 'custom'. */
  end: ISODate | null;
}

export interface ResolvedPeriod {
  /** First day of the period as configured (may be in the past for a fixed period). */
  start: ISODate;
  /** Last day of the period, inclusive. */
  end: ISODate;
  /** First day still worth planning: max(start, today). Days before this are history. */
  planFrom: ISODate;
  /** Whole period is already in the past. */
  ended: boolean;
  /** Period hasn't begun yet. */
  upcoming: boolean;
  rolling: boolean;
  /** Inclusive day count of start..end. */
  totalDays: number;
  /** Inclusive day count of planFrom..end (0 if ended). */
  remainingDays: number;
}

export function resolvePeriod(settings: PeriodSettings, today: ISODate): ResolvedPeriod {
  const rolling = settings.kind !== 'custom' && settings.start == null;
  const start = settings.start ?? today;

  let end: ISODate;
  if (settings.kind === 'custom') {
    end = settings.end ?? addDays(start, 29);
    if (end < start) end = start;
  } else if (settings.kind === 'week') {
    end = addDays(start, 6);
  } else if (settings.kind === 'two_weeks') {
    end = addDays(start, 13);
  } else {
    end = addDays(addMonths(start, MONTHS_FOR[settings.kind] ?? 1), -1);
  }

  // Belt and braces: even if bad data got in, never let a caller enumerate an unbounded range.
  const maxEnd = addDays(start, MAX_RANGE_DAYS - 1);
  if (end > maxEnd) end = maxEnd;

  const ended = end < today;
  const upcoming = start > today;
  const planFrom = ended ? end : start > today ? start : today;

  return {
    start,
    end,
    planFrom,
    ended,
    upcoming,
    rolling,
    totalDays: daysBetween(start, end) + 1,
    remainingDays: ended ? 0 : daysBetween(planFrom, end) + 1,
  };
}

/** Clamps an arbitrary user-supplied range so it can never exceed MAX_RANGE_DAYS or be inverted. */
export function clampRange(from: ISODate, to: ISODate): { from: ISODate; to: ISODate; clamped: boolean } {
  let end = to < from ? from : to;
  const maxEnd = addDays(from, MAX_RANGE_DAYS - 1);
  const clamped = end > maxEnd;
  if (clamped) end = maxEnd;
  return { from, to: end, clamped };
}

export { nowInTimezone } from './time-utils';

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
