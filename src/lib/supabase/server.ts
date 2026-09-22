import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a Supabase client scoped to the current request's session
 * cookies, using the public anon key. Row Level Security policies (see
 * supabase/schema.sql) are what actually enforce per-user access — this
 * client just carries the signed-in user's identity (JWT) to Postgres so
 * `auth.uid()` resolves correctly in those policies. Never swap this for
 * a service-role client in normal app code; that would bypass RLS.
 *
 * Must be called fresh per request (cookies() is request-scoped), so this
 * is a function, not a module-level singleton.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables. Copy .env.local.example to .env.local and fill them in (see README).',
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component render (not an Action/Route
          // Handler) — cookies can't be set there. Session refresh for
          // that case is handled by middleware.ts instead, so this is
          // safe to ignore.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // See note above.
        }
      },
    },
  });
}

/**
 * Returns the signed-in user's id. Every repository read/write path uses this
 * to scope data to the caller (and stamp `owner_id`).
 *
 * If there is no session it sends the visitor to /login rather than throwing:
 * middleware normally catches signed-out requests first, but a session can
 * still expire between the middleware check and a server action, and that
 * must never surface as a 500 "Not signed in" error page.
 */
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireUserId(): Promise<string> {
  return (await requireUser()).id;
}

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
