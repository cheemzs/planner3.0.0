import { describe, it, expect } from 'vitest';
import { getNextAction } from '../src/lib/engine/next-action.js';
import { makeTask, makeEvent, simpleAvailability } from './helpers.js';
import type { ScoringContext } from '../src/lib/engine/scoring.js';
import type { ScheduleBlock } from '../src/lib/engine/types.js';

function ctx(now: Date): ScoringContext {
  return { now, avgDailyAvailableMinutes: 480, completedTaskIds: new Set() };
}

describe('next action engine', () => {
  it('reports being in a fixed event when the current time overlaps one', () => {
    const now = new Date('2026-06-08T10:30:00+08:00');
    const event = makeEvent({ title: 'School', date: '2026-06-08', start: '09:00', end: '15:00' });
    const result = getNextAction(now, [], [event], [], simpleAvailability(), ctx(now));
    expect(result.kind).toBe('in_fixed_event');
    expect(result.message).toMatch(/School/);
    expect(result.until).toBe('15:00');
  });

  it('reports the scheduled task when the current time overlaps a task block', () => {
    const now = new Date('2026-06-08T16:10:00+08:00');
    const task = makeTask({ title: 'Maths revision' });
    const block: ScheduleBlock = {
      id: 'b1',
      date: '2026-06-08',
      start: '16:00',
      end: '17:00',
      type: 'task',
      refId: task.id,
      title: task.title,
      locked: false,
      source: 'auto',
      createdAt: '2026-06-08T08:00',
      updatedAt: '2026-06-08T08:00',
    };
    const result = getNextAction(now, [task], [], [block], simpleAvailability(), ctx(now));
    expect(result.kind).toBe('in_scheduled_task');
    expect(result.taskId).toBe(task.id);
  });

  it('suggests the highest-priority task that fits in the remaining free window', () => {
    const now = new Date('2026-06-08T16:00:00+08:00');
    const urgent = makeTask({ title: 'Due tomorrow', deadline: '2026-06-09T18:00', estimatedMinutes: 60 });
    const distant = makeTask({ title: 'Someday', estimatedMinutes: 60 });
    const result = getNextAction(now, [urgent, distant], [], [], simpleAvailability(), ctx(now));
    expect(result.kind).toBe('suggest_task');
    expect(result.taskId).toBe(urgent.id);
  });

  it('does not suggest a 2-hour task when only 20 minutes are available', () => {
    const now = new Date('2026-06-08T17:40:00+08:00'); // 20 min before 18:00 end of window
    const longTask = makeTask({ title: 'Long essay', estimatedMinutes: 120, minChunkMinutes: 45 });
    const result = getNextAction(now, [longTask], [], [], simpleAvailability(), ctx(now));
    expect(result.kind).not.toBe('suggest_task');
  });

  it('suggests a break when nothing pending exists', () => {
    const now = new Date('2026-06-08T10:00:00+08:00');
    const result = getNextAction(now, [], [], [], simpleAvailability(), ctx(now));
    expect(result.kind).toBe('suggest_break');
  });
});
