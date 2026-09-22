import type { ReactNode } from 'react';
import type { GroupDay, GroupInsights, PeakWindow } from '@/lib/engine/group-insights';
import { everyoneWindowsForDay, peakWindowForDay } from '@/lib/engine/group-insights';
import type { ResolvedPeriod } from '@/lib/engine/group-period';
import type { GroupMember, PlannerGroup } from '@/lib/repository';
import { tzShortLabel, fmtDate, fmtDay, fmtDayLong, fmtDuration, fmtHours, fmtRange, memberName, weekdayName } from '@/lib/format';
import type { ISODate } from '@/lib/engine/types';

type Names = Record<string, string>;

export function namesOf(roster: GroupMember[]): Names {
  return Object.fromEntries(roster.map((m) => [m.id, memberName(m)]));
}

function Chips({ w, names, meId }: { w: PeakWindow; names: Names; meId?: string }) {
  const label = (id: string) => `${names[id] ?? 'Someone'}${id === meId ? ' (you)' : ''}`;
  return (
    <div className="chips">
      {w.freeUserIds.map((id) => (
        <span key={id} className="chip free">
          {label(id)}
        </span>
      ))}
      {w.busyUserIds.map((id) => (
        <span key={id} className="chip busy" title="Not free for this whole window">
          {label(id)}
        </span>
      ))}
    </div>
  );
}

function whenLabel(w: PeakWindow, today: ISODate): string {
  return `${fmtDay(w.date)}${w.date === today ? ' · today' : ''}`;
}

/** Headline answer: the single best time for the group, or the reason there isn't one. */
export function BestTimeHero({
  group,
  insights,
  period,
  roster,
  names,
  today,
  isOrganiser,
  meId,
}: {
  group: PlannerGroup;
  insights: GroupInsights | null;
  period: ResolvedPeriod;
  roster: GroupMember[];
  names: Names;
  today: ISODate;
  isOrganiser: boolean;
  meId?: string;
}) {
  const organiserName = names[group.organiserId] ?? 'the organiser';
  const manageLink = isOrganiser ? (
    <a href={`/group/${group.id}/manage#settings`}>Change the planning period</a>
  ) : (
    <>Ask {organiserName} to set a new one.</>
  );

  if (period.ended) {
    return (
      <div className="notice warn">
        This planning period ended on {fmtDate(period.end)}. {manageLink}
      </div>
    );
  }
  if (roster.length < 2) {
    return (
      <div className="card">
        <strong>It&apos;s just you so far.</strong>
        <p className="subtitle" style={{ margin: '6px 0 0' }}>
          Share the invite code <code>{group.inviteCode}</code> with the people you want to plan with
          {group.requireApproval ? ' — the organiser approves each request before they appear here' : ''}. The best times show up once at least two people are in.
        </p>
      </div>
    );
  }
  const best = insights?.bestOverall;
  if (!best) {
    return (
      <div className="card">
        <strong>No shared free time in this period.</strong>
        <p className="subtitle" style={{ margin: '6px 0 0' }}>
          There&apos;s no time when even two of you are free together for {fmtDuration(group.minBlockMinutes)} in a row.{' '}
          {isOrganiser ? <a href={`/group/${group.id}/manage#settings`}>Try a shorter minimum block or a longer period.</a> : 'The organiser can try a shorter minimum block or a longer period.'}
        </p>
      </div>
    );
  }

  return (
    <section className={`hero${best.everyone ? ' everyone' : ''}`} aria-label="Best time for the group">
      <div className="eyebrow">{best.everyone ? 'Best time · everyone is free' : 'Best time for the group'}</div>
      <div className="big">
        {whenLabel(best, today)}
        <small>
          {fmtRange(best.start, best.end)} {tzShortLabel(group.timezone)} · {fmtDuration(best.minutes)} free together
        </small>
      </div>
      <div className="sub">
        {best.everyone ? (
          <>All {roster.length} members can make it.</>
        ) : (
          <>
            <strong>{best.freeUserIds.length}</strong> of {roster.length} members can make it — the most on any day in this period.
          </>
        )}
      </div>
      <Chips w={best} names={names} meId={meId} />
    </section>
  );
}

export function StatTiles({ insights, memberCount }: { insights: GroupInsights; memberCount: number }) {
  const longest = insights.bestEveryone;
  return (
    <div className="stat-grid">
      <div className="stat">
        <div className="v">{memberCount}</div>
        <div className="l">members</div>
      </div>
      <div className="stat">
        <div className="v">
          {insights.daysWithEveryone}
          <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}> / {insights.daysAnalysed}</span>
        </div>
        <div className="l">days everyone&apos;s free</div>
      </div>
      <div className="stat">
        <div className="v">{insights.totalEveryoneMinutes > 0 ? fmtHours(insights.totalEveryoneMinutes) : '—'}</div>
        <div className="l">total time together</div>
      </div>
      <div className="stat">
        <div className="v">{longest ? fmtDuration(longest.minutes) : '—'}</div>
        <div className="l">longest shared block</div>
      </div>
    </div>
  );
}

