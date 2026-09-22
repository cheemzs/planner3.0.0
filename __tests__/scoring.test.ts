import { describe, it, expect } from 'vitest';
import { scoreTask, rankTasks } from '../src/lib/engine/scoring.js';
import { makeTask } from './helpers.js';

const NOW = new Date('2026-06-08T10:00:00+08:00');

function ctx(overrides: Partial<{ avgDailyAvailableMinutes: number; completedTaskIds: Set<string> }> = {}) {
  return {
    now: NOW,
    avgDailyAvailableMinutes: overrides.avgDailyAvailableMinutes ?? 180,
    completedTaskIds: overrides.completedTaskIds ?? new Set<string>(),
  };
}

describe('priority scoring', () => {
  it('scores an overdue task higher than a comfortable one of the same priority', () => {
    const overdue = makeTask({
      title: 'Overdue essay',
      priority: 'medium',
      deadline: '2026-06-07T18:00',
      remainingMinutes: 60,
    });
    const comfortable = makeTask({
      title: 'Comfortable reading',
      priority: 'medium',
      deadline: '2026-06-25T18:00',
      remainingMinutes: 60,
    });
    const s1 = scoreTask(overdue, ctx());
    const s2 = scoreTask(comfortable, ctx());
    expect(s1.score).toBeGreaterThan(s2.score);
    expect(s1.breakdown.overdue).toBeGreaterThan(0);
  });

  it('a low-importance task with a tight, effort-heavy deadline can outscore a "critical" task with slack', () => {
    const tightLowImportance = makeTask({
      title: 'Tight low-importance project',
      priority: 'low',
      deadline: '2026-06-09T18:00', // tomorrow
      remainingMinutes: 300, // 5h of work, ~1 day away, 180min/day avg -> big pressure
    });
    const slackCritical = makeTask({
      title: 'Distant critical task',
      priority: 'critical',
      deadline: '2026-07-15T18:00', // over a month away
      remainingMinutes: 30,
    });
    const s1 = scoreTask(tightLowImportance, ctx());
    const s2 = scoreTask(slackCritical, ctx());
    expect(s1.score).toBeGreaterThan(s2.score);
  });

  it('blocks a task with unmet dependencies and explains why', () => {
    const dep = makeTask({ title: 'Research' });
    const blocked = makeTask({ title: 'Write draft', dependsOn: [dep.id] });
    const score = scoreTask(blocked, ctx({ completedTaskIds: new Set() }));
    expect(score.schedulable).toBe(false);
    expect(score.score).toBe(0);
    expect(score.blockedReason).toMatch(new RegExp(dep.id));
  });

  it('unblocks a task once its dependency is marked completed', () => {
    const dep = makeTask({ title: 'Research' });
    const nowUnblocked = makeTask({ title: 'Write draft', dependsOn: [dep.id] });
    const score = scoreTask(nowUnblocked, ctx({ completedTaskIds: new Set([dep.id]) }));
    expect(score.schedulable).toBe(true);
  });

  it('produces a non-trivial, factor-based explanation, not just "priority: high"', () => {
    const task = makeTask({
      title: 'Chemistry homework',
      priority: 'high',
      deadline: '2026-06-11T18:00',
      remainingMinutes: 180,
    });
    const score = scoreTask(task, ctx());
    expect(score.explanation.length).toBeGreaterThan(10);
    expect(score.explanation.toLowerCase()).not.toBe('priority: high');
  });

  it('ranks tasks deterministically (same input -> same order every time)', () => {
    const tasks = [
      makeTask({ title: 'A', priority: 'low', deadline: '2026-06-20T18:00', remainingMinutes: 30 }),
      makeTask({ title: 'B', priority: 'high', deadline: '2026-06-09T18:00', remainingMinutes: 120 }),
      makeTask({ title: 'C', priority: 'medium', remainingMinutes: 45 }),
    ];
    const order1 = rankTasks(tasks, ctx()).map((t) => t.title);
    const order2 = rankTasks(tasks, ctx()).map((t) => t.title);
    expect(order1).toEqual(order2);
    expect(order1[0]).toBe('B');
  });

  it('excludes completed tasks\' own scoring relevance is moot, but a task with no deadline still scores non-zero', () => {
    const noDeadline = makeTask({ title: 'Someday task', priority: 'low', remainingMinutes: 30 });
    const score = scoreTask(noDeadline, ctx());
    expect(score.score).toBeGreaterThan(0);
    expect(score.schedulable).toBe(true);
  });
});
