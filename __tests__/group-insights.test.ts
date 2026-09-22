import { describe, it, expect } from 'vitest';
import {
  analyzeGroup,
  everyoneWindowsForDay,
  mergeRanges,
  peakWindowForDay,
  type GroupDay,
} from '../src/lib/engine/group-insights.js';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const day = (date: string, free: Record<string, [number, number][]>): GroupDay => ({
  date,
  freeByUser: Object.fromEntries(Object.entries(free).map(([k, v]) => [k, v.map(([start, end]) => ({ start, end }))])),
});

describe('mergeRanges', () => {
  it('merges touching and overlapping ranges, drops empty ones, and sorts', () => {
    expect(
      mergeRanges([
        { start: 720, end: 900 },
        { start: 540, end: 720 },
        { start: 600, end: 650 },
        { start: 1000, end: 1000 },
      ]),
    ).toEqual([{ start: 540, end: 900 }]);
  });
  it('does not mutate its input', () => {
    const input = [{ start: 0, end: 10 }, { start: 5, end: 20 }];
    mergeRanges(input);
    expect(input).toEqual([{ start: 0, end: 10 }, { start: 5, end: 20 }]);
  });
});

describe('peakWindowForDay', () => {
  const ids = ['A', 'B', 'C'];

  it('finds the largest group free together, extended to the maximal shared block', () => {
    const d = day('2026-10-05', { A: [[h(9), h(12)]], B: [[h(10), h(13)]], C: [[h(14), h(16)]] });
    const w = peakWindowForDay(d, ids, 60)!;
    expect(w.freeUserIds).toEqual(['A', 'B']);
    expect(w.busyUserIds).toEqual(['C']);
    expect([w.start, w.end, w.minutes]).toEqual([h(10), h(12), 120]);
    expect(w.everyone).toBe(false);
  });

  it('does NOT count different people free in adjacent hours as one shared block', () => {
    // A is free 9-10, B is free 10-11: never at the same time. C is free 9-11.
    const d = day('2026-10-05', { A: [[h(9), h(10)]], B: [[h(10), h(11)]], C: [[h(9), h(11)]] });
    const w = peakWindowForDay(d, ids, 60)!;
    expect(w.freeUserIds).toHaveLength(2); // never 3
    expect(w.freeUserIds).toEqual(['A', 'C']); // tie on count and length -> earlier
    expect([w.start, w.end]).toEqual([h(9), h(10)]);
  });

  it('treats back-to-back free ranges of one person as one continuous block', () => {
    const d = day('2026-10-05', { A: [[h(9), h(12)], [h(12), h(15)]], B: [[h(11), h(14)]] });
    const w = peakWindowForDay(d, ['A', 'B'], 60)!;
    expect(w.everyone).toBe(true);
    expect([w.start, w.end]).toEqual([h(11), h(14)]);
  });

  it('prefers more people first, then the longer block, then the earlier one', () => {
    const moreFirst = day('d', { A: [[h(9), h(10)]], B: [[h(9), h(10)]], C: [[h(14), h(20)]] });
    expect(peakWindowForDay(moreFirst, ids, 60)!.freeUserIds).toEqual(['A', 'B']);

    const longerBlock = day('d', { A: [[h(9), h(10)], [h(14), h(17)]], B: [[h(9), h(10)], [h(14), h(17)]] });
    const w = peakWindowForDay(longerBlock, ['A', 'B'], 60)!;
    expect([w.start, w.end]).toEqual([h(14), h(17)]);
  });

  it('ignores free ranges shorter than the minimum block', () => {
    const d = day('d', { A: [[h(9), h(9, 30)]], B: [[h(9), h(9, 30)]] });
    expect(peakWindowForDay(d, ['A', 'B'], 60)).toBeNull();
    expect(peakWindowForDay(d, ['A', 'B'], 30)!.everyone).toBe(true);
  });

  it('treats a member with no entry as busy, and returns null when nobody is free', () => {
    const d = day('d', { A: [[h(9), h(11)]] });
    const w = peakWindowForDay(d, ['A', 'B'], 60)!;
    expect(w.freeUserIds).toEqual(['A']);
    expect(w.busyUserIds).toEqual(['B']);
    expect(peakWindowForDay(day('d', {}), ['A', 'B'], 60)).toBeNull();
  });
});

describe('everyoneWindowsForDay', () => {
  it('returns only blocks where all members overlap for at least the minimum length', () => {
    const d = day('d', { A: [[h(9), h(12)]], B: [[h(11), h(15)]] }); // overlap is 11:00-12:00 = 60 min
    expect(everyoneWindowsForDay(d, ['A', 'B'], 60)).toEqual([{ start: h(11), end: h(12) }]);
    expect(everyoneWindowsForDay(d, ['A', 'B'], 61)).toEqual([]);
  });
  it('merges a person\'s adjacent ranges before intersecting', () => {
    const d = day('d', { A: [[h(9), h(11)], [h(11), h(13)]], B: [[h(10), h(12)]] });
    expect(everyoneWindowsForDay(d, ['A', 'B'], 60)).toEqual([{ start: h(10), end: h(12) }]);
  });
  it('is empty for an empty group', () => {
    expect(everyoneWindowsForDay(day('d', {}), [], 60)).toEqual([]);
  });
});

