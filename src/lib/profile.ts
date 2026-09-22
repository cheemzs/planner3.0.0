/**
 * Display-name rules. The same limits are enforced in Postgres
 * (planner_profiles_display_name_len), so a hand-crafted API call can't
 * bypass them -- this module just gives users a friendly message first.
 */
export const DISPLAY_NAME_MAX = 40;

export type DisplayNameResult = { ok: true; value: string } | { ok: false; error: string };

// Control characters plus invisible / bidi-override characters that could be
// used to make one person's name look like someone else's.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

export function validateDisplayName(raw: string): DisplayNameResult {
  // Collapse any run of whitespace (incl. tabs/newlines) to one space, then trim.
  const value = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (value.length === 0) return { ok: false, error: 'Enter a display name.' };
  if (FORBIDDEN.test(value)) return { ok: false, error: "Display names can't contain invisible or control characters." };
  if (Array.from(value).length > DISPLAY_NAME_MAX) return { ok: false, error: `Display names can be at most ${DISPLAY_NAME_MAX} characters.` };
  return { ok: true, value };
}
