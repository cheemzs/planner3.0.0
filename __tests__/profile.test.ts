import { describe, it, expect } from 'vitest';
import { DISPLAY_NAME_MAX, validateDisplayName } from '../src/lib/profile.js';

describe('validateDisplayName', () => {
  it('accepts ordinary names and returns them trimmed', () => {
    expect(validateDisplayName('Alice')).toEqual({ ok: true, value: 'Alice' });
    expect(validateDisplayName('  Alice Tan  ')).toEqual({ ok: true, value: 'Alice Tan' });
    expect(validateDisplayName('陈小明')).toEqual({ ok: true, value: '陈小明' });
    expect(validateDisplayName("Ah Boy (Study Grp)")).toEqual({ ok: true, value: 'Ah Boy (Study Grp)' });
  });

  it('collapses internal whitespace runs, including tabs and newlines', () => {
    expect(validateDisplayName('Alice   \t Tan\n')).toEqual({ ok: true, value: 'Alice Tan' });
  });

  it('rejects empty / whitespace-only names', () => {
    expect(validateDisplayName('')).toMatchObject({ ok: false });
    expect(validateDisplayName('    ')).toMatchObject({ ok: false });
    expect(validateDisplayName('\n\t')).toMatchObject({ ok: false });
  });

  it('enforces the length limit by characters, not UTF-16 units', () => {
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true });
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1))).toMatchObject({ ok: false });
    // an emoji is 1 character but 2 UTF-16 units; 40 of them must still be accepted
    expect(validateDisplayName('😀'.repeat(DISPLAY_NAME_MAX))).toMatchObject({ ok: true });
    expect(validateDisplayName('😀'.repeat(DISPLAY_NAME_MAX + 1))).toMatchObject({ ok: false });
  });

  it('rejects invisible / control / bidi-override characters (name spoofing)', () => {
    for (const bad of ['Al\u200bice', 'Alice\u202e', '\u0007Alice', 'Ali\u2066ce']) {
      expect(validateDisplayName(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });
  it('treats a stray byte-order mark like whitespace: it is stripped, never saved', () => {
    expect(validateDisplayName('\ufeffAlice')).toEqual({ ok: true, value: 'Alice' });
    expect(validateDisplayName('Al\ufeffice')).toEqual({ ok: true, value: 'Al ice' });
  });

  it('never returns a value containing invisible or control characters (sweep of U+0000-U+20FF)', () => {
    const invisible = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
    for (let cp = 0; cp < 0x2100; cp++) {
      const r = validateDisplayName(`A${String.fromCharCode(cp)}B`);
      if (r.ok) expect(invisible.test(r.value), `U+${cp.toString(16)}`).toBe(false);
    }
  });
});
