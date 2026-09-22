import { describe, it, expect } from 'vitest';
import { generateWeekPlan } from '../src/lib/engine/week-planner.js';
import { makeTask, makeEvent, simpleAvailability } from './helpers.js';
import type { ScoringContext } from '../src/lib/engine/scoring.js';

const NOW = new Date('2026-06-08T07:00:00+08:00'); // Monday
function ctx(): ScoringContext {
  return { now: NOW, avgDailyAvailableMinutes: 480, completedTaskIds: new Set() };
}
const WEEK_START = '2026-06-08';

describe('week planner', () => {
  it('spreads a large task with a Friday deadline across multiple earlier days rather than cramming Thursday night', () => {
    const task = makeTask({
      title: 'Chemistry project',
      estimatedMinutes: 360, // 6 hours
      deadline: '2026-06-12T18:00', // Friday of this week
      priority: 'high',
      maxChunkMinutes: 120,
    });
    const result = generateWeekPlan(WEEK_START, [task], [], simpleAvailability(), [], ctx());
    const daysWithWork = result.days.filter((d) => d.blocks.some((b) => b.refId === task.id));
    expect(daysWithWork.length).toBeGreaterThan(1);
    // Confirm it's not all crammed into Thursday (index 3) alone.
    const thursday = result.days[3];
    const thursdayMinutes = thursday.blocks
      .filter((b) => b.refId === task.id)
      .reduce((s, b) => s + minutesOf(b), 0);
    expect(thursdayMinutes).toBeLessThan(360);
  });

  it('does not simply generate seven independent daily plans: a deadline-bound task never appears after its deadline day', () => {
    const task = makeTask({
      title: 'Due Wednesday',
      estimatedMinutes: 120,
      deadline: '2026-06-10T18:00', // Wednesday
    });
    const result = generateWeekPlan(WEEK_START, [task], [], simpleAvailability(), [], ctx());
    const afterDeadline = result.days.filter((d) => d.date > '2026-06-10');
    for (const day of afterDeadline) {
      expect(day.blocks.some((b) => b.refId === task.id)).toBe(false);
    }
  });

  it('avoids overloading a single day when work could be balanced across the week', () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ title: `Reading ${i}`, estimatedMinutes: 90, priority: 'medium' }),
    );
    const result = generateWeekPlan(WEEK_START, tasks, [], simpleAvailability(), [], ctx());
    const overloadedDays = result.workload.filter((w) => w.overloaded);
    expect(overloadedDays.length).toBe(0);
  });

  it('respects fixed events across the whole week', () => {
    const events = [
      makeEvent({ title: 'School', date: '2026-06-08', start: '09:00', end: '15:00' }),
      makeEvent({ title: 'School', date: '2026-06-09', start: '09:00', end: '15:00' }),
    ];
    const task = makeTask({ title: 'Homework', estimatedMinutes: 120 });
    const result = generateWeekPlan(WEEK_START, [task], events, simpleAvailability(), [], ctx());
    for (const day of result.days.slice(0, 2)) {
      for (const b of day.blocks.filter((x) => x.type === 'task')) {
        expect(overlaps(b.start, b.end, '09:00', '15:00')).toBe(false);
      }
    }
  });

  it('reports unmet deadlines when the week genuinely does not have enough capacity', () => {
    const impossible = makeTask({
      title: 'Way too much work',
      estimatedMinutes: 3000, // 50 hours in a single week
      deadline: '2026-06-10T18:00', // Wednesday — very little time
      priority: 'critical',
    });
    const result = generateWeekPlan(WEEK_START, [impossible], [], simpleAvailability(), [], ctx());
    expect(result.unmetDeadlines.length).toBeGreaterThan(0);
    expect(result.unmetDeadlines[0].taskId).toBe(impossible.id);
  });
});

function minutesOf(b: { start: string; end: string }): number {
  return timeMin(b.end) - timeMin(b.start);
}
function timeMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeMin(aStart) < timeMin(bEnd) && timeMin(bStart) < timeMin(aEnd);
}
