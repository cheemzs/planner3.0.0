import { describe, it, expect } from 'vitest';
import { allTimezones, canonicalTimezone } from '../src/lib/timezones.js';

describe('timezones', () => {
  it('maps legacy IANA names to the modern ones Postgres knows', () => {
    expect(canonicalTimezone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalTimezone('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(canonicalTimezone('Asia/Singapore')).toBe('Asia/Singapore'); // untouched
  });

  it('never offers a legacy name, lists Singapore (SGT) first, still offers UTC, and has no duplicates', () => {
    const zones = allTimezones();
    expect(zones[0]).toBe('Asia/Singapore');
    expect(zones).toContain('UTC');
    expect(new Set(zones).size).toBe(zones.length);
    for (const legacy of ['Asia/Calcutta', 'Asia/Katmandu', 'Europe/Kiev', 'Asia/Saigon', 'America/Buenos_Aires']) {
      expect(zones).not.toContain(legacy);
    }
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('Asia/Singapore');
  });
});