describe('analyzeGroup', () => {
  const ids = ['A', 'B', 'C'];

  it('reports when everyone is free, the next such day, and ranks runner-ups', () => {
    const days = [
      day('2026-10-05', { A: [[h(9), h(12)]], B: [[h(9), h(12)]] }), // 2 of 3
      day('2026-10-06', { A: [[h(18), h(21)]], B: [[h(18), h(21)]], C: [[h(19), h(22)]] }), // everyone 19-21
      day('2026-10-07', { A: [[h(9), h(17)]], B: [[h(9), h(17)]] }), // 2 of 3, longer
      day('2026-10-08', {}),
    ];
    const r = analyzeGroup(days, ids, { minMinutes: 60 });

    expect(r.daysAnalysed).toBe(4);
    expect(r.daysWithEveryone).toBe(1);
    expect(r.totalEveryoneMinutes).toBe(120);
    expect(r.bestOverall!.date).toBe('2026-10-06');
    expect(r.bestOverall!.everyone).toBe(true);
    expect([r.bestOverall!.start, r.bestOverall!.end]).toEqual([h(19), h(21)]);
    expect(r.bestEveryone!.date).toBe('2026-10-06');
    expect(r.nextEveryone!.date).toBe('2026-10-06');
    expect(r.runnerUps.map((w) => w.date)).toEqual(['2026-10-07', '2026-10-05']); // longer 2-of-3 first
    expect(r.perDay.map((d) => d.peakCount)).toEqual([2, 3, 2, 0]);
  });

  it('has no "everyone" result when the group never fully overlaps, but still gives the best partial', () => {
    const days = [day('2026-10-05', { A: [[h(9), h(12)]], B: [[h(9), h(12)]], C: [[h(14), h(16)]] })];
    const r = analyzeGroup(days, ids, { minMinutes: 60 });
    expect(r.bestEveryone).toBeNull();
    expect(r.nextEveryone).toBeNull();
    expect(r.daysWithEveryone).toBe(0);
    expect(r.bestOverall!.freeUserIds).toEqual(['A', 'B']);
    expect(r.bestOverall!.busyUserIds).toEqual(['C']);
  });

  it('breaks exact ties by the earliest date', () => {
    const same = { A: [[h(9), h(11)]] as [number, number][], B: [[h(9), h(11)]] as [number, number][] };
    const r = analyzeGroup([day('2026-10-07', same), day('2026-10-05', same)], ['A', 'B'], { minMinutes: 60 });
    expect(r.bestOverall!.date).toBe('2026-10-05');
  });

  it('a single-person group never claims a "best time together"', () => {
    const r = analyzeGroup([day('2026-10-05', { A: [[h(9), h(12)]] })], ['A'], { minMinutes: 60 });
    expect(r.bestEveryone).toBeNull();
    expect(r.nextEveryone).toBeNull();
    expect(r.dayparts).toEqual([]);
  });

  it('an empty group is handled', () => {
    const r = analyzeGroup([day('2026-10-05', {})], [], { minMinutes: 60 });
    expect(r.memberCount).toBe(0);
    expect(r.bestOverall).toBeNull();
    expect(r.daysWithEveryone).toBe(0);
  });

  it('finds the best weekday once there are >= 14 days, and skips it for shorter periods', () => {
    // 2026-10-05 is a Monday. Everyone is free on Saturdays/Sundays only; weekdays only A is free.
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.UTC(2026, 9, 5 + i, 12));
        const iso = d.toISOString().slice(0, 10);
        const dow = d.getUTCDay();
        const weekend = dow === 0 || dow === 6;
        return day(iso, weekend ? { A: [[h(10), h(14)]], B: [[h(10), h(14)]] } : { A: [[h(10), h(14)]] });
      });

    const long = analyzeGroup(make(28), ['A', 'B'], { minMinutes: 60 });
    expect(long.weekdays).toHaveLength(7);
    expect([0, 6]).toContain(long.bestWeekday!.dayOfWeek);
    expect(long.bestWeekday!.avgPeakCount).toBe(2);
    const monday = long.weekdays.find((w) => w.dayOfWeek === 1)!;
    expect(monday.avgPeakCount).toBe(1);
    expect(monday.days).toBe(4);

    const short = analyzeGroup(make(10), ['A', 'B'], { minMinutes: 60 });
    expect(short.weekdays).toEqual([]);
    expect(short.bestWeekday).toBeNull();
  });

  it('finds the best time of day by clipping to mornings / afternoons / evenings', () => {
    const days = [
      day('2026-10-05', { A: [[h(6), h(22)]], B: [[h(18), h(21)]] }), // overlap only in the evening
      day('2026-10-06', { A: [[h(6), h(22)]], B: [[h(18), h(21)]] }),
    ];
    const r = analyzeGroup(days, ['A', 'B'], { minMinutes: 60 });
    expect(r.bestDaypart!.name).toBe('evening');
    expect(r.bestDaypart!.avgPeakCount).toBe(2);
    expect(r.bestDaypart!.daysWithEveryone).toBe(2);
    expect(r.dayparts.find((d) => d.name === 'morning')!.avgPeakCount).toBe(1);
  });

  it('a block that straddles a daypart boundary is judged only on the part inside each daypart', () => {
    // Everyone free 11:00-13:00: 60 min in the morning, 60 min in the afternoon; min block 90 => neither counts on its own.
    const days = [day('d', { A: [[h(11), h(13)]], B: [[h(11), h(13)]] })];
    const r = analyzeGroup(days, ['A', 'B'], { minMinutes: 90 });
    expect(r.bestOverall!.everyone).toBe(true); // overall 120 min block is fine
    expect(r.bestDaypart).toBeNull(); // but neither daypart has a 90-min slice
  });
});
