/**
 * Helpers for server actions that should report failure on the page
 * (a banner) rather than crash into Next's generic error screen.
 *
 * NOTE: next/navigation's redirect() works by throwing, so it must never be
 * called inside the try/catch below -- run the work with attempt(), then
 * redirect afterwards.
 */

/** redirect() / notFound() are implemented by throwing; those must propagate, not be reported as errors. */
function isNextControlFlow(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'));
}

export async function attempt(work: () => Promise<unknown>): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
  }
}

export function withMessage(path: string, kind: 'notice' | 'error', message: string): string {
  const [base, hash] = path.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${kind}=${encodeURIComponent(message)}${hash ? `#${hash}` : ''}`;
}

export function formString(fd: FormData, key: string): string {
  return (fd.get(key) ?? '').toString().trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Returns the ISO date, null if blank, or throws on a malformed value. */
export function formOptionalDate(fd: FormData, key: string, label: string): string | null {
  const v = formString(fd, key);
  if (!v) return null;
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T12:00:00Z'))) throw new Error(`${label} isn't a valid date`);
  return v;
}
