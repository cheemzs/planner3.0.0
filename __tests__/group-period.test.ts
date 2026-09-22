import { describe, it, expect } from 'vitest';
import {
  addMonths,
  clampRange,
  isPeriodKind,
  isValidTimezone,
  MAX_RANGE_DAYS,
  nowInTimezone,
  resolvePeriod,
} from '../src/lib/engine/group-period.js';

describe('addMonths', () => {
  it('adds calendar months and clamps to the end of shorter months', () => {
    expect(addMonths('2026-10-01', 1)).toBe('2026-11-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-30');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
  });
});

describe('resolvePeriod (fixed start)', () => {
  const p = (kind: Parameters<typeof resolvePeriod>[0]['kind'], start: string, today = '2026-09-20') =>
    resolvePeriod({ kind, start, end: null }, today);

  it('week / two weeks are 7 / 14 days inclusive', () => {
    expect(p('week', '2026-10-01').end).toBe('2026-10-07');
    expect(p('week', '2026-10-01').totalDays).toBe(7);
    expect(p('two_weeks', '2026-10-01').end).toBe('2026-10-14');
  });

  it('month-based kinds end the day before the same date N months later', () => {
    expect(p('month', '2026-10-01').end).toBe('2026-10-31');
    expect(p('two_months', '2026-10-01').end).toBe('2026-11-30');
    expect(p('quarter', '2026-10-01').end).toBe('2026-12-31');
    expect(p('half_year', '2026-01-01').end).toBe('2026-06-30');
    expect(p('year', '2026-01-01').end).toBe('2026-12-31');
    expect(p('year', '2026-01-01').totalDays).toBe(365);
    expect(p('month', '2026-01-31').end).toBe('2026-02-27');
  });

  it('a future period is "upcoming" and planning starts at its first day', () => {
    const r = p('month', '2026-10-01');
    expect(r.upcoming).toBe(true);
    expect(r.ended).toBe(false);
    expect(r.planFrom).toBe('2026-10-01');
    expect(r.remainingDays).toBe(31);
  });

  it('a period already under way only plans from today onward', () => {
    const r = p('month', '2026-09-01', '2026-09-20');
    expect(r.planFrom).toBe('2026-09-20');
    expect(r.remainingDays).toBe(11); // 20..30 inclusive
    expect(r.totalDays).toBe(30);
    expect(r.upcoming).toBe(false);
  });

  it('a finished period is flagged ended with nothing left to plan', () => {
    const r = p('week', '2026-08-01', '2026-09-20');
    expect(r.ended).toBe(true);
    expect(r.remainingDays).toBe(0);
  });

  it('the last day of the period still counts as "not ended"', () => {
    expect(p('week', '2026-09-14', '2026-09-20').ended).toBe(false);
    expect(p('week', '2026-09-14', '2026-09-21').ended).toBe(true);
  });
});

describe('resolvePeriod (rolling + custom)', () => {
  it('rolling (no start) always begins today', () => {
    const r = resolvePeriod({ kind: 'two_months', start: null, end: null }, '2026-09-20');
    expect(r.rolling).toBe(true);
    expect(r.start).toBe('2026-09-20');
    expect(r.end).toBe('2026-11-19');
    expect(r.planFrom).toBe('2026-09-20');
    expect(r.ended).toBe(false);
  });

  it('custom uses its own end date', () => {
    const r = resolvePeriod({ kind: 'custom', start: '2026-10-01', end: '2026-10-10' }, '2026-09-20');
    expect(r.rolling).toBe(false);
    expect(r.end).toBe('2026-10-10');
    expect(r.totalDays).toBe(10);
  });

  it('custom is never treated as rolling, and is capped at MAX_RANGE_DAYS even with bad data', () => {
    const r = resolvePeriod({ kind: 'custom', start: '2026-01-01', end: '2030-01-01' }, '2026-01-01');
    expect(r.totalDays).toBe(MAX_RANGE_DAYS);
  });

  it('custom with an inverted range collapses to a single day instead of going negative', () => {
    const r = resolvePeriod({ kind: 'custom', start: '2026-10-05', end: '2026-10-01' }, '2026-09-20');
    expect(r.totalDays).toBe(1);
  });
});

describe('clampRange', () => {
  it('caps absurd user-supplied ranges and fixes inverted ones', () => {
    const huge = clampRange('2000-01-01', '9999-12-31');
    expect(huge.clamped).toBe(true);
    expect(huge.to).toBe('2001-02-03'); // 400 days inclusive
    expect(clampRange('2026-10-05', '2026-10-01')).toEqual({ from: '2026-10-05', to: '2026-10-05', clamped: false });
    expect(clampRange('2026-10-01', '2026-10-31').clamped).toBe(false);
  });
});

describe('timezones', () => {
  const instant = new Date('2026-09-20T16:30:00Z');
  it('resolves date + minutes in the requested zone, including across midnight', () => {
    expect(nowInTimezone('UTC', instant)).toEqual({ date: '2026-09-20', minutes: 16 * 60 + 30 });
    expect(nowInTimezone('Asia/Singapore', instant)).toEqual({ date: '2026-09-21', minutes: 30 }); // 00:30, not "24:30"
    expect(nowInTimezone('America/Los_Angeles', instant)).toEqual({ date: '2026-09-20', minutes: 9 * 60 + 30 });
  });
  it('falls back to UTC for an unknown zone rather than crashing', () => {
    expect(nowInTimezone('Mars/Olympus', instant)).toEqual({ date: '2026-09-20', minutes: 16 * 60 + 30 });
  });
  it('validates zone names', () => {
    expect(isValidTimezone('Asia/Singapore')).toBe(true);
    expect(isValidTimezone('Nope/Nothing')).toBe(false);
  });
});

describe('isPeriodKind', () => {
  it('accepts known kinds only', () => {
    expect(isPeriodKind('two_months')).toBe(true);
    expect(isPeriodKind('decade')).toBe(false);
  });
});
