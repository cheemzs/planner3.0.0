import type { ReactNode } from 'react';
import './globals.css';
import { getCurrentUser } from '@/lib/supabase/server';
import { signOutAction } from '@/app/login/actions';
import { Nav } from '@/app/components/Nav';
import { ChangelogModal } from '@/app/components/ChangelogModal';
import { APP_VERSION, CHANGELOG } from '@/lib/version';
import * as repo from '@/lib/repository';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Planner',
  description: 'Constraint-based personal + shared planning engine',
};

// colorScheme (set per-request below, from the user's saved theme) makes
// native controls (date pickers, scrollbars, select popups) match; themeColor
// tints the mobile browser chrome for each theme; viewportFit 'cover' lets us
// honour iPhone safe-area insets.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Both themes' page background; the actual colour is picked by data-theme + prefers-color-scheme in CSS (see below).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFF7FB' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
} as const;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    // Login page (or a misconfigured/expired session mid-navigation) —
    // no navigation, just the page itself.
    return (
      <html lang="en" style={{ colorScheme: 'dark' }}>
        <body>{children}</body>
      </html>
    );
  }

  // The sidebar shows the user's display name and theme. A profile hiccup
  // must never take the whole app down, so fall back to sensible defaults.
  let displayName: string | null = null;
  let theme: repo.Theme = 'dark';
  let isAdmin = false;
  let showChangelog = false;
  try {
    const profile = await repo.getOwnProfile(user.id);
    displayName = profile?.displayName ?? null;
    theme = profile?.theme ?? 'dark';
    isAdmin = profile?.isAdmin ?? false;
    showChangelog = (profile?.lastSeenVersion ?? null) !== APP_VERSION;
  } catch {
    /* use defaults above */
  }

  return (
    <html lang="en" data-theme={theme} style={{ colorScheme: theme === 'pink' ? 'light' : 'dark' }}>
      <body>
        <div className="shell">
          <Nav displayName={displayName} email={user.email} isAdmin={isAdmin} signOutAction={signOutAction} />
          <main>{children}</main>
        </div>
        {showChangelog ? <ChangelogModal version={APP_VERSION} releases={CHANGELOG} /> : null}
      </body>
    </html>
  );
}
