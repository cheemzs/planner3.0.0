import { headers } from 'next/headers';
import * as repo from '@/lib/repository';
import { getCurrentUser, requireUser } from '@/lib/supabase/server';
import { updateProfileAction, updateThemeAction } from '@/app/profile/actions';
import { updateSimpleAvailabilityAction, updateAdvancedAvailabilityAction } from '@/app/availability/actions';
import { submitFeedbackAction } from '@/app/feedback/actions';
import { regenerateIcsTokenAction } from '@/app/settings/actions';
import { THEMES, type Theme } from '@/lib/repository';
import { DISPLAY_NAME_MAX } from '@/lib/profile';

export const dynamic = 'force-dynamic';

type Section = 'profile' | 'availability' | 'calendar' | 'feedback';

function parseSection(v?: string): Section {
  return v === 'availability' || v === 'calendar' || v === 'feedback' ? v : 'profile';
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { section?: string; error?: string; notice?: string };
}) {
  const section = parseSection(searchParams.section);

  return (
    <div>
      <h2>Settings</h2>
      <div className="day-tabs" style={{ marginBottom: 18 }}>
        <a href="/settings?section=profile" className={section === 'profile' ? 'active' : ''}>
          Profile
        </a>
        <a href="/settings?section=availability" className={section === 'availability' ? 'active' : ''}>
          Availability
        </a>
        <a href="/settings?section=calendar" className={section === 'calendar' ? 'active' : ''}>
          Calendar sync
        </a>
        <a href="/settings?section=feedback" className={section === 'feedback' ? 'active' : ''}>
          Feedback
        </a>
      </div>

      {searchParams.error ? (
        <div className="notice error" role="alert">
          {searchParams.error}
        </div>
      ) : null}
      {searchParams.notice ? (
        <div className="notice ok" role="status">
          {searchParams.notice}
        </div>
      ) : null}

      {section === 'profile' ? <ProfileSection /> : null}
      {section === 'availability' ? <AvailabilitySection /> : null}
      {section === 'calendar' ? <CalendarSection /> : null}
      {section === 'feedback' ? <FeedbackSection /> : null}
    </div>
  );
}

async function ProfileSection() {
  const user = await requireUser();
  const profile = await repo.getOwnProfile(user.id);

  return (
    <div>
      <p className="subtitle">How you appear to the people in your groups.</p>

      <div className="card">
        <form action={updateProfileAction}>
          <label htmlFor="displayName" style={{ marginTop: 0 }}>
            Display name
          </label>
          <input
            key={profile?.displayName ?? ''}
            id="displayName"
            name="displayName"
            required
            maxLength={DISPLAY_NAME_MAX}
            defaultValue={profile?.displayName ?? ''}
            placeholder="e.g. Alice Tan"
            autoComplete="nickname"
          />
          <p className="hint">
            This is the name other members see in your groups&apos; member lists and free-time results. Up to {DISPLAY_NAME_MAX} characters. It isn&apos;t
            your email, and your email is never shown to other members.
          </p>
          <div className="actions">
            <button className="primary" type="submit">
              Save
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h4>Theme</h4>
        <p className="hint" style={{ marginTop: 0 }}>
          Choose how the planner looks. Saved to your account, so it&apos;s the same on every device — it doesn&apos;t follow your system&apos;s
          light/dark setting.
        </p>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <ThemeOption key={t} theme={t} active={(profile?.theme ?? 'dark') === t} />
          ))}
        </div>
      </div>

      <div className="card">
        <h4>Sign-in email</h4>
        <div>{user.email}</div>
        <p className="hint">Only you can see this. It&apos;s what you sign in with.</p>
      </div>
    </div>
  );
}

const THEME_META: Record<Theme, { label: string; swatches: string[] }> = {
  dark: { label: 'Dark', swatches: ['#0b0d12', '#4361ee', '#e8eaf0'] },
  pink: { label: 'Pink', swatches: ['#ffb7d9', '#ffe7a8', '#3a2233'] },
};

