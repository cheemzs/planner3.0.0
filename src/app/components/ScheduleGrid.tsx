'use client';

import { useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ScheduleBlock } from '@/lib/engine/types';
import { timeToMinutes } from '@/lib/engine/time-utils';
import { completeTaskAction, interruptTaskAction, skipTaskAction, moveTaskAction } from '@/app/tasks/actions';

/**
 * Real time-proportional calendar grid (replaces the old flat ScheduleBlocks
 * list for Day/Week). Each day is its own CSS Grid with one row per 30
 * minutes; a block's `gridRow` span is derived from its start/end time, so
 * height and position are always proportional to real duration -- not just
 * stacked in order like the old list view.
 */

const ROW_MINUTES = 30;
const ROWS = (24 * 60) / ROW_MINUTES; // 48
const ROW_PX = 20;

// Small fixed palette; a tag name hashes to one of these deterministically
// so the same tag always gets the same color without any user-facing picker.
const TAG_PALETTE = ['#4361ee', '#e35d8a', '#3fbf7f', '#e3a33d', '#8b5cf6', '#06b6d4', '#f0605d', '#84cc16'];

function colorForTag(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

function blockColor(block: ScheduleBlock, taskTagsById: Record<string, string[]>): string | undefined {
  if (block.type !== 'task' || !block.refId) return undefined;
  const tags = taskTagsById[block.refId];
  return tags && tags.length > 0 ? colorForTag(tags[0]) : undefined;
}

function rowSpan(start: string, end: string): { start: number; end: number } {
  const startRow = Math.max(0, Math.floor(timeToMinutes(start) / ROW_MINUTES));
  const endRow = Math.max(startRow + 1, Math.ceil(timeToMinutes(end) / ROW_MINUTES));
  return { start: startRow + 1, end: Math.min(ROWS + 1, endRow + 1) };
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

function weekdayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' });
}

export function ScheduleGrid({
  mode,
  dates,
  blocksByDate,
  taskTagsById,
}: {
  mode: 'day' | 'week';
  dates: string[];
  blocksByDate: Record<string, ScheduleBlock[]>;
  taskTagsById: Record<string, string[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  function handleDrop(toDate: string, e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverDate(null);
    let payload: { taskId?: string; fromDate?: string } = {};
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    if (!payload.taskId || !payload.fromDate || payload.fromDate === toDate) return;
    const fd = new FormData();
    fd.set('taskId', payload.taskId);
    fd.set('fromDate', payload.fromDate);
    fd.set('toDate', toDate);
    startTransition(async () => {
      await moveTaskAction(fd);
      router.refresh();
    });
  }

  return (
    <div className={`sched-wrap${isPending ? ' sched-pending' : ''}`}>
      <div className="sched-body">
        <div className="sched-day-wrap sched-gutter-wrap">
          <div className="sched-col-head">&nbsp;</div>
          <div className="sched-gutter" style={{ gridTemplateRows: `repeat(${ROWS}, ${ROW_PX}px)` }}>
            {HOUR_LABELS.map((label, h) => (
              <div key={label} className="sched-hour-label" style={{ gridRow: h * 2 + 1 }}>
                {label}
              </div>
            ))}
          </div>
        </div>

        {dates.map((date) => {
          const blocks = blocksByDate[date] ?? [];
          return (
            <div key={date} className="sched-day-wrap">
              <div className="sched-col-head">
                {weekdayLabel(date)}
                <span>{date.slice(5)}</span>
              </div>
              <div
                className={`sched-col${dragOverDate === date ? ' drag-over' : ''}`}
                style={{ gridTemplateRows: `repeat(${ROWS}, ${ROW_PX}px)` }}
                onDragOver={
                  mode === 'week'
                    ? (e) => {
                        e.preventDefault();
                        setDragOverDate(date);
                      }
                    : undefined
                }
                onDragLeave={mode === 'week' ? () => setDragOverDate((d) => (d === date ? null : d)) : undefined}
                onDrop={mode === 'week' ? (e) => handleDrop(date, e) : undefined}
              >
                {blocks.length === 0 ? <div className="sched-empty-hint">Nothing scheduled.</div> : null}
                {blocks.map((b) => {
                  const { start, end } = rowSpan(b.start, b.end);
                  const color = blockColor(b, taskTagsById);
                  const draggable = mode === 'week' && b.type === 'task' && !!b.refId;
                  return (
                    <div
                      key={b.id}
                      className={`sched-block ${b.type}`}
                      style={{ gridRow: `${start} / ${end}`, borderLeftColor: color }}
                      draggable={draggable}
                      onDragStart={
                        draggable
                          ? (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: b.refId, fromDate: b.date }))
                          : undefined
                      }
                      tabIndex={0}
                      title={b.reason ?? b.title}
                    >
                      <div className="sched-block-time">
                        {b.start}–{b.end}
                      </div>
                      <div className="sched-block-title">{b.title}</div>
                      {b.type === 'task' && b.refId ? (
                        <div className="sched-block-controls">
                          <form action={completeTaskAction} className="inline">
                            <input type="hidden" name="taskId" value={b.refId} />
                            <button className="small" type="submit" title="Done">
                              ✓
                            </button>
                          </form>
                          <form action={skipTaskAction} className="inline">
                            <input type="hidden" name="taskId" value={b.refId} />
                            <input type="hidden" name="date" value={b.date} />
                            <button className="small" type="submit" title="Couldn't do it">
                              ✕
                            </button>
                          </form>
                          <form action={interruptTaskAction} className="inline row" style={{ gap: 4 }}>
                            <input type="hidden" name="taskId" value={b.refId} />
                            <input type="hidden" name="date" value={b.date} />
                            <input type="number" name="minutesSpent" placeholder="min" min={0} style={{ width: 52 }} />
                            <button className="small" type="submit" title="Interrupted">
                              ⏸
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {mode === 'week' ? <p className="hint" style={{ margin: '8px 0 0' }}>Drag a task block onto another day to move it.</p> : null}
    </div>
  );
}
