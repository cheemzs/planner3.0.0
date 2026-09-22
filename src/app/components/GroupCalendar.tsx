import type { ReactNode } from 'react';
import type { DayHeat } from '@/lib/engine/group-insights';
import type { ResolvedPeriod } from '@/lib/engine/group-period';
import { daysInMonth, dayOfWeek, startOfMonth, addDays } from '@/lib/engine/time-utils';
import { fmtDay, fmtDuration, fmtMonthTitle } from '@/lib/format';
import type { ISODate } from '@/lib/engine/types';

const DOW_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function monthStarts(period: ResolvedPeriod): ISODate[] {
  const out: ISODate[] = [];
  let cursor = startOfMonth(period.start);
  const last = startOfMonth(period.end);
  while (cursor <= last) {
    out.push(cursor);
    // first of next month, safely (day 1 + 32 days always lands in the next month)
    cursor = startOfMonth(addDays(cursor, 32));
  }
  return out;
}

function levelClass(count: number, members: number): string {
  if (members >= 2 && count === members) return 'all';
  if (count === 0) return 'l0';
  const ratio = count / members;
  if (ratio <= 1 / 3) return 'l1';
  if (ratio <= 2 / 3) return 'l2';
  return 'l3';
}

/**
 * Heatmap of the planning period, one grid per calendar month (Monday
 * first). Each upcoming day is a link to that day's detail; colour shows
 * the most members who can be free together for the group's minimum block,
 * and the "n/N" text says the same thing so colour is never the only cue.
 */
export function GroupCalendar({
  groupId,
  period,
  perDay,
  memberCount,
  today,
  selected,
}: {
  groupId: string;
  period: ResolvedPeriod;
  perDay: Map<ISODate, DayHeat>;
  memberCount: number;
  today: ISODate;
  selected?: ISODate;
}) {
  return (
    <>
      <div className="cal-wrap">
        {monthStarts(period).map((first) => {
          const lead = (dayOfWeek(first) + 6) % 7; // Monday-first offset
          const total = daysInMonth(first);
          const cells: ReactNode[] = [];
          const active: boolean[] = []; // does this cell belong to the period? (used to trim empty weeks)
          const push = (node: ReactNode, inPeriod: boolean) => {
            cells.push(node);
            active.push(inPeriod);
          };

          for (let i = 0; i < lead; i++) push(<div key={`b${i}`} className="cal-cell out" aria-hidden="true" />, false);

          for (let d = 1; d <= total; d++) {
            const iso = `${first.slice(0, 8)}${String(d).padStart(2, '0')}`;
            const inPeriod = iso >= period.start && iso <= period.end;
            if (!inPeriod) {
              push(<div key={iso} className="cal-cell out" aria-hidden="true" />, false);
              continue;
            }
            if (iso < period.planFrom) {
              push(
                <div key={iso} className="cal-cell past" aria-label={`${fmtDay(iso)} (past)`}>
                  <span className="n">{d}</span>
                </div>,
                true,
              );
              continue;
            }
            const heat = perDay.get(iso);
            const count = heat?.peakCount ?? 0;
            const cls = ['cal-cell', levelClass(count, Math.max(memberCount, 1)), iso === today ? 'today' : '', iso === selected ? 'selected' : '']
              .filter(Boolean)
              .join(' ');
            const label =
              count === 0
                ? `${fmtDay(iso)}: nobody free for a full block`
                : `${fmtDay(iso)}: ${count} of ${memberCount} can be free together for up to ${fmtDuration(heat!.peakMinutes)}`;
            push(
              <a key={iso} className={cls} href={`/group/${groupId}?day=${iso}#day-detail`} aria-label={label} title={label}>
                <span className="n">{d}</span>
                <span className="c">{count > 0 ? `${count}/${memberCount}` : '·'}</span>
              </a>,
              true,
            );
          }

          // Pad to whole weeks, then drop any week with no day in the period
          // (e.g. the first three weeks of a month when the period starts on the 21st).
          while (cells.length % 7 !== 0) push(<div key={`t${cells.length}`} className="cal-cell out" aria-hidden="true" />, false);
          const visibleCells: ReactNode[] = [];
          for (let w = 0; w < cells.length; w += 7) {
            if (active.slice(w, w + 7).some(Boolean)) visibleCells.push(...cells.slice(w, w + 7));
          }

          return (
            <div className="cal-month" key={first}>
              <h4>{fmtMonthTitle(first)}</h4>
              <div className="cal-grid">
                {DOW_HEADERS.map((h, i) => (
                  <div className="cal-dow" key={i} aria-hidden="true">
                    {h}
                  </div>
                ))}
                {visibleCells}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend" aria-hidden="true">
        <span>
          <i />
          Nobody
        </span>
        <span>
          <i className="l1" />
          Few
        </span>
        <span>
          <i className="l2" />
          Some
        </span>
        <span>
          <i className="l3" />
          Most
        </span>
        <span>
          <i className="all" />
          Everyone
        </span>
      </div>
    </>
  );
}
