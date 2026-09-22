import { describe, it, expect } from 'vitest';
import { intersectRanges } from '../src/lib/engine/time-utils.js';

describe('intersectRanges (group availability finder)', () => {
  it('returns empty for no input lists', () => {
    expect(intersectRanges([])).toEqual([]);
  });

  it('returns the single list unchanged when only one person is given', () => {
    const ranges = [{ start: 60, end: 120 }];
    expect(intersectRanges([ranges])).toEqual(ranges);
  });

  it('finds the overlap between two people with partially overlapping free time', () => {
    // Person A free 9:00-12:00 (540-720), Person B free 10:00-13:00 (600-780)
    const a = [{ start: 540, end: 720 }];
    const b = [{ start: 600, end: 780 }];
    expect(intersectRanges([a, b])).toEqual([{ start: 600, end: 720 }]);
  });

  it('returns nothing when two people have no overlapping free time', () => {
    const a = [{ start: 0, end: 60 }];
    const b = [{ start: 120, end: 180 }];
    expect(intersectRanges([a, b])).toEqual([]);
  });

  it('handles three people, only intersecting where all three are free', () => {
    const a = [{ start: 0, end: 100 }];
    const b = [{ start: 50, end: 150 }];
    const c = [{ start: 80, end: 200 }];
    expect(intersectRanges([a, b, c])).toEqual([{ start: 80, end: 100 }]);
  });

  it('one person with zero free windows that day yields no common time at all', () => {
    const a = [{ start: 0, end: 500 }];
    const b: { start: number; end: number }[] = [];
    expect(intersectRanges([a, b])).toEqual([]);
  });

  it('handles multiple disjoint free windows per person correctly', () => {
    // A free 9-11 and 14-16; B free 10-15
    const a = [
      { start: 540, end: 660 },
      { start: 840, end: 960 },
    ];
    const b = [{ start: 600, end: 900 }];
    expect(intersectRanges([a, b])).toEqual([
      { start: 600, end: 660 },
      { start: 840, end: 900 },
    ]);
  });
});
