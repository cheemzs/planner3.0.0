import * as engine from '@/lib/engine-service';
import { todayIso } from '@/lib/engine/time-utils';

export const dynamic = 'force-dynamic';

function plusDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function InsightsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const from = searchParams.from || todayIso();
  const to = searchParams.to || plusDays(from, 13);

  const feasibility = await engine.checkFeasibility(from, to);
  const workload = await engine.workloadReport(from, to);

  return (
    <div>
      <h2>Am I on track?</h2>
      <p className="subtitle">Deadline feasibility and workload for a date range.</p>

      <form method="get" className="row" style={{ marginBottom: 20 }}>
        <input type="date" name="from" defaultValue={from} />
        <input type="date" name="to" defaultValue={to} />
        <button className="primary" type="submit">
          Check
        </button>
      </form>

      {feasibility.feasible ? (
        <div className="notice ok">
          Everything fits: {feasibility.totalRequiredMinutes} minute(s) of work needed, {feasibility.totalAvailableMinutes}{' '}
          available.
        </div>
      ) : (
        <div className="notice error">
          {feasibility.atRiskTasks.length} task(s) at risk — {feasibility.totalRequiredMinutes} minute(s) needed vs{' '}
          {feasibility.totalAvailableMinutes} available.
        </div>
      )}

      {feasibility.atRiskTasks.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Deadline</th>
              <th>Needed</th>
              <th>Available before deadline</th>
              <th>Shortfall</th>
            </tr>
          </thead>
          <tbody>
            {feasibility.atRiskTasks.map((t) => (
              <tr key={t.taskId}>
                <td>{t.title}</td>
                <td>{t.deadline}</td>
                <td>{t.requiredMinutes}m</td>
                <td>{t.availableMinutesBeforeDeadline}m</td>
                <td style={{ color: 'var(--danger)' }}>{t.shortfallMinutes}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {feasibility.recommendations.length > 0 ? (
        <>
          <h3>Recommendations</h3>
          <ul>
            {feasibility.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Workload</h3>
      <div className="card">
        <div>Pending tasks: {workload.totalTasks}</div>
        <div>Overdue: {workload.overdueCount}</div>
        <div>
          By priority: low {workload.byPriority.low}, medium {workload.byPriority.medium}, high {workload.byPriority.high},
          critical {workload.byPriority.critical}
        </div>
        <div>
          Utilization: {Math.round(workload.utilizationRatio * 100)}% ({workload.totalRequiredMinutes}m needed /{' '}
          {workload.totalAvailableMinutes}m available)
        </div>
      </div>
    </div>
  );
}