export function EveryoneCard({ group, insights, today, isOrganiser }: { group: PlannerGroup; insights: GroupInsights; today: ISODate; isOrganiser: boolean }) {
  const next = insights.nextEveryone;
  const longest = insights.bestEveryone;
  return (
    <div className="card">
      <h4>When everyone can make it</h4>
      {next && longest ? (
        <ul className="slot-list">
          <li>
            <a href={`/group/${group.id}?day=${next.date}#day-detail`}>
              <div className="who">Soonest day</div>
              <div className="when">
                {whenLabel(next, today)} · {fmtRange(next.start, next.end)}
              </div>
            </a>
            <span className="badge ok">{fmtDuration(next.minutes)}</span>
          </li>
          <li>
            <a href={`/group/${group.id}?day=${longest.date}#day-detail`}>
              <div className="who">Longest</div>
              <div className="when">
                {whenLabel(longest, today)} · {fmtRange(longest.start, longest.end)}
              </div>
            </a>
            <span className="badge ok">{fmtDuration(longest.minutes)}</span>
          </li>
        </ul>
      ) : (
        <div className="empty" style={{ padding: 0 }}>
          There&apos;s no time in this period when all {insights.memberCount} of you are free for {fmtDuration(group.minBlockMinutes)} in a row.{' '}
          {isOrganiser ? 'A shorter minimum block or longer period may help.' : ''}
        </div>
      )}
    </div>
  );
}

