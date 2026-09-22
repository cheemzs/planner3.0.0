import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs on every request (see `config.matcher`). It does two jobs:
 *   1. refreshes the Supabase session cookies, and
 *   2. keeps signed-out visitors on /login and signed-in users off it.
 *
 * NOTE: this file must live at `src/middleware.ts` because the app uses a
 * `src/` directory. A `middleware.ts` in the project root is silently
 * ignored by Next.js in that setup, which is what used to let signed-out
 * visitors reach the pages and crash with "Not signed in".
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // If env vars aren't configured yet, don't hard-crash every request —
  // let pages render (they'll surface the missing-config error clearly
  // instead of a blank middleware failure).
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // getUser() asks Supabase to validate the session (not just decode the
  // cookie), so an expired/forged/stale cookie counts as signed out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isAuthRoute = pathname === '/login' || pathname.startsWith('/login/');
  // The ICS subscribe feed is fetched directly by calendar apps (Apple/
  // Google/Outlook) which never sign in -- it's authorized by its own
  // unguessable per-user token instead (see planner_ics_feed in
  // supabase/schema.sql), so it must stay reachable with no session.
  const isPublicApiRoute = pathname.startsWith('/api/ics/');

  // Redirects are new responses, so carry over any session cookies that
  // getUser() just refreshed onto them.
  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user && !isAuthRoute && !isPublicApiRoute) {
    const loginUrl = new URL('/login', request.url);
    // Remember where they were headed (the home page needs no `next`).
    if (pathname !== '/' || search) loginUrl.searchParams.set('next', pathname + search);
    return redirectTo(loginUrl);
  }
  if (user && isAuthRoute) {
    return redirectTo(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
