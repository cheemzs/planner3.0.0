import { APP_TIMEZONE, dayOfWeek, minutesToTime, parseDate } from './engine/time-utils';
import type { ISODate } from './engine/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Sat 3 Oct" */
export function fmtDay(date: ISODate): string {
  const d = parseDate(date);
  return `${WEEKDAYS[dayOfWeek(date)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Saturday 3 October 2026" */
export function fmtDayLong(date: ISODate): string {
  const d = parseDate(date);
  return `${WEEKDAYS_LONG[dayOfWeek(date)]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "3 Oct 2026" */
export function fmtDate(date: ISODate): string {
  const d = parseDate(date);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "October 2026" */
export function fmtMonthTitle(date: ISODate): string {
  const d = parseDate(date);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function weekdayName(dow: number, long = true): string {
  return (long ? WEEKDAYS_LONG : WEEKDAYS)[dow];
}

/** "14:00–17:00" */
export function fmtRange(startMin: number, endMin: number): string {
  return `${minutesToTime(startMin)}–${minutesToTime(endMin)}`;
}

/** 150 -> "2h 30m", 45 -> "45m", 120 -> "2h" */
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Total minutes as decimal hours, e.g. 750 -> "12.5h" */
export function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** What other people see for a member. Never falls back to an email address. */
export function memberName(m: { displayName: string | null }): string {
  return m.displayName?.trim() || 'Unnamed member';
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Short zone label for times: "SGT" for Singapore, otherwise the runtime's short name (e.g. "GMT+9"). */
export function tzShortLabel(tz: string): string {
  if (tz === APP_TIMEZONE) return 'SGT';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Label for a timezone <option>: "Singapore (SGT)" for the default, else the IANA name with spaces. */
export function tzOptionLabel(tz: string): string {
  return tz === APP_TIMEZONE ? 'Singapore (SGT)' : tz.replace(/_/g, ' ');
}
