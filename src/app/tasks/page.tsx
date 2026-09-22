import * as repo from '@/lib/repository';
import * as engine from '@/lib/engine-service';
import { createTaskAction, deleteTaskAction, completeTaskAction } from '@/app/tasks/actions';
import { createEventAction, deleteEventAction } from '@/app/events/actions';
import { APP_TIMEZONE } from '@/lib/engine/time-utils';

export const dynamic = 'force-dynamic';

type Section = 'tasks' | 'right-now' | 'events';

function parseSection(v?: string): Section {
  return v === 'right-now' || v === 'events' ? v : 'tasks';
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { section?: string; mode?: string; minutes?: string };
}) {
  const section = parseSection(searchParams.section);

  return (
    <div>
      <h2>Tasks</h2>
      <div className="day-tabs" style={{ marginBottom: 18 }}>
        <a href="/tasks?section=tasks" className={section === 'tasks' ? 'active' : ''}>
          Tasks
        </a>
        <a href="/tasks?section=right-now" className={section === 'right-now' ? 'active' : ''}>
          Right now
        </a>
        <a href="/tasks?section=events" className={section === 'events' ? 'active' : ''}>
          Events
        </a>
      </div>

      {section === 'tasks' ? <TasksSection /> : null}
      {section === 'right-now' ? <RightNowSection mode={searchParams.mode} minutes={searchParams.minutes} /> : null}
      {section === 'events' ? <EventsSection /> : null}
    </div>
  );
}

