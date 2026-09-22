import * as repo from '@/lib/repository';
import { splitTaskAction } from '@/app/tasks/actions';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function SplitTaskPage({ params }: { params: { id: string } }) {
  const task = await repo.getTask(params.id);
  if (!task) notFound();

  return (
    <div>
      <h2>Split &quot;{task.title}&quot;</h2>
      <p className="subtitle">{task.remainingMinutes} minutes remaining, across ordered phases (each depends on the one before it).</p>

      <div className="card">
        <form action={splitTaskAction}>
          <input type="hidden" name="taskId" value={task.id} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div className="row" key={i}>
              <div style={{ flex: 3 }}>
                <label>Phase {i + 1} title</label>
                <input name="phaseTitle" placeholder={i === 0 ? 'e.g. Research' : 'optional'} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Minutes</label>
                <input name="phaseMinutes" type="number" min={0} placeholder="60" />
              </div>
            </div>
          ))}
          <p className="subtitle">
            Leave all phases blank to fall back to an even, generic split based on the task&apos;s max session length.
          </p>
          <div className="actions">
            <button className="primary" type="submit">
              Split task
            </button>
            <a className="btn" href="/tasks">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
