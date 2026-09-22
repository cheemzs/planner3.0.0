'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * App navigation. Desktop: sticky sidebar. Mobile (<= 720px): a bottom tab
 * bar (thumb-reachable) with the four most-used pages plus a "More" sheet
 * for the rest -- the CSS decides which is visible; both render here.
 *
 * Links are plain <a> (full page loads), matching the rest of the app, so
 * the "More" sheet closes naturally on navigation.
 */

type IconName = 'schedule' | 'tasks' | 'groups' | 'settings' | 'insights' | 'admin' | 'more';

const ICONS: Record<IconName, ReactNode> = {
  schedule: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  tasks: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  groups: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  insights: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  admin: <><path d="M12 2l8 4v6c0 5-3.4 7.6-8 10-4.6-2.4-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const PRIMARY: NavItem[] = [
  { href: '/schedule', label: 'Schedule', icon: 'schedule' },
  { href: '/tasks', label: 'Tasks', icon: 'tasks' },
  { href: '/groups', label: 'Groups', icon: 'groups' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

const SECONDARY: NavItem[] = [{ href: '/insights', label: 'Insights', icon: 'insights' }];

function isActive(pathname: string, href: string): boolean {
  if (href === '/groups') return pathname === '/groups' || pathname.startsWith('/group/');
  return pathname === href || pathname.startsWith(href + '/');
}

export function Nav({
  displayName,
  email,
  isAdmin,
  signOutAction,
}: {
  displayName: string | null;
  email: string | undefined;
  isAdmin: boolean;
  signOutAction: (formData: FormData) => void | Promise<void>;
}) {
  const pathname = usePathname() ?? '/schedule';
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const secondary = isAdmin ? [...SECONDARY, { href: '/admin', label: 'Admin', icon: 'admin' as const }] : SECONDARY;
  const secondaryActive = secondary.some((l) => isActive(pathname, l.href));

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="sidebar" aria-label="Main">
        <h1>Planner</h1>
        {[...PRIMARY, ...secondary].map((l) => (
          <a key={l.href} href={l.href} className={`nav-link${isActive(pathname, l.href) ? ' active' : ''}`} aria-current={isActive(pathname, l.href) ? 'page' : undefined}>
            <Icon name={l.icon} />
            {l.label}
          </a>
        ))}
        <div className="sidebar-account">
          <a href="/settings?section=profile" className="account-link" title="Edit your profile">
            <span className="account-name">{displayName ?? email}</span>
            {displayName && email ? <span className="sidebar-email">{email}</span> : null}
          </a>
          <form action={signOutAction}>
            <button className="small" type="submit" style={{ width: '100%' }}>
              Sign out
            </button>
          </form>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="tabbar" aria-label="Main">
        {PRIMARY.map((l) => (
          <a key={l.href} href={l.href} className={`tab${isActive(pathname, l.href) ? ' active' : ''}`} aria-current={isActive(pathname, l.href) ? 'page' : undefined}>
            <Icon name={l.icon} />
            {l.label}
          </a>
        ))}
        <button
          type="button"
          className={`tab${secondaryActive || moreOpen ? ' active' : ''}`}
          aria-expanded={moreOpen}
          aria-controls="more-sheet"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Icon name="more" />
          More
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div className="more-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet" id="more-sheet" role="dialog" aria-label="More pages">
            <div className="more-grid">
              {secondary.map((l) => (
                <a key={l.href} href={l.href} className={`nav-link${isActive(pathname, l.href) ? ' active' : ''}`}>
                  <Icon name={l.icon} />
                  {l.label}
                </a>
              ))}
            </div>
            <div className="more-account">
              <a href="/settings?section=profile" className="account-link">
                <span className="account-name">{displayName ?? email}</span>
                {displayName && email ? <span className="sidebar-email">{email}</span> : null}
              </a>
              <form action={signOutAction}>
                <button className="small" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
