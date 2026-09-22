/**
 * Post-login redirect targets come from a query string (`/login?next=...`),
 * i.e. from whoever built the link. Only ever follow a same-site path,
 * otherwise `?next=https://evil.example` turns the login page into an open
 * redirect. Anything suspicious falls back to `fallback` (the home page).
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback;
  const v = raw.trim();
  if (!v.startsWith('/')) return fallback; // absolute URLs, "javascript:", bare hostnames
  if (v.startsWith('//')) return fallback; // protocol-relative: //evil.example
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback; // control chars; backslash ("/\evil.example" is treated as "//evil.example" by browsers)
  if (v === '/login' || v.startsWith('/login/') || v.startsWith('/login?')) return fallback; // don't bounce back into the login page
  return v;
}
