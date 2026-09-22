import { describe, it, expect } from 'vitest';
import { planHorizon, type Allocation } from '../src/lib/engine/optimizer.js';
import { makeTask, makeEvent, simpleAvailability } from './helpers.js';

const HORIZON_START = '2026-06-08'; // Monday
const HORIZON_END = '2026-06-14'; // Sunday

function totalOf(allocation: Allocation, taskId: string): number {
  const perDate = allocation.get(taskId);
  if (!perDate) return 0;
  return [...perDate.values()].reduce((s, m) => s + m, 0);
}
function daysUsed(allocation: Allocation, taskId: string): string[] {
  const perDate = allocation.get(taskId);
  if (!perDate) return [];
  return [...perDate.entries()].filter(([, m]) => m > 0).map(([d]) => d).sort();
}

describe('horizon optimizer: construction', () => {
  it('never allocates more than a day can actually hold', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask({ title: `T${i}`, estimatedMinutes: 200 }));
    const events = [] as ReturnType<typeof makeEvent>[];
    const result = planHorizon(tasks, events, simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const dayTotals = new Map<string, number>();
    for (const perDate of result.allocation.values()) {
      for (const [date, minutes] of perDate) {
        dayTotals.set(date, (dayTotals.get(date) ?? 0) + minutes);
      }
    }
    for (const [, total] of dayTotals) {
      expect(total).toBeLessThanOrEqual(8 * 60); // simpleAvailability's max daily capacity
    }
  });

  it('spreads a large task with a Friday deadline across multiple earlier days', () => {
    const task = makeTask({
      title: 'Chemistry project',
      estimatedMinutes: 360,
      deadline: '2026-06-12T18:00', // Friday
      maxChunkMinutes: 120,
    });
    const result = planHorizon([task], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const days = daysUsed(result.allocation, task.id);
    expect(days.length).toBeGreaterThan(1);
    expect(days.every((d) => d <= '2026-06-12')).toBe(true);
    expect(totalOf(result.allocation, task.id)).toBe(360);
  });

  it('respects dependency sequencing: a dependent task never starts before its prerequisite finishes', () => {
    const research = makeTask({ title: 'Research', estimatedMinutes: 120 });
    const outline = makeTask({ title: 'Outline', estimatedMinutes: 60, dependsOn: [research.id] });
    const result = planHorizon([research, outline], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const researchDays = daysUsed(result.allocation, research.id);
    const outlineDays = daysUsed(result.allocation, outline.id);
    expect(researchDays.length).toBeGreaterThan(0);
    expect(outlineDays.length).toBeGreaterThan(0);
    expect(outlineDays[0] > researchDays.at(-1)!).toBe(true);
  });

  it('never allocates a task past its own deadline', () => {
    const task = makeTask({ title: 'Due Wednesday', estimatedMinutes: 300, deadline: '2026-06-10T18:00' });
    const result = planHorizon([task], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const days = daysUsed(result.allocation, task.id);
    expect(days.every((d) => d <= '2026-06-10')).toBe(true);
  });

  it('respects fixed events across the whole horizon', () => {
    const events = [
      makeEvent({ title: 'School', date: '2026-06-08', start: '09:00', end: '18:00' }),
      makeEvent({ title: 'School', date: '2026-06-09', start: '09:00', end: '18:00' }),
    ];
    const task = makeTask({ title: 'Homework', estimatedMinutes: 120 });
    const result = planHorizon([task], events, simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const days = daysUsed(result.allocation, task.id);
    expect(days).not.toContain('2026-06-08');
    expect(days).not.toContain('2026-06-09');
  });

  it('reports genuinely infeasible work honestly instead of silently packing it in', () => {
    const impossible = makeTask({
      title: 'Way too much work',
      estimatedMinutes: 3000,
      deadline: '2026-06-09T18:00',
    });
    const result = planHorizon([impossible], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const fm = result.feasibility.get(impossible.id)!;
    expect(fm.status).not.toBe('feasible');
    expect(totalOf(result.allocation, impossible.id)).toBeLessThan(3000);
  });
});

describe('horizon optimizer: objective / balance', () => {
  it('balances workload across days rather than dumping everything on the first available day', () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ title: `Reading ${i}`, estimatedMinutes: 90 }),
    );
    const result = planHorizon(tasks, [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const dayTotals = new Map<string, number>();
    for (const perDate of result.allocation.values()) {
      for (const [date, minutes] of perDate) dayTotals.set(date, (dayTotals.get(date) ?? 0) + minutes);
    }
    // 4 * 90 = 360 minutes total; if dumped onto one day that's 360 on a
    // single day vs. an 8h=480min cap. A balanced spread should use more
    // than one day.
    expect(dayTotals.size).toBeGreaterThan(1);
  });

  it('minimizes unnecessary churn when re-planning with a previous allocation and no new information', () => {
    const task = makeTask({ title: 'Stable task', estimatedMinutes: 120, deadline: '2026-06-12T18:00' });
    const first = planHorizon([task], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const second = planHorizon([task], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
      previousAllocation: first.allocation,
    });
    // Re-solving with the same inputs plus a change-minimization objective
    // against its own prior output should reproduce (at least) the same
    // total allocation, without spurious churn.
    expect(totalOf(second.allocation, task.id)).toBe(totalOf(first.allocation, task.id));
    expect(second.objective.change).toBe(0);
  });

  it('produces an explanation for every task that references the real constraint outcome', () => {
    const task = makeTask({ title: 'Explain me', estimatedMinutes: 90, deadline: '2026-06-10T18:00' });
    const result = planHorizon([task], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    const explanation = result.explanation.get(task.id);
    expect(explanation).toBeTruthy();
    expect(explanation).toContain('Explain me');
  });
});

describe('horizon optimizer: edge cases', () => {
  it('handles an empty task list', () => {
    const result = planHorizon([], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    expect(result.allocation.size).toBe(0);
  });

  it('ignores completed and cancelled tasks', () => {
    const done = makeTask({ title: 'Done', status: 'completed', remainingMinutes: 0 });
    const cancelled = makeTask({ title: 'Cancelled', status: 'cancelled', remainingMinutes: 30 });
    const result = planHorizon([done, cancelled], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    expect(result.allocation.has(done.id)).toBe(false);
    expect(result.allocation.has(cancelled.id)).toBe(false);
  });

  it('reports a dependency cycle as infeasible for every task involved, without throwing', () => {
    const a = makeTask({ title: 'A' });
    const b = makeTask({ title: 'B' });
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    expect(() =>
      planHorizon([a, b], [], simpleAvailability(), [], { horizonStart: HORIZON_START, horizonEnd: HORIZON_END }),
    ).not.toThrow();
    const result = planHorizon([a, b], [], simpleAvailability(), [], {
      horizonStart: HORIZON_START,
      horizonEnd: HORIZON_END,
    });
    expect(result.feasibility.get(a.id)!.status).toBe('infeasible');
    expect(result.feasibility.get(b.id)!.status).toBe('infeasible');
  });
});
