import { describe, it, expect } from 'vitest';
import {
  handleSkippedTask,
  applyInterruption,
  insertUnexpectedEvent,
  moveTask,
  replanDayWithNewTask,
} from '../src/lib/engine/reschedule.js';
import { generateDayPlan } from '../src/lib/engine/day-planner.js';
import { makeTask, makeEvent, simpleAvailability } from './helpers.js';
import type { ScoringContext } from '../src/lib/engine/scoring.js';

const NOW = new Date('2026-06-08T08:00:00+08:00');
function ctx(): ScoringContext {
  return { now: NOW, avgDailyAvailableMinutes: 480, completedTaskIds: new Set() };
}
const DATE = '2026-06-08';

describe('reschedule: skipped task', () => {
  it('clears unfinished auto blocks and refits the remaining work into the horizon', () => {
    const task = makeTask({ title: 'Chemistry', estimatedMinutes: 120, deadline: '2026-06-12T18:00' });
    const initial = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    expect(initial.blocks.some((b) => b.refId === task.id)).toBe(true);

    const { diff, blocks } = handleSkippedTask(
      task.id,
      DATE,
      [task],
      [],
      simpleAvailability(),
      initial.blocks,
      ctx(),
      ['2026-06-08', '2026-06-09', '2026-06-10'],
    );

    expect(diff.removed.some((b) => b.refId === task.id)).toBe(true);
    // The task's work should still appear somewhere in the re-planned horizon.
    expect(blocks.some((b) => b.refId === task.id)).toBe(true);
  });

  it('does not duplicate a locked/manual block when replanning', () => {
    const task = makeTask({ title: 'Chemistry', estimatedMinutes: 60 });
    const locked = {
      id: 'locked-1',
      date: DATE,
      start: '10:00',
      end: '10:30',
      type: 'task' as const,
      refId: task.id,
      title: task.title,
      locked: true,
      source: 'manual' as const,
      createdAt: '2026-06-08T08:00',
      updatedAt: '2026-06-08T08:00',
    };
    const { blocks } = handleSkippedTask(task.id, DATE, [task], [], simpleAvailability(), [locked], ctx(), [DATE]);
    const lockedBlocksRemaining = blocks.filter((b) => b.id === 'locked-1');
    expect(lockedBlocksRemaining.length).toBe(1);
  });
});

describe('reschedule: interruption', () => {
  it('reduces remaining minutes by time actually spent', () => {
    const task = makeTask({ title: 'Essay', estimatedMinutes: 90, remainingMinutes: 90 });
    const updated = applyInterruption(task, 30);
    expect(updated.remainingMinutes).toBe(60);
    expect(updated.status).toBe('in_progress');
  });

  it('marks the task completed when the full remaining time was spent', () => {
    const task = makeTask({ title: 'Essay', estimatedMinutes: 90, remainingMinutes: 30 });
    const updated = applyInterruption(task, 30);
    expect(updated.remainingMinutes).toBe(0);
    expect(updated.status).toBe('completed');
  });

  it('never goes negative when more time is logged than remained', () => {
    const task = makeTask({ title: 'Essay', estimatedMinutes: 90, remainingMinutes: 10 });
    const updated = applyInterruption(task, 45);
    expect(updated.remainingMinutes).toBe(0);
  });
});

describe('reschedule: unexpected event', () => {
  it('removes conflicting auto blocks and re-plans the day around the new fixed event', () => {
    const task = makeTask({ title: 'Maths', estimatedMinutes: 180 });
    const initial = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    const someTaskBlock = initial.blocks.find((b) => b.type === 'task');
    expect(someTaskBlock).toBeDefined();

    const unexpected = makeEvent({
      title: 'Dentist',
      date: DATE,
      start: someTaskBlock!.start,
      end: addMinutes(someTaskBlock!.start, 30),
      fixed: true,
    });

    const { diff, blocks, events } = insertUnexpectedEvent(unexpected, [task], [], simpleAvailability(), initial.blocks, ctx());

    expect(events.some((e) => e.id === unexpected.id)).toBe(true);
    const eventBlockOverlap = blocks.some(
      (b) => b.date === DATE && b.type === 'task' && overlaps(b.start, b.end, unexpected.start, unexpected.end),
    );
    expect(eventBlockOverlap).toBe(false);
    expect(diff.summary).toMatch(/Dentist/);
  });

  it('does not touch the schedule when the unexpected event has no conflicts', () => {
    const task = makeTask({ title: 'Reading', estimatedMinutes: 30 });
    const initial = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    const unexpected = makeEvent({ title: 'Late night call', date: DATE, start: '21:00', end: '21:30', fixed: true });
    const { diff } = insertUnexpectedEvent(unexpected, [task], [], simpleAvailability(), initial.blocks, ctx());
    expect(diff.removed.length).toBe(0);
  });
});

describe('reschedule: move task', () => {
  it('moves a task from one day to another', () => {
    const task = makeTask({ title: 'Physics', estimatedMinutes: 60 });
    const initial = generateDayPlan(DATE, [task], [], simpleAvailability(), [], ctx());
    expect(initial.blocks.some((b) => b.refId === task.id)).toBe(true);

    const { diff, blocks } = moveTask(task.id, DATE, '2026-06-09', [task], [], simpleAvailability(), initial.blocks, ctx());
    expect(diff.removed.some((b) => b.refId === task.id && b.date === DATE)).toBe(true);
    expect(blocks.some((b) => b.refId === task.id && b.date === '2026-06-09')).toBe(true);
    expect(blocks.some((b) => b.refId === task.id && b.date === DATE)).toBe(false);
  });
});

describe('reschedule: new urgent task', () => {
  it('re-plans the day to include a newly added urgent task', () => {
    const existing = makeTask({ title: 'Light reading', estimatedMinutes: 60, priority: 'low' });
    const initial = generateDayPlan(DATE, [existing], [], simpleAvailability(), [], ctx());

    const urgent = makeTask({
      title: 'Urgent assignment',
      estimatedMinutes: 60,
      priority: 'critical',
      deadline: '2026-06-08T20:00',
    });
    const { blocks } = replanDayWithNewTask(DATE, [existing, urgent], [], simpleAvailability(), initial.blocks, ctx());
    expect(blocks.some((b) => b.refId === urgent.id)).toBe(true);
  });
});

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function timeMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeMin(aStart) < timeMin(bEnd) && timeMin(bStart) < timeMin(aEnd);
}
