import type { ScheduleBlock } from '@/lib/engine/types';
import { completeTaskAction, interruptTaskAction, skipTaskAction } from '@/app/tasks/actions';

export function ScheduleBlocks({ blocks, showControls = true }: { blocks: ScheduleBlock[]; showControls?: boolean }) {
  if (blocks.length === 0) {
    return <div className="empty">Nothing scheduled.</div>;
  }
  return (
    <div>
      {blocks.map((b) => (
        <div key={b.id} className={`block-row ${b.type}`}>
          <div className="block-time">
            {b.start} - {b.end}
          </div>
          <div style={{ flex: 1 }}>
            <div className="block-title">{b.title}</div>
            {b.reason ? <div className="block-reason">{b.reason}</div> : null}
            {showControls && b.type === 'task' && b.refId ? (
              <div className="block-controls">
                <form action={completeTaskAction} className="inline">
                  <input type="hidden" name="taskId" value={b.refId} />
                  <button className="small" type="submit">
                    Done
                  </button>
                </form>
                <form action={skipTaskAction} className="inline">
                  <input type="hidden" name="taskId" value={b.refId} />
                  <input type="hidden" name="date" value={b.date} />
                  <button className="small" type="submit">
                    Couldn&apos;t do it
                  </button>
                </form>
                <form action={interruptTaskAction} className="inline row" style={{ gap: 4 }}>
                  <input type="hidden" name="taskId" value={b.refId} />
                  <input type="hidden" name="date" value={b.date} />
                  <input
                    type="number"
                    name="minutesSpent"
                    placeholder="min spent"
                    min={0}
                    style={{ width: 80 }}
                  />
                  <button className="small" type="submit">
                    Interrupted
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
