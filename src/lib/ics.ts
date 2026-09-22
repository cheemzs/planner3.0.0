/**
 * Minimal hand-rolled iCalendar (RFC 5545) writer -- no dependency needed
 * for something this small. Used by:
 *  - src/app/api/ics/[token]/route.ts   (public subscribe feed)
 *  - src/app/api/schedule/export/route.ts (authenticated one-off download)
 *
 * Times are emitted as "floating" local date-times (no TZID, no trailing Z)
 * because the app's own data model has no timezone attached to a block's
 * start/end (see src/lib/engine/types.ts) -- it's always the signed-in
 * person's own wall-clock time. Calendar apps interpret a floating time in
 * the viewer's local timezone, which matches how this app already treats
 * times everywhere else.
 */

export interface IcsEventRow {
  id: string;
  date: string; // "YYYY-MM-DD"
  start: string; // "HH:mm"
  end: string; // "HH:mm"
  type: string;
  title: string;
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcsDateTime(date: string, time: string): string {
  const [h, m] = time.split(':');
  return `${date.replace(/-/g, '')}T${h.padStart(2, '0')}${(m ?? '00').padStart(2, '0')}00`;
}

function icsStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(
    now.getUTCSeconds(),
  )}Z`;
}

export function buildIcsCalendar(rows: IcsEventRow[], calendarName: string): string {
  const stamp = icsStamp(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Planner//Schedule Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
  ];

  for (const row of rows) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${row.id}@planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDateTime(row.date, row.start)}`,
      `DTEND:${toIcsDateTime(row.date, row.end)}`,
      `SUMMARY:${escapeIcsText(row.title)}`,
      `CATEGORIES:${escapeIcsText(row.type)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
