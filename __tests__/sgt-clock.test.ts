import { describe, it, expect } from 'vitest';
import { APP_TIMEZONE, nowParts, todayIso } from '../src/lib/engine/time-utils.js';
import { tzOptionLabel, tzShortLabel } from '../src/lib/format.js';

// These must hold no matter what timezone the machine running the tests (or the server) is in.
describe('the app clock is Singapore Time', () => {
  it('is Asia/Singapore', () => expect(APP_TIMEZONE).toBe('Asia/Singapore'));

  it('reads an instant as SGT wall-clock, crossing midnight correctly', () => {
    // 16:30 UTC on the 20th is 00:30 SGT on the 21st
    expect(nowParts(new Date('2026-09-20T16:30:00Z'))).toEqual({ date: '2026-09-21', time: '00:30' });
    expect(todayIso(new Date('2026-09-20T16:30:00Z'))).toBe('2026-09-21');
    // 15:59 UTC is still the 20th at 23:59 SGT
    expect(nowParts(new Date('2026-09-20T15:59:00Z'))).toEqual({ date: '2026-09-20', time: '23:59' });
  });

  it('treats an explicit +08:00 instant as the same wall-clock time', () => {
    expect(nowParts(new Date('2026-06-08T08:00:00+08:00'))).toEqual({ date: '2026-06-08', time: '08:00' });
  });

  it('handles year boundaries and midnight ("00:00", never "24:00")', () => {
    expect(nowParts(new Date('2026-12-31T16:00:00Z'))).toEqual({ date: '2027-01-01', time: '00:00' });
  });

  it('labels Singapore as SGT', () => {
    expect(tzShortLabel('Asia/Singapore')).toBe('SGT');
    expect(tzOptionLabel('Asia/Singapore')).toBe('Singapore (SGT)');
    expect(tzOptionLabel('America/New_York')).toBe('America/New York');
  });
});