export function RunnerUpsCard({ group, insights, today, names, meId }: { group: PlannerGroup; insights: GroupInsights; today: ISODate; names: Names; meId?: string }) {
  return (
    <div className="card">
      <h4>Other good times</h4>
      {insights.runnerUps.length === 0 ? (
        <div className="empty" style={{ padding: 0 }}>No other days stand out.</div>
      ) : (
        <ul className="slot-list">
          {insights.runnerUps.map((w) => (
            <li key={`${w.date}-${w.start}`}>
              <a href={`/group/${group.id}?day=${w.date}#day-detail`}>
                <div className="when">
                  {whenLabel(w, today)} · {fmtRange(w.start, w.end)}
                </div>
                <div className="who">
                  {w.everyone
                    ? 'Everyone'
                    : w.busyUserIds.length <= 2
                      ? `Missing ${w.busyUserIds.map((id) => `${names[id] ?? 'someone'}${id === meId ? ' (you)' : ''}`).join(', ')}`
                      : `${w.freeUserIds.length} free`}
                </div>
              </a>
              <span className="badge p-medium">
                {w.freeUserIds.length}/{insights.memberCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bars({ rows, max, unit }: { rows: { label: string; value: number; best: boolean }[]; max: number; unit: string }) {
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className={`bar-row${r.best ? ' best' : ''}`} key={r.label}>
          <span className="bar-label">{r.label}</span>
          <div className="bar-track" role="img" aria-label={`${r.label}: ${r.value.toFixed(1)} of ${max} ${unit}`}>
            <div className="bar-fill" style={{ width: `${max > 0 ? Math.min(100, (r.value / max) * 100) : 0}%` }} />
          </div>
          <span className="bar-val">{r.value.toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}

export function PatternsCard({ insights, group }: { insights: GroupInsights; group: PlannerGroup }) {
  const hasWeekdays = insights.weekdays.length > 0;
  const hasDayparts = insights.dayparts.length > 0;
  if (!hasWeekdays && !hasDayparts) return null;

  // Monday-first order for display
  const order = [1, 2, 3, 4, 5, 6, 0];
  const weekdayRows = order
    .map((dow) => insights.weekdays.find((w) => w.dayOfWeek === dow))
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w) => ({ label: weekdayName(w.dayOfWeek, false), value: w.avgPeakCount, best: insights.bestWeekday?.dayOfWeek === w.dayOfWeek }));
  const daypartRows = insights.dayparts.map((d) => ({ label: d.label, value: d.avgPeakCount, best: insights.bestDaypart?.name === d.name }));

  return (
    <div className="card">
      <h4>Patterns</h4>
      <p className="subtitle" style={{ margin: '0 0 14px' }}>
        {insights.bestWeekday ? (
          <>
            <strong style={{ color: 'var(--text)' }}>{weekdayName(insights.bestWeekday.dayOfWeek)}s</strong> work best
          </>
        ) : null}
        {insights.bestWeekday && insights.bestDaypart ? ' and ' : ''}
        {insights.bestDaypart ? (
          <>
            <strong style={{ color: 'var(--text)' }}>{insights.bestDaypart.label.toLowerCase()}</strong> are the best time of day
          </>
        ) : null}
        {insights.bestWeekday || insights.bestDaypart ? '.' : ''} Bars show how many members can typically be free together for {fmtDuration(group.minBlockMinutes)}+ (out of {insights.memberCount}).
      </p>
      <div className="grid-2" style={{ gap: 24 }}>
        {hasWeekdays ? (
          <div>
            <h4>By weekday</h4>
            <Bars rows={weekdayRows} max={insights.memberCount} unit="members" />
          </div>
        ) : null}
        {hasDayparts ? (
          <div>
            <h4>By time of day</h4>
            <Bars rows={daypartRows} max={insights.memberCount} unit="members" />
            <p className="hint">Mornings 05–12 · afternoons 12–17 · evenings 17–22</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Honest note about members whose hours are guessed (they haven't set Availability yet). */
export function DefaultsNotice({ usingDefaults, names, meId }: { usingDefaults: string[]; names: Names; meId?: string }) {
  if (usingDefaults.length === 0) return null;
  const me = meId && usingDefaults.includes(meId);
  const others = usingDefaults.filter((id) => id !== meId).map((id) => names[id] ?? 'Someone');
  return (
    <div className="notice warn">
      {me ? (
        <>
          <strong>You haven&apos;t set your available hours</strong>, so typical default hours are assumed for you. <a href="/settings?section=availability">Set them</a> so these results are accurate.{' '}
        </>
      ) : null}
      {others.length > 0 ? (
        <>
          {others.join(', ')} {others.length === 1 ? "hasn't" : "haven't"} set their available hours yet, so default hours are assumed for them — results will sharpen once they do.
        </>
      ) : null}
    </div>
  );
}

/** One day, up close: best slot, when everyone overlaps, and each member's free windows. */
export function DayDetail({
  group,
  date,
  day,
  roster,
  names,
  meId,
  today,
}: {
  group: PlannerGroup;
  date: ISODate;
  day: GroupDay | undefined;
  roster: GroupMember[];
  names: Names;
  meId?: string;
  today: ISODate;
}) {
  const ids = roster.map((m) => m.id);
  let body: ReactNode;

  if (!day) {
    body = <div className="empty" style={{ padding: 0 }}>{date < today ? 'That day has already passed.' : 'That day is outside the current planning period.'}</div>;
  } else {
    const peak = peakWindowForDay(day, ids, group.minBlockMinutes);
    const everyone = everyoneWindowsForDay(day, ids, group.minBlockMinutes);
    body = (
      <>
        {peak ? (
          <div style={{ marginBottom: 14 }}>
            <div className="who muted" style={{ fontSize: 12 }}>Best slot</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              {fmtRange(peak.start, peak.end)} <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {peak.freeUserIds.length} of {roster.length} free · {fmtDuration(peak.minutes)}</span>
            </div>
            <Chips w={peak} names={names} meId={meId} />
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>Nobody has a free block of {fmtDuration(group.minBlockMinutes)} or more on this day.</p>
        )}
        <div style={{ marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Everyone free</div>
          {everyone.length === 0 ? (
            <span className="muted">No shared window.</span>
          ) : (
            <span>{everyone.map((r) => fmtRange(r.start, r.end)).join(' · ')}</span>
          )}
        </div>
        <h4>Each member&apos;s free time</h4>
        <div>
          {roster.map((m) => {
            const free = day.freeByUser[m.id] ?? [];
            return (
              <div className="member-row" key={m.id}>
                <span>
                  {names[m.id]}
                  {m.id === meId ? ' (you)' : ''}
                </span>
                <span className="times">{free.length === 0 ? 'No free time' : free.map((r) => fmtRange(r.start, r.end)).join(', ')}</span>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="card day-detail" id="day-detail" style={{ scrollMarginTop: 16 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{fmtDayLong(date)}</h3>
        <a className="btn small" href={`/group/${group.id}`}>
          Close
        </a>
      </div>
      {body}
    </div>
  );
}

export function periodLabel(group: PlannerGroup, period: ResolvedPeriod): string {
  const range = `${fmtDate(period.start)} – ${fmtDate(period.end)}`;
  if (group.periodKind === 'custom') return range;
  const kindLabel: Record<string, string> = {
    week: 'week',
    two_weeks: '2 weeks',
    month: 'month',
    two_months: '2 months',
    quarter: '3 months',
    half_year: '6 months',
    year: 'year',
  };
  if (period.rolling) return `Next ${kindLabel[group.periodKind]} (rolling)`;
  return `${range} (${kindLabel[group.periodKind]})`;
}

