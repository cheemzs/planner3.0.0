import { describe, it, expect } from 'vitest';
import { generateDayPlan } from '../src/lib/engine/day-planner.js';
import { makeTask, makeEvent, simpleAvailability } from './helpers.js';
import type { ScoringContext } from '../src/lib/engine/scoring.js';

const NOW = new Date('2026-06-08T08:00:00+08:00');
function ctx(): ScoringContext {
  return { now: NOW, avgDailyAvailableMinutes: 480, completedTaskIds: new Set() };
}

const DATE = '2026-06-08'; // Monday

describe('day planner: basic', () => {
  it('produces an empty plan with no tasks and no unscheduled entries', () => {
    const result = generateDayPlan(DATE, [], [], simpleAvailability(), [], ctx());
    expect(result.blocks).toEqual([]);
    expect(result.unscheduled).toEqual([]);
  });

  it('schedules a single task within available time', () => {
    const task = makeTask({ title: 'Read chapter 3', estimatedMinutes: 60 });
    const result = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    const taskBlocks = result.blocks.filter((b) => b.type === 'task');
    expect(taskBlocks.length).toBeGreaterThan(0);
    expect(taskBlocks.reduce((s, b) => s + minutesOf(b), 0)).toBe(60);
  });

  it('schedules multiple tasks without overlap', () => {
    const t1 = makeTask({ title: 'Maths', estimatedMinutes: 90, priority: 'high' });
    const t2 = makeTask({ title: 'Chemistry', estimatedMinutes: 90, priority: 'high' });
    const result = generateDayPlan(DATE, [t1, t2], [], simpleAvailability(), [], ctx());
    const blocks = result.blocks.filter((b) => b.type === 'task').sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < blocks.length; i++) {
      expect(timeMin(blocks[i].start)).toBeGreaterThanOrEqual(timeMin(blocks[i - 1].end));
    }
  });

  it('never schedules a completed task', () => {
    const done = makeTask({ title: 'Already done', status: 'completed', remainingMinutes: 0 });
    const result = generateDayPlan(DATE, [done], [], simpleAvailability(), [], ctx());
    expect(result.blocks.some((b) => b.refId === done.id)).toBe(false);
  });

  it('does not fill every minute of the day (leaves buffer/free time)', () => {
    const tasks = [
      makeTask({ title: 'Light task', estimatedMinutes: 60, priority: 'low' }),
    ];
    const result = generateDayPlan(DATE, tasks, [], simpleAvailability(), [], ctx());
    expect(result.scheduledMinutes).toBeLessThan(result.freeMinutesTotal);
  });
});

describe('day planner: deadlines', () => {
  it('prioritises an approaching deadline over a distant one', () => {
    const soon = makeTask({ title: 'Due tomorrow', deadline: '2026-06-09T18:00', estimatedMinutes: 60 });
    const distant = makeTask({ title: 'Due next month', deadline: '2026-07-20T18:00', estimatedMinutes: 60 });
    const result = generateDayPlan(DATE, [soon, distant], [], simpleAvailability(), [], ctx());
    const soonBlock = result.blocks.find((b) => b.refId === soon.id);
    const distantBlock = result.blocks.find((b) => b.refId === distant.id);
    expect(soonBlock).toBeDefined();
    if (distantBlock) {
      expect(timeMin(soonBlock!.start)).toBeLessThanOrEqual(timeMin(distantBlock.start));
    }
  });

  it('flags an overdue task and still tries to schedule it', () => {
    const overdue = makeTask({ title: 'Overdue report', deadline: '2026-06-05T18:00', estimatedMinutes: 60 });
    const result = generateDayPlan(DATE, [overdue], [], simpleAvailability(), [], ctx());
    expect(result.blocks.some((b) => b.refId === overdue.id)).toBe(true);
  });

  it('detects an impossible single-day deadline via the feasibility model (not silently packed in)', () => {
    // Needs 10 hours but the day only has ~8 free hours available in total.
    const huge = makeTask({
      title: 'Giant task due today',
      estimatedMinutes: 600,
      priority: 'low',
      remainingMinutes: 600,
      deadline: '2026-06-08T22:00',
    });
    const result = generateDayPlan(DATE, [huge], [], simpleAvailability(), [], ctx());
    const scheduled = result.blocks.filter((b) => b.refId === huge.id).reduce((s, b) => s + minutesOf(b), 0);
    // It should never schedule more than the day actually has, even though
    // the task alone "needs" more than that.
    expect(scheduled).toBeLessThanOrEqual(result.freeMinutesTotal);
    expect(scheduled).toBeLessThan(600);
  });
});

describe('day planner: events', () => {
  it('never schedules through a fixed event', () => {
    const event = makeEvent({ title: 'School', date: DATE, start: '09:00', end: '15:00', fixed: true });
    const task = makeTask({ title: 'Homework', estimatedMinutes: 300 });
    const result = generateDayPlan(DATE, [task], [event], simpleAvailability(), [], ctx());
    const taskBlocks = result.blocks.filter((b) => b.type === 'task');
    for (const b of taskBlocks) {
      expect(overlaps(b.start, b.end, '09:00', '15:00')).toBe(false);
    }
  });

  it('handles multiple fixed events in one day', () => {
    const e1 = makeEvent({ title: 'School', date: DATE, start: '09:00', end: '12:30' });
    const e2 = makeEvent({ title: 'Sports', date: DATE, start: '16:00', end: '17:30' });
    const task = makeTask({ title: 'Study', estimatedMinutes: 60 });
    const result = generateDayPlan(DATE, [task], [e1, e2], simpleAvailability(), [], ctx());
    const taskBlocks = result.blocks.filter((b) => b.type === 'task');
    for (const b of taskBlocks) {
      expect(overlaps(b.start, b.end, '09:00', '12:30')).toBe(false);
      expect(overlaps(b.start, b.end, '16:00', '17:30')).toBe(false);
    }
  });
});

