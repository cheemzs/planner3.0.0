import { describe, it, expect } from 'vitest';
import { findFreeTimeFit } from '../src/lib/engine/free-time.js';
import { planTaskSplit } from '../src/lib/engine/task-split.js';
import { makeTask } from './helpers.js';
import type { ScoringContext } from '../src/lib/engine/scoring.js';

const NOW = new Date('2026-06-08T16:00:00+08:00');
const ctx: ScoringContext = { now: NOW, avgDailyAvailableMinutes: 480, completedTaskIds: new Set() };

describe('free time fitting', () => {
  it('prefers a task that would be fully completed over a partial chunk of a higher-scoring task', () => {
    const quickWin = makeTask({ title: 'Quick email', estimatedMinutes: 15, priority: 'low' });
    const bigUrgent = makeTask({
      title: 'Big urgent project',
      estimatedMinutes: 300,
      priority: 'critical',
      deadline: '2026-06-09T18:00',
    });
    const result = findFreeTimeFit(20, [quickWin, bigUrgent], ctx);
    expect(result.best?.taskId).toBe(quickWin.id);
    expect(result.best?.wouldComplete).toBe(true);
  });

  it('excludes tasks whose minimum chunk does not fit the window', () => {
    const tooLong = makeTask({ title: 'Needs 60 min minimum', estimatedMinutes: 90, minChunkMinutes: 60 });
    const result = findFreeTimeFit(30, [tooLong], ctx);
    expect(result.best).toBeUndefined();
    expect(result.note).toBeDefined();
  });

  it('reports no suggestion when there are no pending tasks', () => {
    const result = findFreeTimeFit(45, [], ctx);
    expect(result.best).toBeUndefined();
    expect(result.note).toMatch(/no pending/i);
  });

  it('returns alternatives beyond the best pick', () => {
    const a = makeTask({ title: 'A', estimatedMinutes: 20, priority: 'high' });
    const b = makeTask({ title: 'B', estimatedMinutes: 20, priority: 'medium' });
    const c = makeTask({ title: 'C', estimatedMinutes: 20, priority: 'low' });
    const result = findFreeTimeFit(30, [a, b, c], ctx);
    expect(result.best).toBeDefined();
    expect(result.alternatives.length).toBeGreaterThan(0);
  });
});

describe('task splitting', () => {
  it('splits a task into caller-specified phases that sum to the original remaining minutes', () => {
    const task = makeTask({ title: 'Physics project', estimatedMinutes: 300, remainingMinutes: 300 });
    const phases = planTaskSplit(task, [
      { title: 'Research', minutes: 60 },
      { title: 'Outline', minutes: 30 },
      { title: 'Calculations', minutes: 90 },
      { title: 'Write-up', minutes: 90 },
      { title: 'Review', minutes: 30 },
    ]);
    expect(phases.length).toBe(5);
    expect(phases.reduce((s, p) => s + (p.remainingMinutes ?? 0), 0)).toBe(300);
  });

  it('chains phases with dependsOn placeholders so review cannot run before earlier phases', () => {
    const task = makeTask({ title: 'Essay', estimatedMinutes: 120, remainingMinutes: 120 });
    const phases = planTaskSplit(task, [
      { title: 'Draft', minutes: 60 },
      { title: 'Review', minutes: 60 },
    ]);
    expect(phases[0].dependsOn).toEqual([]);
    expect(phases[1].dependsOn?.[0]).toMatch(/__prev__/);
  });

  it('falls back to a generic even split when no phases are given', () => {
    const task = makeTask({ title: 'Big generic task', estimatedMinutes: 250, remainingMinutes: 250 });
    const phases = planTaskSplit(task, undefined, 100);
    expect(phases.length).toBe(3); // ceil(250/100)
    expect(phases.reduce((s, p) => s + (p.remainingMinutes ?? 0), 0)).toBe(250);
  });

  it('rescales caller-given phase proportions if they do not sum to the actual remaining minutes', () => {
    const task = makeTask({ title: 'Adjusted task', estimatedMinutes: 100, remainingMinutes: 100 });
    const phases = planTaskSplit(task, [
      { title: 'Part A', minutes: 30 },
      { title: 'Part B', minutes: 30 },
    ]); // sums to 60, not 100
    const total = phases.reduce((s, p) => s + (p.remainingMinutes ?? 0), 0);
    expect(total).toBe(100);
  });
});
