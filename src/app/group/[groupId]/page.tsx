import * as repo from '@/lib/repository';
import { findGroupAvailability, getGroupOverview } from '@/lib/group-finder';
import { getCurrentUser } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { addDays } from '@/lib/engine/time-utils';
import { clampRange } from '@/lib/engine/group-period';
import type { DayHeat } from '@/lib/engine/group-insights';
import type { ISODate } from '@/lib/engine/types';
import { fmtDay, fmtDuration, plural, tzShortLabel } from '@/lib/format';
import { GroupCalendar } from '@/app/components/GroupCalendar';
import {
  BestTimeHero,
  DayDetail,
  DefaultsNotice,
  EveryoneCard,
  PatternsCard,
  RunnerUpsCard,
  StatTiles,
  namesOf,
  periodLabel,
} from '@/app/components/GroupPanels';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string | undefined): ISODate | undefined => (v && DATE_RE.test(v) ? v : undefined);

interface SearchParams {
  day?: string;
  search?: string;
  people?: string | string[];
  from?: string;
  to?: string;
  minMinutes?: string;
  notice?: string;
  error?: string;
}

export default async function GroupPage({ params, searchParams }: { params: { groupId: string }; searchParams: SearchParams }) {
  const me = await getCurrentUser();
  const group = await repo.getGroup(params.groupId);
  if (!group) notFound(); // also covers "you're not an active member" since RLS hides groups you're not in

  const roster = await repo.getGroupRoster(params.groupId);
  const isOrganiser = group.organiserId === me?.id;

  const [overview, requests] = await Promise.all([
    getGroupOverview(group, roster),
    isOrganiser ? repo.listJoinRequests(group.id) : Promise.resolve([]),
  ]);
  const { period, insights, days, now, usingDefaults } = overview;
  const names = namesOf(roster);
  const perDay = new Map<ISODate, DayHeat>((insights?.perDay ?? []).map((d) => [d.date, d]));
  const selectedDay = validDate(searchParams.day);
  const organiser = roster.find((m) => m.isOrganiser);

  // ---- Custom search (only computed when the form was submitted) ----
  const searching = searchParams.search === '1';
  const rosterIds = new Set(roster.map((m) => m.id));
  const chosen = searchParams.people == null ? roster.map((m) => m.id) : (Array.isArray(searchParams.people) ? searchParams.people : [searchParams.people]).filter((id) => rosterIds.has(id));
  const searchFrom = validDate(searchParams.from) ?? now.date;
  const searchRange = clampRange(searchFrom, validDate(searchParams.to) ?? addDays(searchFrom, 6));
  const searchMin = Math.min(720, Math.max(5, Number(searchParams.minMinutes) || group.minBlockMinutes));
  const searchResults = searching && chosen.length > 0 ? await findGroupAvailability(group.id, chosen, searchRange.from, searchRange.to, searchMin, now) : [];

  return (
    <div>
      <div className="page-head">
        <div className="spread">
          <h2 style={{ margin: 0 }}>{group.name}</h2>
          {isOrganiser ? (
            <a className="btn small" href={`/group/${group.id}/manage`}>
              Manage group
            </a>
          ) : null}
        </div>
        <div className="meta-row">
          {isOrganiser ? <span className="badge organiser">You&apos;re the organiser</span> : organiser ? <span>Organiser: {names[organiser.id]}</span> : null}
          <span>{plural(roster.length, 'member')}</span>
          <span>Planning: {periodLabel(group, period)}</span>
        </div>
        <div className="meta-row">
          <span>
            Invite code <code>{group.inviteCode}</code>
          </span>
          <span>Min. block {fmtDuration(group.minBlockMinutes)}</span>
          <span>Times in {tzShortLabel(group.timezone)}</span>
        </div>
      </div>

      {searchParams.error ? <div className="notice error">{searchParams.error}</div> : null}
      {searchParams.notice ? <div className="notice ok">{searchParams.notice}</div> : null}

      {isOrganiser && requests.length > 0 ? (
        <div className="notice warn">
          <strong>{plural(requests.length, 'person', 'people')}</strong> {requests.length === 1 ? 'is' : 'are'} waiting to join. <a href={`/group/${group.id}/manage#requests`}>Review {requests.length === 1 ? 'request' : 'requests'}</a>
        </div>
      ) : null}

      {period.upcoming && !period.ended ? (
        <div className="notice ok">This planning period starts on {fmtDay(period.start)}.</div>
      ) : null}

      <BestTimeHero
        group={group}
        insights={insights}
        period={period}
        roster={roster}
        names={names}
        today={now.date}
        isOrganiser={isOrganiser}
        meId={me?.id}
      />

      <DefaultsNotice usingDefaults={usingDefaults} names={names} meId={me?.id} />

      {insights && roster.length >= 2 ? (
        <>
          <StatTiles insights={insights} memberCount={roster.length} />
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <EveryoneCard group={group} insights={insights} today={now.date} isOrganiser={isOrganiser} />
            <RunnerUpsCard group={group} insights={insights} today={now.date} names={names} meId={me?.id} />
          </div>
          <PatternsCard insights={insights} group={group} />
        </>
      ) : null}

      {selectedDay ? (
        <DayDetail
          group={group}
          date={selectedDay}
          day={days.find((d) => d.date === selectedDay)}
          roster={roster}
          names={names}
          meId={me?.id}
          today={now.date}
        />
      ) : null}

      {!period.ended ? (
        <div className="card">
          <h4>Calendar</h4>
          <p className="subtitle" style={{ margin: '0 0 14px' }}>
            Tap a day to see who&apos;s free when. &ldquo;3/5&rdquo; means three of five members can be free together for {fmtDuration(group.minBlockMinutes)}+.
          </p>
          <GroupCalendar groupId={group.id} period={period} perDay={perDay} memberCount={roster.length} today={now.date} selected={selectedDay} />
        </div>
      ) : null}

      <details className="panel" open={searching}>
        <summary>Custom search</summary>
        <div className="panel-body">
          <p className="subtitle" style={{ marginTop: 0 }}>Pick specific people and any date range (up to 400 days) to find when just those people are all free.</p>
          <form method="get">
            <input type="hidden" name="search" value="1" />
            <fieldset>
              <legend>Who</legend>
              <div className="stack" style={{ marginTop: 6 }}>
                {roster.map((p) => (
                  <label key={p.id} className="check-row">
                    <input type="checkbox" name="people" value={p.id} defaultChecked={chosen.includes(p.id)} />
                    {names[p.id]}
                    {p.id === me?.id ? ' (you)' : ''}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-grid">
              <div>
                <label htmlFor="from">From</label>
                <input id="from" name="from" type="date" defaultValue={searchRange.from} />
              </div>
              <div>
                <label htmlFor="to">To</label>
                <input id="to" name="to" type="date" defaultValue={searchRange.to} />
              </div>
              <div className="full">
                <label htmlFor="minMinutes">Minimum block (minutes)</label>
                <input id="minMinutes" name="minMinutes" type="number" inputMode="numeric" min={5} max={720} defaultValue={searchMin} />
              </div>
            </div>
            <div className="actions">
              <button className="primary" type="submit">
                Find common free time
              </button>
            </div>
          </form>

          {searching ? (
            chosen.length === 0 ? (
              <div className="empty">Pick at least one person above.</div>
            ) : (
              <div style={{ marginTop: 8 }}>
                {searchRange.clamped ? <div className="notice warn">That range was longer than 400 days, so it was shortened to end on {fmtDay(searchRange.to)}.</div> : null}
                <ul className="slot-list">
                  {searchResults.map((day) => (
                    <li key={day.date}>
                      <div style={{ flex: 1 }}>
                        <div className="when">{fmtDay(day.date)}</div>
                        <div className="who">
                          {day.commonFree.length === 0
                            ? `No common window of ${searchMin}+ min${day.fullyBusyUserIds.length > 0 ? ' — someone has no free time at all' : ''}`
                            : day.commonFree.map((w) => `${w.start}–${w.end} (${fmtDuration(w.minutes)})`).join(' · ')}
                        </div>
                      </div>
                      {day.commonFree.length > 0 ? <span className="badge ok">{plural(day.commonFree.length, 'window')}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </div>
      </details>

      <details className="panel">
        <summary>Members ({roster.length})</summary>
        <div className="panel-body">
          <div className="list" style={{ marginBottom: 0 }}>
            {roster.map((m) => (
              <div className="list-item" key={m.id}>
                <div className="grow">
                  <div className="title">
                    {names[m.id]}
                    {m.id === me?.id ? ' (you)' : ''} {m.isOrganiser ? <span className="badge organiser">Organiser</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