async function TasksSection() {
  const tasks = await repo.listTasks({});
  const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');

  return (
    <div>
      <p className="subtitle">{pending.length} pending</p>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Priority</th>
            <th>Mental load</th>
            <th>Deadline</th>
            <th>Est.</th>
            <th>Remaining</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>
                {t.title}
                {t.dependsOn && t.dependsOn.length > 0 ? (
                  <div style={{ fontSize: 11, opacity: 0.6 }}>depends on {t.dependsOn.length} task(s)</div>
                ) : null}
              </td>
              <td>
                <span className={`badge p-${t.priority}`}>{t.priority}</span>
              </td>
              <td>{t.difficulty ? `${t.difficulty}/5` : '—'}</td>
              <td>{t.deadline ? t.deadline.replace('T', ' ') : '—'}</td>
              <td>{t.estimatedMinutes}m</td>
              <td>{t.remainingMinutes}m</td>
              <td>{t.status}</td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  {t.status !== 'completed' && t.status !== 'cancelled' ? (
                    <>
                      <form action={completeTaskAction} className="inline">
                        <input type="hidden" name="taskId" value={t.id} />
                        <button className="small" type="submit">
                          Done
                        </button>
                      </form>
                      <a className="btn small" href={`/tasks/${t.id}/split`}>
                        Split
                      </a>
                    </>
                  ) : null}
                  <form action={deleteTaskAction} className="inline">
                    <input type="hidden" name="taskId" value={t.id} />
                    <button className="small danger" type="submit">
                      Delete
                    </button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {tasks.length === 0 ? (
            <tr>
              <td colSpan={8} className="empty">
                No tasks yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3>New task</h3>
      <div className="card">
        <form action={createTaskAction}>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" required placeholder="Chemistry homework" />

          <label htmlFor="description">Notes</label>
          <textarea id="description" name="description" placeholder="Optional details" />

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="priority">Priority</label>
              <select id="priority" name="priority" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="difficulty">Mental workload (1-5)</label>
              <input id="difficulty" name="difficulty" type="number" min={1} max={5} placeholder="3" />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="estimatedMinutes">Estimated time (minutes)</label>
              <input id="estimatedMinutes" name="estimatedMinutes" type="number" min={5} defaultValue={60} required />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="deadline">Deadline</label>
              <input id="deadline" name="deadline" type="datetime-local" />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="earliestStart">Earliest start</label>
              <input id="earliestStart" name="earliestStart" type="datetime-local" />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="preferredTimeOfDay">Preferred time of day</label>
              <select id="preferredTimeOfDay" name="preferredTimeOfDay" defaultValue="any">
                <option value="any">Any</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="minChunkMinutes">Min. session length (minutes)</label>
              <input id="minChunkMinutes" name="minChunkMinutes" type="number" min={5} placeholder="20" />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="maxChunkMinutes">Max. session length (minutes)</label>
              <input id="maxChunkMinutes" name="maxChunkMinutes" type="number" min={5} placeholder="120" />
            </div>
          </div>

          <fieldset>
            <legend>Depends on (must finish first)</legend>
            <select name="dependsOn" multiple size={Math.min(6, Math.max(2, pending.length))}>
              {pending.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </fieldset>

          <label htmlFor="tags">Tags (comma-separated)</label>
          <input id="tags" name="tags" placeholder="school, chemistry" />

          <div className="actions">
            <button className="primary" type="submit">
              Create task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

async function RightNowSection({ mode, minutes }: { mode?: string; minutes?: string }) {
  const activeMode = mode === 'free-time' ? 'free-time' : 'now';

  return (
    <div>
      <div className="row" style={{ marginBottom: 16, gap: 6 }}>
        <a className={`btn${activeMode === 'now' ? ' active' : ''}`} href="/tasks?section=right-now&mode=now">
          What should I do right now?
        </a>
        <a className={`btn${activeMode === 'free-time' ? ' active' : ''}`} href="/tasks?section=right-now&mode=free-time">
          I have N minutes free
        </a>
      </div>

      {activeMode === 'now' ? <NextActionPanel /> : <FreeTimePanel minutes={minutes} />}
    </div>
  );
}

async function NextActionPanel() {
  const action = await engine.nextAction();
  const noticeClass =
    action.kind === 'suggest_task' ? 'ok' : action.kind === 'nothing_fits' || action.kind === 'suggest_break' ? 'warn' : '';

  return (
    <div>
      <p className="subtitle">
        {new Date().toLocaleString('en-SG', { timeZone: APP_TIMEZONE, dateStyle: 'full', timeStyle: 'short', hourCycle: 'h23' })} SGT
      </p>

      <div className={`notice ${noticeClass}`.trim()}>{action.message}</div>

      {action.alternatives && action.alternatives.length > 0 ? (
        <>
          <h3>Also consider</h3>
          <ul>
            {action.alternatives.map((a) => (
              <li key={a.taskId}>{a.title}</li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="actions">
        <a className="btn" href="/tasks?section=right-now&mode=now">
          Refresh
        </a>
        <a className="btn" href="/schedule">
          Back to Schedule
        </a>
      </div>
    </div>
  );
}

async function FreeTimePanel({ minutes }: { minutes?: string }) {
  const parsed = Number(minutes ?? '');
  const result = Number.isFinite(parsed) && parsed > 0 ? await engine.freeTimeFit(parsed) : undefined;

  return (
    <div>
      <p className="subtitle">Tell me how long, and I&apos;ll find the best-fitting pending task.</p>

      <form method="get" className="row" style={{ marginBottom: 20 }}>
        <input type="hidden" name="section" value="right-now" />
        <input type="hidden" name="mode" value="free-time" />
        <input type="number" name="minutes" min={1} placeholder="45" defaultValue={minutes} style={{ width: 120 }} />
        <button className="primary" type="submit">
          Find something to do
        </button>
      </form>

      {result ? (
        result.best ? (
          <div className="notice ok">
            <strong>{result.best.title}</strong>
            <div>{result.best.reason}</div>
          </div>
        ) : (
          <div className="notice warn">{result.note}</div>
        )
      ) : null}

      {result && result.alternatives.length > 0 ? (
        <>
          <h3>Alternatives</h3>
          <ul>
            {result.alternatives.map((a) => (
              <li key={a.taskId}>
                {a.title} — {a.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function EventsSection() {
  const events = await repo.listEvents();

  return (
    <div>
      <p className="subtitle">Fixed commitments the planner will never schedule over: school, appointments, exams, sports, meetings.</p>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Date</th>
            <th>Time</th>
            <th>Fixed</th>
            <th>Repeats</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.title}</td>
              <td>{e.date}</td>
              <td>
                {e.start} - {e.end}
              </td>
              <td>{e.fixed ? 'Yes' : 'No'}</td>
              <td>{e.recurrence ? e.recurrence.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ') : '—'}</td>
              <td>
                <form action={deleteEventAction} className="inline">
                  <input type="hidden" name="eventId" value={e.id} />
                  <button className="small danger" type="submit">
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {events.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty">
                No events yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h3>New event</h3>
      <div className="card">
        <form action={createEventAction}>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" required placeholder="Dentist appointment" />

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="date">Date</label>
              <input id="date" name="date" type="date" required />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="start">Start</label>
              <input id="start" name="start" type="time" required />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="end">End</label>
              <input id="end" name="end" type="time" required />
            </div>
          </div>

          <label htmlFor="category">Category</label>
          <input id="category" name="category" placeholder="school, appointment, sports…" />

          <fieldset>
            <legend>Repeats weekly on (leave unchecked for a one-off event)</legend>
            <div className="row">
              {DAY_LABELS.map((label, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
                  <input type="checkbox" name="daysOfWeek" value={i} style={{ width: 'auto' }} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" name="fixed" defaultChecked style={{ width: 'auto' }} />
            Fixed (the planner can never schedule over this — turn off for a flexible/movable commitment)
          </label>

          <div className="actions">
            <button className="primary" type="submit">
              Add event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
