import { redirect } from 'next/navigation';
import * as repo from '@/lib/repository';
import { requireUser } from '@/lib/supabase/server';
import { setFeedbackHandledAction } from '@/app/admin/actions';
import { fmtDate, memberName } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * is_admin is set only by a direct SQL statement run in the Supabase SQL
 * editor (see the comment above planner_admin_overview() in schema.sql) --
 * there is no in-app way to grant it, to yourself or anyone else. Every
 * query below is still filtered by Postgres itself (is_planner_admin()
 * inside each SECURITY DEFINER function): if this page's own check were
 * ever accidentally removed, a non-admin would get empty results, not
 * someone else's data.
 */
export default async function AdminPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requireUser();
  const profile = await repo.getOwnProfile(user.id);
  if (!profile?.isAdmin) redirect('/');

  const [overview, series, feedback] = await Promise.all([repo.getAdminOverview(), repo.getAdminSignupSeries(), repo.listAllFeedback()]);
  const maxSignups = Math.max(1, ...series.map((d) => d.signups));
  const open = feedback.filter((f) => !f.handled);
  const handled = feedback.filter((f) => f.handled);

  return (
    <div>
      <h2>Admin</h2>
      <p className="subtitle">Usage overview and the feedback inbox. Only visible to admins.</p>

      {searchParams.error ? <div className="notice error">{searchParams.error}</div> : null}

      {!overview ? (
        <div className="empty">No data (or you&apos;re not recognised as an admin by the database — check planner_profiles.is_admin).</div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="v">{overview.totalUsers}</div>
              <div className="l">total users</div>
            </div>
            <div className="stat">
              <div className="v">{overview.signupsLast7d}</div>
              <div className="l">signups, last 7 days</div>
            </div>
            <div className="stat">
              <div className="v">{overview.signupsLast30d}</div>
              <div className="l">signups, last 30 days</div>
            </div>
            <div className="stat">
              <div className="v">{overview.totalGroups}</div>
              <div className="l">groups</div>
            </div>
            <div className="stat">
              <div className="v">{overview.totalTasks}</div>
              <div className="l">tasks created</div>
            </div>
            <div className="stat">
              <div className="v">{overview.totalEvents}</div>
              <div className="l">events created</div>
            </div>
          </div>

          <div className="card">
            <h4>Signups, last 90 days</h4>
            <div className="admin-spark" role="img" aria-label={`Daily signups over the last 90 days, peaking at ${maxSignups} in a day`}>
              {series.map((d) => (
                <div key={d.day} className="admin-spark-bar" style={{ height: `${Math.max(2, (d.signups / maxSignups) * 100)}%` }} title={`${d.day}: ${d.signups}`} />
              ))}
            </div>
          </div>
        </>
      )}

      <h3 id="feedback" style={{ scrollMarginTop: 16 }}>
        Feedback {open.length > 0 ? <span className="badge pending">{open.length} open</span> : null}
      </h3>
      {feedback.length === 0 ? (
        <div className="card muted">No feedback submitted yet.</div>
      ) : (
        <>
          {open.length > 0 ? (
            <div className="list">
              {open.map((f) => (
                <FeedbackRow key={f.id} f={f} />
              ))}
            </div>
          ) : (
            <div className="card muted">No open feedback.</div>
          )}
          {handled.length > 0 ? (
            <details className="panel">
              <summary>Handled ({handled.length})</summary>
              <div className="panel-body">
                <div className="list" style={{ marginBottom: 0 }}>
                  {handled.map((f) => (
                    <FeedbackRow key={f.id} f={f} />
                  ))}
                </div>
              </div>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function FeedbackRow({ f }: { f: repo.FeedbackItem }) {
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <div className="grow">
        <div className="title">
          {memberName(f)} <span className="meta">· {f.contactEmail ?? f.email}</span>
        </div>
        <div className="meta">
          {fmtDate(f.createdAt.slice(0, 10))}
          {f.page ? ` · ${f.page}` : ''}
        </div>
        <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{f.message}</p>
      </div>
      <form action={setFeedbackHandledAction}>
        <input type="hidden" name="feedbackId" value={f.id} />
        <input type="hidden" name="handled" value={(!f.handled).toString()} />
        <button className="small" type="submit">
          {f.handled ? 'Mark open' : 'Mark handled'}
        </button>
      </form>
    </div>
  );
}