function ThemeOption({ theme, active }: { theme: Theme; active: boolean }) {
  const meta = THEME_META[theme];
  return (
    <form action={updateThemeAction}>
      <input type="hidden" name="theme" value={theme} />
      <button type="submit" className={`theme-option${active ? ' active' : ''}`} aria-pressed={active} disabled={active}>
        <span className="theme-swatches" aria-hidden="true">
          {meta.swatches.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="theme-option-label">
          {meta.label}
          {active ? <span className="theme-current"> · current</span> : null}
        </span>
      </button>
    </form>
  );
}

async function AvailabilitySection() {
  const config = await repo.getAvailability();
  const def = config.default;
  const mainWindow = def.workWindows[0] ?? { start: '16:00', end: '21:00' };
  const mainBreak = def.breaks[0];

  return (
    <div>
      <p className="subtitle">
        The planner will never schedule outside these hours, over breaks, or through fixed events. It also never fills the day completely — it
        targets a utilization fraction and leaves the rest free.
      </p>

      <div className="card">
        <form action={updateSimpleAvailabilityAction}>
          <h3 style={{ marginTop: 0 }}>Default day</h3>
          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="wake">Wake</label>
              <input id="wake" name="wake" type="time" defaultValue={def.wake} required />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="sleep">Sleep</label>
              <input id="sleep" name="sleep" type="time" defaultValue={def.sleep} required />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="workStart">Schedulable window start</label>
              <input id="workStart" name="workStart" type="time" defaultValue={mainWindow.start} required />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="workEnd">Schedulable window end</label>
              <input id="workEnd" name="workEnd" type="time" defaultValue={mainWindow.end} required />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="breakStart">Daily break start (optional)</label>
              <input id="breakStart" name="breakStart" type="time" defaultValue={mainBreak?.start ?? ''} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="breakEnd">Daily break end (optional)</label>
              <input id="breakEnd" name="breakEnd" type="time" defaultValue={mainBreak?.end ?? ''} />
            </div>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="targetUtilization">Target utilization (0-1, e.g. 0.75)</label>
              <input
                id="targetUtilization"
                name="targetUtilization"
                type="number"
                step="0.05"
                min={0.1}
                max={0.95}
                defaultValue={config.targetUtilization}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="bufferMinutes">Buffer between sessions (minutes)</label>
              <input id="bufferMinutes" name="bufferMinutes" type="number" min={0} defaultValue={config.bufferMinutes} />
            </div>
          </div>

          <p className="subtitle">
            This form edits the fallback used for any day without a specific override. For per-weekday hours (e.g. different weekend
            availability), use Advanced below.
          </p>

          <div className="actions">
            <button className="primary" type="submit">
              Save
            </button>
          </div>
        </form>
      </div>

      <h3>Advanced (full JSON)</h3>
      <div className="card">
        <form action={updateAdvancedAvailabilityAction}>
          <textarea name="json" rows={16} defaultValue={JSON.stringify(config, null, 2)} />
          <p className="subtitle">
            Edit per-weekday overrides, date-specific unavailable days, or multiple work windows/breaks per day directly. Shape:{' '}
            <code>AvailabilityConfig</code> — see README for the type.
          </p>
          <div className="actions">
            <button type="submit">Save advanced config</button>
          </div>
        </form>
      </div>
    </div>
  );
}

async function CalendarSection() {
  const token = await repo.getOrCreateIcsToken();
  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host') ?? '';
  const httpsUrl = `${proto}://${host}/api/ics/${token}`;
  const webcalUrl = `webcal://${host}/api/ics/${token}`;

  return (
    <div>
      <p className="subtitle">
        Get your schedule into an <em>external</em> calendar app (Apple/Google/Outlook) — this is separate from the Month view under{' '}
        <a href="/schedule?view=month">Schedule</a>, which is this app&apos;s own calendar view.
      </p>
      <p className="subtitle" style={{ marginTop: -8 }}>
        Subscribe once and it stays in sync automatically — the app doesn&apos;t re-plan anything when your
        calendar app checks in, it just reads whatever is already scheduled.
      </p>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>Subscribe (stays in sync)</h4>
        <p className="hint" style={{ marginTop: 0 }}>
          This link is private and unguessable — anyone who has it can see your schedule&apos;s titles and times, so only share it with calendar
          apps you trust. Rotate it any time to invalidate the old one.
        </p>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <a className="btn primary" href={webcalUrl}>
            Add to calendar app
          </a>
          <CopyLink url={httpsUrl} />
        </div>
        <p className="hint" style={{ wordBreak: 'break-all' }}>{httpsUrl}</p>

        <form action={regenerateIcsTokenAction} style={{ marginTop: 8 }}>
          <button className="small danger" type="submit">
            Regenerate link
          </button>
        </form>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>Export a one-off file</h4>
        <p className="hint" style={{ marginTop: 0 }}>
          A snapshot .ics download for a specific range — doesn&apos;t stay in sync like the subscribe link above.
        </p>
        <ExportLinks />
      </div>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  // Plain, dependency-free "copy" affordance -- select-all-on-click text
  // field, so it works even with JS-averse copy managers and needs no
  // client component/clipboard API.
  return (
    <input
      readOnly
      value={url}
      onFocus={(e) => e.currentTarget.select()}
      style={{ width: 260, fontSize: 11 }}
      aria-label="Calendar feed URL (click to select, then copy)"
    />
  );
}

function ExportLinks() {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const todayIso = iso(today);
  const weekEnd = new Date(today);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <a className="btn" href={`/api/schedule/export?from=${todayIso}&to=${todayIso}`}>
        Export today
      </a>
      <a className="btn" href={`/api/schedule/export?from=${todayIso}&to=${iso(weekEnd)}`}>
        Export next 7 days
      </a>
      <a className="btn" href={`/api/schedule/export?from=${todayIso}&to=${iso(monthEnd)}`}>
        Export this month
      </a>
    </div>
  );
}

async function FeedbackSection() {
  const user = await getCurrentUser();

  return (
    <div>
      <p className="subtitle">Found a bug, or have an idea? Tell us — this goes straight to the team.</p>

      <div className="card">
        <form action={submitFeedbackAction}>
          <label htmlFor="message" style={{ marginTop: 0 }}>
            Your message
          </label>
          <textarea id="message" name="message" required maxLength={4000} placeholder="What's on your mind?" style={{ minHeight: 140 }} />

          <label htmlFor="contactEmail">Your email (optional)</label>
          <input id="contactEmail" name="contactEmail" type="email" placeholder={user?.email ?? 'you@example.com'} autoComplete="email" />
          <p className="hint">
            Leave this blank and we&apos;ll use <strong>{user?.email}</strong> if we need to follow up. Only fill it in if you&apos;d rather we
            reply somewhere else.
          </p>

          <div className="actions">
            <button className="primary" type="submit">
              Send feedback
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
