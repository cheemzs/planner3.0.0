import type {
  AvailabilityConfig,
  DayAvailability,
  ISODate,
  PlanEvent,
  ScheduleBlock,
} from './types';
import {
  type MinuteRange,
  dayOfWeek,
  rangesOverlap,
  subtractRanges,
  timeToMinutes,
  totalMinutes,
} from './time-utils';

/** Resolves which DayAvailability template applies to a given date. */
export function resolveDayAvailability(config: AvailabilityConfig, date: ISODate): DayAvailability {
  const dow = dayOfWeek(date);
  const specific = config.perWeekday?.find((d) => d.dayOfWeek === dow);
  return specific ?? config.default;
}

/** Does an event or its recurrence rule apply on `date`? */
export function eventOccursOn(event: PlanEvent, date: ISODate): boolean {
  if (!event.recurrence) return event.date === date;
  if (date < event.date) return false;
  if (event.recurrence.until && date > event.recurrence.until) return false;
  return event.recurrence.daysOfWeek.includes(dayOfWeek(date));
}

export function eventsOnDate(events: PlanEvent[], date: ISODate): PlanEvent[] {
  return events.filter((e) => eventOccursOn(e, date));
}

/**
 * Raw work-window capacity for a date, before subtracting fixed events, breaks,
 * or already-scheduled blocks. This is "how much of the day could ever be used".
 */
export function baseWorkWindows(config: AvailabilityConfig, date: ISODate): MinuteRange[] {
  const override = config.overrides?.find((o) => o.date === date);
  if (override?.unavailable) return [];
  if (override?.workWindows) {
    return override.workWindows.map((w) => ({ start: timeToMinutes(w.start), end: timeToMinutes(w.end) }));
  }
  const template = resolveDayAvailability(config, date);
  return template.workWindows.map((w) => ({ start: timeToMinutes(w.start), end: timeToMinutes(w.end) }));
}

export interface FreeTimeOptions {
  /** Exclude minutes before this time-of-day (minutes since midnight), e.g. to mask out the past for "today". */
  notBeforeMinutes?: number;
}

/**
 * Computes the actual free minute-ranges for a date: work windows minus
 * recurring breaks, minus fixed+flexible events already on the calendar,
 * minus anything already occupying the schedule (including previously
 * auto-scheduled task blocks, so the planner never double-books itself).
 */
export function computeFreeWindows(
  config: AvailabilityConfig,
  date: ISODate,
  events: PlanEvent[],
  existingBlocks: ScheduleBlock[],
  options: FreeTimeOptions = {},
): MinuteRange[] {
  const template = resolveDayAvailability(config, date);
  let free = baseWorkWindows(config, date);

  const breaks: MinuteRange[] = template.breaks.map((b) => ({
    start: timeToMinutes(b.start),
    end: timeToMinutes(b.end),
  }));

  const dayEvents = eventsOnDate(events, date).map((e) => ({
    start: timeToMinutes(e.start),
    end: timeToMinutes(e.end),
  }));

  const dayBlocks = existingBlocks
    .filter((b) => b.date === date)
    .map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));

  const busy = [...breaks, ...dayEvents, ...dayBlocks];
  free = subtractRanges(free, busy);

  if (options.notBeforeMinutes != null) {
    free = subtractRanges(free, [{ start: 0, end: options.notBeforeMinutes }]);
  }

  return free.sort((a, b) => a.start - b.start);
}

export function totalFreeMinutes(
  config: AvailabilityConfig,
  date: ISODate,
  events: PlanEvent[],
  existingBlocks: ScheduleBlock[],
  options: FreeTimeOptions = {},
): number {
  return totalMinutes(computeFreeWindows(config, date, events, existingBlocks, options));
}

/** Checks whether a candidate range collides with any fixed (non-movable) event on that date. */
export function collidesWithFixedEvent(
  events: PlanEvent[],
  date: ISODate,
  range: MinuteRange,
): PlanEvent | undefined {
  return eventsOnDate(events, date)
    .filter((e) => e.fixed)
    .find((e) => rangesOverlap(range, { start: timeToMinutes(e.start), end: timeToMinutes(e.end) }));
}

export function defaultAvailability(): AvailabilityConfig {
  return {
    default: {
      wake: '07:00',
      sleep: '23:00',
      workWindows: [{ start: '16:00', end: '22:00', label: 'evening' }],
      breaks: [{ start: '18:00', end: '18:30', label: 'evening' }],
    },
    perWeekday: [
      {
        dayOfWeek: 0,
        wake: '08:00',
        sleep: '23:30',
        workWindows: [{ start: '10:00', end: '22:00', label: 'any' }],
        breaks: [{ start: '13:00', end: '14:00', label: 'afternoon' }],
      },
      {
        dayOfWeek: 6,
        wake: '08:00',
        sleep: '23:30',
        workWindows: [{ start: '10:00', end: '22:00', label: 'any' }],
        breaks: [{ start: '13:00', end: '14:00', label: 'afternoon' }],
      },
    ],
    overrides: [],
    targetUtilization: 0.75,
    bufferMinutes: 10,
  };
}
