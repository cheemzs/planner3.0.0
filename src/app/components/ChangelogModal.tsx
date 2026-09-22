import type { ChangelogRelease } from '@/lib/version';
import { markChangelogSeenAction } from '@/app/changelog-actions';

/**
 * Plain server-rendered overlay -- no client JS needed, since the only
 * interactive part is a real <form action={...}> submit. Dismissing it
 * revalidates the layout, so it won't render again until the next version
 * bump (see markChangelogSeenAction).
 */
export function ChangelogModal({ version, releases }: { version: string; releases: ChangelogRelease[] }) {
  return (
    <div className="changelog-backdrop" role="presentation">
      <div className="changelog-modal" role="dialog" aria-modal="true" aria-label="What's new">
        <h2 style={{ marginTop: 0 }}>What&apos;s new</h2>
        <p className="hint" style={{ marginTop: -8 }}>Here&apos;s what&apos;s changed since you were last here.</p>

        {releases.map((r) => (
          <div key={r.version} className="changelog-release">
            <h4>v{r.version}</h4>
            <ul>
              {r.entries.map((e) => (
                <li key={e.title}>
                  <strong>{e.title}</strong>
                  <div className="hint" style={{ margin: '2px 0 0' }}>
                    {e.description}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <form action={markChangelogSeenAction}>
          <input type="hidden" name="version" value={version} />
          <div className="actions">
            <button className="primary" type="submit">
              Got it, thanks!
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