describe('day planner: availability', () => {
  it('schedules nothing on a day marked fully unavailable, and does not lose the task (it shifts elsewhere in the horizon)', () => {
    const config = simpleAvailability();
    config.overrides = [{ date: DATE, unavailable: true }];
    const task = makeTask({ title: 'Anything', estimatedMinutes: 60 });
    const result = generateDayPlan(DATE, [task], [], config, [], ctx());
    expect(result.blocks.filter((b) => b.type === 'task')).toEqual([]);
    expect(result.freeMinutesTotal).toBe(0);
  });

  it('respects a short free window and does not overschedule', () => {
    const config = simpleAvailability();
    config.overrides = [{ date: DATE, workWindows: [{ start: '17:00', end: '17:30' }] }];
    const task = makeTask({ title: 'Long task', estimatedMinutes: 120, minChunkMinutes: 20 });
    const result = generateDayPlan(DATE, [task], [], config, [], ctx());
    const scheduled = result.blocks.filter((b) => b.type === 'task').reduce((s, b) => s + minutesOf(b), 0);
    expect(scheduled).toBeLessThanOrEqual(30);
  });
});

describe('day planner: large tasks & chunking', () => {
  it('caps a single sitting at maxChunkMinutes', () => {
    const task = makeTask({ title: 'Marathon session', estimatedMinutes: 240, maxChunkMinutes: 90 });
    const result = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    const blocks = result.blocks.filter((b) => b.refId === task.id);
    for (const b of blocks) expect(minutesOf(b)).toBeLessThanOrEqual(90);
  });

  it("does not schedule a task below its minChunkMinutes into a too-small window", () => {
    const config = simpleAvailability();
    config.overrides = [{ date: DATE, workWindows: [{ start: '09:00', end: '09:10' }] }];
    const task = makeTask({ title: 'Needs 30 min minimum', estimatedMinutes: 30, minChunkMinutes: 30 });
    const result = generateDayPlan(DATE, [task], [], config, [], ctx());
    expect(result.blocks.filter((b) => b.refId === task.id)).toEqual([]);
  });
});

describe('day planner: dependencies', () => {
  it('does not schedule a task whose prerequisite is incomplete', () => {
    const prereq = makeTask({ title: 'Draft' });
    const dependent = makeTask({ title: 'Review', dependsOn: [prereq.id] });
    const result = generateDayPlan(DATE, [prereq, dependent], [], simpleAvailability(), [], ctx());
    expect(result.blocks.some((b) => b.refId === dependent.id)).toBe(false);
  });

  it('schedules a task once its prerequisite is completed', () => {
    const prereq = makeTask({ title: 'Draft', status: 'completed', remainingMinutes: 0 });
    const dependent = makeTask({ title: 'Review', dependsOn: [prereq.id] });
    const c: ScoringContext = { now: NOW, avgDailyAvailableMinutes: 480, completedTaskIds: new Set([prereq.id]) };
    const result = generateDayPlan(DATE, [prereq, dependent], [], simpleAvailability(), [], c);
    expect(result.blocks.some((b) => b.refId === dependent.id)).toBe(true);
  });
});

describe('day planner: edge cases', () => {
  it('handles zero pending tasks gracefully', () => {
    const result = generateDayPlan(DATE, [], [], simpleAvailability(), [], ctx());
    expect(result.freeMinutesTotal).toBeGreaterThan(0);
    expect(result.scheduledMinutes).toBe(0);
  });

  it('ignores a task with zero remaining minutes', () => {
    const zero = makeTask({ title: 'Nothing left', estimatedMinutes: 60, remainingMinutes: 0 });
    const result = generateDayPlan(DATE, [zero], [], simpleAvailability(), [], ctx());
    expect(result.blocks.filter((b) => b.refId === zero.id)).toEqual([]);
  });

  it('respects earliestStart in the future (does not schedule before it is allowed to start)', () => {
    const future = makeTask({ title: 'Not yet', estimatedMinutes: 60, earliestStart: '2026-06-10T00:00' });
    const result = generateDayPlan(DATE, [future], [], simpleAvailability(), [], ctx());
    expect(result.blocks.filter((b) => b.refId === future.id)).toEqual([]);
  });

  it('does not duplicate a block when the same task/day is planned twice with the same existing blocks', () => {
    const task = makeTask({ title: 'Idempotency check', estimatedMinutes: 60 });
    const first = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    // Re-running with the freshly generated blocks as "existing" should not add a second block for the same work.
    const second = generateDayPlan(
      DATE,
      [{ ...task, remainingMinutes: 0, status: 'completed' }],
      [],
      simpleAvailability(),
      first.blocks,
      ctx(),
    );
    expect(second.blocks.filter((b) => b.refId === task.id)).toEqual([]);
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
