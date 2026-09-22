import { isValidTimezone } from './engine/group-period';
import { APP_TIMEZONE } from './engine/time-utils';

/**
 * Some runtimes (Node/ICU) still report legacy IANA names such as
 * "Asia/Calcutta" or "Europe/Kiev", which current Postgres tz databases
 * no longer list -- so saving one would fail server-side with "Unknown
 * timezone". Map them to their modern canonical names everywhere a
 * timezone enters the app (list, geo-header guess, form posts).
 */
const LEGACY_TO_CANONICAL: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

export function canonicalTimezone(tz: string): string {
  return LEGACY_TO_CANONICAL[tz] ?? tz;
}

/** All IANA timezones the runtime knows (canonical names), plus UTC first, then sorted. */
export function allTimezones(): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['Asia/Singapore', 'Asia/Tokyo', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
  }
  const set = new Set(zones.map(canonicalTimezone).filter(isValidTimezone));
  set.add('UTC');
  set.delete(APP_TIMEZONE);
  return [APP_TIMEZONE, ...[...set].sort((a, b) => a.localeCompare(b))];
}
