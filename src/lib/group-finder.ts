import * as repo from './repository';
import { baseWorkWindows, resolveDayAvailability } from './engine/availability';
import { intersectRanges, subtractRanges, timeToMinutes, minutesToTime, addDays, daysBetween, type MinuteRange } from './engine/time-utils';
import { analyzeGroup, mergeRanges, type GroupDay, type GroupInsights } from './engine/group-insights';
import { clampRange, nowInTimezone, resolvePeriod, type ResolvedPeriod } from './engine/group-period';
import type { AvailabilityConfig, ISODate } from './engine/types';

export interface CommonFreeWindow {
  start: string;
  end: string;
  minutes: number;
}

export interface DayAvailabilityResult {
  date: ISODate;
  commonFree: CommonFreeWindow[];
  /** Which requested users have zero free time at all this day (useful for "X can't make any day this week" style messaging). */
  fullyBusyUserIds: string[];
}

/** "Right now" in the group's timezone; anything earlier today is treated as unavailable so we never suggest a time that has passed. */
export interface NowMarker {
  date: ISODate;
  minutes: number;
}

function freeWindowsForUser(config: AvailabilityConfig, date: ISODate, busyForDate: MinuteRange[], now?: NowMarker): MinuteRange[] {
  const workRanges = baseWorkWindows(config, date);
  const template = resolveDayAvailability(config, date);
  const breakRanges = template.breaks.map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));
  const past: MinuteRange[] = now && date === now.date ? [{ start: 0, end: now.minutes }] : [];
  return mergeRanges(subtractRanges(workRanges, [...breakRanges, ...busyForDate, ...past]));
}

function enumerateDates(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

export interface GroupFreeTime {
  days: GroupDay[];
  /** Members who haven't set up their availability, so default hours were assumed for them. */
  usingDefaults: string[];
}

/**
 * Loads each requested member's free time for every day in [from, to]: their
 * own configured hours minus their own breaks and busy time. Scoped to one
 * group -- the Postgres functions verify the caller and every requested
 * person are ACTIVE members of `groupId` before returning anything, and even
 * then only busy TIME RANGES come back, never task/event titles or content.
 * The range is clamped (see MAX_RANGE_DAYS) so nobody can request an
 * unbounded computation.
 */
export async function loadGroupFreeTime(
  groupId: string,
  userIds: string[],
  from: ISODate,
  to: ISODate,
  now?: NowMarker,
): Promise<GroupFreeTime> {
  if (userIds.length === 0) return { days: [], usingDefaults: [] };
  const range = clampRange(from, to);

  const [availability, busyTimes] = await Promise.all([
    repo.getGroupAvailability(groupId, userIds),
    repo.getGroupBusyTimes(groupId, userIds, range.from, range.to),
  ]);

  const busyByUserAndDate = new Map<string, MinuteRange[]>();
  for (const b of busyTimes) {
    const key = `${b.ownerId}|${b.date}`;
    const arr = busyByUserAndDate.get(key) ?? [];
    arr.push({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) });
    busyByUserAndDate.set(key, arr);
  }

  const days: GroupDay[] = enumerateDates(range.from, range.to).map((date) => {
    const freeByUser: Record<string, MinuteRange[]> = {};
    for (const userId of userIds) {
      const config = availability.byUser.get(userId)!;
      freeByUser[userId] = freeWindowsForUser(config, date, busyByUserAndDate.get(`${userId}|${date}`) ?? [], now);
    }
    return { date, freeByUser };
  });

  return { days, usingDefaults: availability.usingDefaults };
}

/**
 * Custom search: for every day in [from, to], the windows where *all*
 * `userIds` are simultaneously free (at least `minMinutes` long).
 */
export async function findGroupAvailability(
  groupId: string,
  userIds: string[],
  from: ISODate,
  to: ISODate,
  minMinutes = 30,
  now?: NowMarker,
): Promise<DayAvailabilityResult[]> {
  const { days } = await loadGroupFreeTime(groupId, userIds, from, to, now);
  return days.map((day) => {
    const perUserFree = userIds.map((id) => day.freeByUser[id] ?? []);
    const common = intersectRanges(perUserFree).filter((r) => r.end - r.start >= minMinutes);
    return {
      date: day.date,
      commonFree: common.map((r) => ({ start: minutesToTime(r.start), end: minutesToTime(r.end), minutes: r.end - r.start })),
      fullyBusyUserIds: userIds.filter((id) => (day.freeByUser[id] ?? []).length === 0),
    };
  });
}

export interface GroupOverview {
  now: NowMarker;
  period: ResolvedPeriod;
  /** Per-day free time for every active member, from `period.planFrom` to `period.end` (empty if the period has ended). */
  days: GroupDay[];
  /** Null when the period has ended or there is nobody to analyse. */
  insights: GroupInsights | null;
  usingDefaults: string[];
}

/**
 * Everything the group home page shows every member: the resolved planning
 * window plus the insights ("best time for the group", weekday/time-of-day
 * patterns, ...). All active members are analysed, and all of them see the
 * same result, so there's a single shared answer to "when should we meet?".
 */
export async function getGroupOverview(group: repo.PlannerGroup, roster: repo.GroupMember[]): Promise<GroupOverview> {
  const now = nowInTimezone(group.timezone);
  const period = resolvePeriod({ kind: group.periodKind, start: group.periodStart, end: group.periodEnd }, now.date);

  if (period.ended || roster.length === 0) {
    return { now, period, days: [], insights: null, usingDefaults: [] };
  }

  const memberIds = roster.map((m) => m.id);
  const { days, usingDefaults } = await loadGroupFreeTime(group.id, memberIds, period.planFrom, period.end, now);
  const insights = analyzeGroup(days, memberIds, { minMinutes: group.minBlockMinutes });
  return { now, period, days, insights, usingDefaults };
}
