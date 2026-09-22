import { describe, it, expect } from 'vitest';
import { analyseFeasibility, analyseWorkload } from '../src/lib/engine/feasibility.js';
import { makeTask, simpleAvailability } from './helpers.js';

const NOW = new Date('2026-06-08T08:00:00+08:00');

describe('feasibility analysis', () => {
  it('reports feasible when workload comfortably fits', () => {
    const task = makeTask({ title: 'Light reading', estimatedMinutes: 60, deadline: '2026-06-12T18:00' });
    const report = analyseFeasibility([task], [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    expect(report.feasible).toBe(true);
    expect(report.atRiskTasks).toEqual([]);
  });

  it('detects "17 hours of work but only 10 hours available" style overload and names the at-risk task', () => {
    const overloaded = makeTask({
      title: 'Huge assignment',
      estimatedMinutes: 17 * 60,
      deadline: '2026-06-09T18:00', // due tomorrow — very little time
      priority: 'high',
    });
    const report = analyseFeasibility([overloaded], [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    expect(report.feasible).toBe(false);
    expect(report.atRiskTasks.length).toBe(1);
    expect(report.atRiskTasks[0].taskId).toBe(overloaded.id);
    expect(report.atRiskTasks[0].shortfallMinutes).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('when two tasks share a tight deadline and cannot both fit, the one processed first absorbs capacity and the other is flagged at-risk', () => {
    const big = makeTask({
      title: 'Big task, same deadline',
      estimatedMinutes: 900,
      deadline: '2026-06-09T18:00', // tomorrow
      priority: 'high',
    });
    const small = makeTask({
      title: 'Small task, same deadline',
      estimatedMinutes: 200,
      deadline: '2026-06-09T18:00',
      priority: 'medium',
    });
    // Only ~2 days x 480min = 960min available before this shared deadline;
    // 900 + 200 = 1100 does not fit.
    const report = analyseFeasibility([big, small], [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    expect(report.feasible).toBe(false);
    const riskIds = report.atRiskTasks.map((r) => r.taskId);
    expect(riskIds).toContain(small.id);
    expect(riskIds).not.toContain(big.id);
  });

  it('treats an already-overdue task as consuming capacity from today', () => {
    const overdue = makeTask({ title: 'Late', estimatedMinutes: 60, deadline: '2026-06-01T18:00' });
    const report = analyseFeasibility([overdue], [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    // Should not crash and should still report a sane total.
    expect(report.totalRequiredMinutes).toBeGreaterThanOrEqual(60);
  });

  it('returns feasible with zero tasks', () => {
    const report = analyseFeasibility([], [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    expect(report.feasible).toBe(true);
    expect(report.totalRequiredMinutes).toBe(0);
  });
});

describe('workload analysis', () => {
  it('counts overdue tasks separately from the general workload total', () => {
    const overdue = makeTask({ title: 'Late thing', estimatedMinutes: 30, deadline: '2026-06-01T18:00' });
    const onTrack = makeTask({ title: 'Fine thing', estimatedMinutes: 30, deadline: '2026-06-20T18:00' });
    const report = analyseWorkload([overdue, onTrack], [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    expect(report.overdueCount).toBe(1);
    expect(report.overdueTasks[0].taskId).toBe(overdue.id);
    expect(report.totalTasks).toBe(2);
  });

  it('buckets pending tasks by priority label', () => {
    const tasks = [
      makeTask({ title: 'a', priority: 'low' }),
      makeTask({ title: 'b', priority: 'high' }),
      makeTask({ title: 'c', priority: 'high' }),
    ];
    const report = analyseWorkload(tasks, [], simpleAvailability(), NOW, '2026-06-08', '2026-06-14');
    expect(report.byPriority.high).toBe(2);
    expect(report.byPriority.low).toBe(1);
  });
});
