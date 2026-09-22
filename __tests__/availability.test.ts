import { describe, it, expect } from 'vitest';
import { computeFreeWindows, totalFreeMinutes } from '../src/lib/engine/availability.js';
import { simpleAvailability, makeEvent } from './helpers.js';

describe('availability engine', () => {
  it('returns full work window when nothing else is scheduled', () => {
    const windows = computeFreeWindows(simpleAvailability(), '2026-06-08', [], []);
    // 09:00-12:00 and 13:00-18:00 (lunch break subtracted)
    expect(windows).toEqual([
      { start: 9 * 60, end: 12 * 60 },
      { start: 13 * 60, end: 18 * 60 },
    ]);
  });

  it('subtracts a fixed event from the work window', () => {
    const event = makeEvent({ title: 'Dentist', date: '2026-06-08', start: '10:00', end: '11:00', fixed: true });
    const windows = computeFreeWindows(simpleAvailability(), '2026-06-08', [event], []);
    expect(windows).toEqual([
      { start: 9 * 60, end: 10 * 60 },
      { start: 11 * 60, end: 12 * 60 },
      { start: 13 * 60, end: 18 * 60 },
    ]);
  });

  it('handles multiple overlapping fixed events without double-subtracting weirdly', () => {
    const e1 = makeEvent({ title: 'A', date: '2026-06-08', start: '10:00', end: '11:30' });
    const e2 = makeEvent({ title: 'B', date: '2026-06-08', start: '11:00', end: '12:30' });
    const windows = computeFreeWindows(simpleAvailability(), '2026-06-08', [e1, e2], []);
    expect(windows).toEqual([
      { start: 9 * 60, end: 10 * 60 },
      { start: 13 * 60, end: 18 * 60 },
    ]);
  });

  it('returns no availability on an unavailable override day', () => {
    const config = simpleAvailability();
    config.overrides = [{ date: '2026-06-08', unavailable: true }];
    const windows = computeFreeWindows(config, '2026-06-08', [], []);
    expect(windows).toEqual([]);
  });

  it('masks out the past when notBeforeMinutes is given ("plan the rest of today")', () => {
    const windows = computeFreeWindows(simpleAvailability(), '2026-06-08', [], [], {
      notBeforeMinutes: 14 * 60 + 30,
    });
    expect(windows).toEqual([{ start: 14 * 60 + 30, end: 18 * 60 }]);
  });

  it('applies weekend-specific availability templates', () => {
    const config = simpleAvailability();
    config.perWeekday = [
      { dayOfWeek: 6, wake: '09:00', sleep: '23:00', workWindows: [{ start: '10:00', end: '20:00' }], breaks: [] },
    ];
    // 2026-06-06 is a Saturday
    const saturday = totalFreeMinutes(config, '2026-06-06', [], []);
    const weekday = totalFreeMinutes(config, '2026-06-08', [], []);
    expect(saturday).toBe(10 * 60);
    expect(weekday).toBe(8 * 60); // 9-12 + 13-18 = 3h + 5h
  });

  it('recurring events subtract on every matching weekday', () => {
    const recurringGym = makeEvent({
      title: 'Gym',
      date: '2026-06-01',
      start: '17:00',
      end: '18:00',
      recurrence: { daysOfWeek: [1, 3, 5] }, // Mon/Wed/Fri
    });
    const monday = computeFreeWindows(simpleAvailability(), '2026-06-08', [recurringGym], []);
    const tuesday = computeFreeWindows(simpleAvailability(), '2026-06-09', [recurringGym], []);
    expect(monday.some((w) => w.end === 17 * 60)).toBe(true);
    expect(tuesday).toEqual([
      { start: 9 * 60, end: 12 * 60 },
      { start: 13 * 60, end: 18 * 60 },
    ]);
  });
});
