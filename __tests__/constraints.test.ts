import { describe, it, expect } from 'vitest';
import { detectDependencyCycle, topologicalOrder, classifyFeasibility } from '../src/lib/engine/constraints.js';
import { makeTask, simpleAvailability } from './helpers.js';

describe('dependency cycle detection', () => {
  it('returns null for an acyclic graph', () => {
    const a = makeTask({ title: 'A' });
    const b = makeTask({ title: 'B', dependsOn: [a.id] });
    expect(detectDependencyCycle([a, b])).toBeNull();
  });

  it('detects a direct cycle (A depends on B, B depends on A)', () => {
    const a = makeTask({ title: 'A' });
    const b = makeTask({ title: 'B' });
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    const cycle = detectDependencyCycle([a, b]);
    expect(cycle).not.toBeNull();
    expect(cycle!.cycle).toContain(a.id);
    expect(cycle!.cycle).toContain(b.id);
  });

  it('detects a longer transitive cycle (A -> B -> C -> A)', () => {
    const a = makeTask({ title: 'A' });
    const b = makeTask({ title: 'B' });
    const c = makeTask({ title: 'C' });
    a.dependsOn = [c.id];
    b.dependsOn = [a.id];
    c.dependsOn = [b.id];
    expect(detectDependencyCycle([a, b, c])).not.toBeNull();
  });
});

describe('topological order', () => {
  it('orders a simple chain correctly: research -> outline -> draft -> review', () => {
    const research = makeTask({ title: 'Research' });
    const outline = makeTask({ title: 'Outline', dependsOn: [research.id] });
    const draft = makeTask({ title: 'Draft', dependsOn: [outline.id] });
    const review = makeTask({ title: 'Review', dependsOn: [draft.id] });
    // Deliberately pass them out of order.
    const order = topologicalOrder([review, draft, research, outline], new Set());
    expect(order.map((t) => t.title)).toEqual(['Research', 'Outline', 'Draft', 'Review']);
  });

  it('treats already-completed dependencies as satisfied', () => {
    const done = makeTask({ title: 'Done already', status: 'completed', remainingMinutes: 0 });
    const next = makeTask({ title: 'Next step', dependsOn: [done.id] });
    const order = topologicalOrder([done, next], new Set([done.id]));
    expect(order.map((t) => t.title)).toEqual(['Done already', 'Next step']);
  });
});

describe('feasibility classification', () => {
  const HORIZON_START = '2026-06-08';
  const HORIZON_END = '2026-06-14';

  it('classifies a comfortable task as fully feasible', () => {
    const task = makeTask({ title: 'Easy', estimatedMinutes: 60, deadline: '2026-06-12T18:00' });
    const model = classifyFeasibility([task], simpleAvailability(), [], [], HORIZON_START, HORIZON_END);
    expect(model.perTask.get(task.id)!.status).toBe('feasible');
  });

  it('classifies a genuinely oversized requirement as infeasible with a real shortfall', () => {
    const task = makeTask({
      title: 'Way too much',
      estimatedMinutes: 3000,
      deadline: '2026-06-09T18:00',
    });
    const model = classifyFeasibility([task], simpleAvailability(), [], [], HORIZON_START, HORIZON_END);
    const fm = model.perTask.get(task.id)!;
    expect(fm.status).not.toBe('feasible');
    expect(fm.feasibleMinutes).toBeLessThan(fm.requiredMinutes);
    expect(fm.reason).toBeTruthy();
  });

  it('treats an overdue deadline as "as soon as possible" rather than a closed, zero-capacity window', () => {
    const overdue = makeTask({ title: 'Late', estimatedMinutes: 60, deadline: '2026-06-01T18:00' });
    const model = classifyFeasibility([overdue], simpleAvailability(), [], [], HORIZON_START, HORIZON_END);
    const fm = model.perTask.get(overdue.id)!;
    expect(fm.status).toBe('feasible');
    expect(fm.deadlineDay).toBe(HORIZON_START);
  });

  it('reports a dependency cycle rather than silently ignoring it', () => {
    const a = makeTask({ title: 'A' });
    const b = makeTask({ title: 'B' });
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    const model = classifyFeasibility([a, b], simpleAvailability(), [], [], HORIZON_START, HORIZON_END);
    expect(model.cycle).not.toBeNull();
    expect(model.perTask.get(a.id)!.status).toBe('infeasible');
  });
});
