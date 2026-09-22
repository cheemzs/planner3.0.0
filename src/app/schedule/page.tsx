import * as repo from '@/lib/repository';
import * as engine from '@/lib/engine-service';
import { planTodayAction, replanTodayAction, planWeekAction, planMonthAction } from '@/app/actions';
import { ScheduleGrid } from '@/app/components/ScheduleGrid';
import { todayIso, startOfWeek, weekDates, startOfMonth } from '@/lib/engine/time-utils';
import type { PlanTask, ScheduleBlock } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

type View = 'day' | 'week' | 'month';

function parseView(v?: string): View {
  return v === 'week' || v === 'month' ? v : 'day';
}

function tagsMap(tasks: Pick<PlanTask, 'id' | 'tags'>[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tasks) out[t.id] = t.tags ?? [];
  return out;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { view?: string; date?: string; monthStart?: string };
}) {
  const view = parseView(searchParams.view);
  const anchorDate = searchParams.date || todayIso();

  return (
    <div>
      <h2>Schedule</h2>
      <ViewTabs view={view} date={anchorDate} monthStart={searchParams.monthStart || startOfMonth(anchorDate)} />

      {view === 'day' ? <DayView date={anchorDate} /> : null}
      {view === 'week' ? <WeekView anchor={anchorDate} /> : null}
      {view === 'month' ? <MonthView monthStart={searchParams.monthStart || startOfMonth(anchorDate)} /> : null}
    </div>
  );
}

function ViewTabs({ view, date, monthStart }: { view: View; date: string; monthStart: string }) {
  return (
    <div className="day-tabs" style={{ marginBottom: 18 }}>
      <a href={`/schedule?view=day&date=${date}`} className={view === 'day' ? 'active' : ''}>
        Day
      </a>
      <a href={`/schedule?view=week&date=${date}`} className={view === 'week' ? 'active' : ''}>
        Week
      </a>
      <a href={`/schedule?view=month&monthStart=${monthStart}`} className={view === 'month' ? 'active' : ''}>
        Month
      </a>
    </div>
  );
}

async function DayView({ date }: { date: string }) {
  const [schedule, tasks, hasAvailability, groups] = await Promise.all([
    repo.getScheduleForRange(date, date),
    repo.listTasks({}),
    repo.hasConfiguredAvailability(),
    repo.listMyGroups(),
  ]);

  const steps = [
    { done: hasAvailability, label: 'Set your available hours', href: '/settings?section=availability' },
    { done: tasks.length > 0, label: 'Add your first task', href: '/tasks' },
    { done: groups.length > 0, label: 'Create or join a group (optional)', href: '/groups' },
  ];
  const showOnboarding = !hasAvailability || tasks.length === 0;

  return (
    <div>
      <p className="subtitle">{date}</p>

      {showOnboarding ? (
        <div className="card">
          <strong>Get started</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {steps.map((s) => (
              <li key={s.href} style={{ marginBottom: 4 }}>
                {s.done ? '✅ ' : ''}
                <a href={s.href}>{s.label}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="actions">
        <form action={planTodayAction} className="inline">
          <input type="hidden" name="date" value={date} />
          <button className="primary" type="submit">
            Plan Day
          </button>
        </form>
        <form action={replanTodayAction} className="inline">
          <input type="hidden" name="date" value={date} />
          <button type="submit">Replan</button>
        </form>
        <a className="btn" href="/tasks?section=right-now&mode=now">
          What should I do now?
        </a>
        <a className="btn" href="/tasks?section=right-now&mode=free-time">
          I have free time
        </a>
        <a className="btn" href={`/api/schedule/export?from=${date}&to=${date}`}>
          Export .ics
        </a>
      </div>

      <ScheduleGrid mode="day" dates={[date]} blocksByDate={{ [date]: schedule }} taskTagsById={tagsMap(tasks)} />
    </div>
  );
}

async function WeekView({ anchor }: { anchor: string }) {
  const weekStart = startOfWeek(anchor);
  const dates = weekDates(weekStart);

  const [schedule, tasks] = await Promise.all([repo.getScheduleForRange(weekStart, dates[dates.length - 1]), repo.listTasks({})]);

  const blocksByDate: Record<string, ScheduleBlock[]> = {};
  for (const d of dates) blocksByDate[d] = [];
  for (const b of schedule) (blocksByDate[b.date] ??= []).push(b);

  return (
    <div>
      <p className="subtitle">Week of {weekStart}. Planned as one connected optimization problem, not seven independent days.</p>

      <form action={planWeekAction} className="actions">
        <input type="date" name="weekStart" defaultValue={weekStart} style={{ width: 160 }} />
        <button className="primary" type="submit">
          Plan Week
        </button>
        <a className="btn" href={`/api/schedule/export?from=${weekStart}&to=${dates[dates.length - 1]}`}>
          Export .ics
        </a>
      </form>

      <ScheduleGrid mode="week" dates={dates} blocksByDate={blocksByDate} taskTagsById={tagsMap(tasks)} />
    </div>
  );
}

async function MonthView({ monthStart }: { monthStart: string }) {
  const summary = await engine.planMonth(monthStart);
  const [y, m] = monthStart.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  return (
    <div>
      <p className="subtitle">
        Month {summary.month}. Milestone/deadline view — not minute-precise. Drill into a week for the actual schedule.
      </p>

      <form action={planMonthAction} className="actions">
        <input type="date" name="monthStart" defaultValue={monthStart} style={{ width: 160 }} />
        <button className="primary" type="submit">
          Plan Month
        </button>
        <a className="btn" href={`/api/schedule/export?from=${monthStart}&to=${monthEnd}`}>
          Export .ics
        </a>
      </form>

      <h3>Milestones &amp; major deadlines</h3>
      {summary.milestoneTasks.length === 0 ? (
        <div className="empty">No high-priority or large tasks due this month.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Deadline</th>
            </tr>
          </thead>
          <tbody>
            {summary.milestoneTasks.map((t) => (
              <tr key={t.taskId}>
                <td>{t.title}</td>
                <td>{t.deadline}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Feasibility</h3>
      {summary.feasibility.feasible ? (
        <div className="notice ok">Everything with a deadline this month fits within available time.</div>
      ) : (
        <div className="notice error">
          {summary.feasibility.atRiskTasks.length} task(s) at risk this month.
          <ul>
            {summary.feasibility.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>Weeks</h3>
      <div className="row">
        {summary.weeks.map((w) => (
          <a key={w.weekStart} className="btn" href={`/schedule?view=week&date=${w.weekStart}`}>
            Week of {w.weekStart}
            {w.plan.unmetDeadlines.length > 0 ? ` (${w.plan.unmetDeadlines.length} at risk)` : ''}
          </a>
        ))}
      </div>
    </div>
  );
}
