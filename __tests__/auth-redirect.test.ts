import { describe, it, expect } from 'vitest';
import { safeNextPath } from '../src/lib/auth-redirect.js';

describe('safeNextPath (post-login redirect target)', () => {
  it('allows ordinary same-site paths, including query strings', () => {
    expect(safeNextPath('/week')).toBe('/week');
    expect(safeNextPath('/group/abc?day=2026-09-26#day-detail')).toBe('/group/abc?day=2026-09-26#day-detail');
    expect(safeNextPath('/')).toBe('/');
  });

  it('falls back to the home page when there is no target', () => {
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath('   ')).toBe('/');
  });

  it('rejects anything that could leave the site (open-redirect attempts)', () => {
    for (const bad of [
      'https://evil.example',
      'http://evil.example/x',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      'week', // relative, no leading slash
      '/ok\nSet-Cookie: x=1',
      '/a\tb',
    ]) {
      expect(safeNextPath(bad), bad).toBe('/');
    }
  });

  it("doesn't bounce back into the login page", () => {
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath('/login?error=x')).toBe('/');
    expect(safeNextPath('/login/anything')).toBe('/');
  });

  it('honours a custom fallback', () => {
    expect(safeNextPath('https://evil.example', '/groups')).toBe('/groups');
  });
});
