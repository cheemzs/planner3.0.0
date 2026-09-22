import * as repo from '@/lib/repository';
import { getCurrentUser } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { PERIOD_KINDS } from '@/lib/engine/group-period';
import { allTimezones } from '@/lib/timezones';
import { fmtDate, memberName, plural, tzOptionLabel } from '@/lib/format';
import {
  deleteGroupAction,
  regenerateCodeAction,
  removeMemberAction,
  resolveRequestAction,
  transferOrganiserAction,
  updateSettingsAction,
} from '@/app/group/[groupId]/actions';

export const dynamic = 'force-dynamic';

const MIN_BLOCK_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360];

export default async function ManageGroupPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { notice?: string; error?: string };
}) {
  const me = await getCurrentUser();
  const group = await repo.getGroup(params.groupId);
  if (!group) notFound();
  // Only the organiser gets this page. (Postgres enforces this on every action anyway; this just avoids showing a dead-end UI.)
  if (group.organiserId !== me?.id) redirect(`/group/${group.id}`);

  const [roster, requests] = await Promise.all([repo.getGroupRoster(group.id), repo.listJoinRequests(group.id)]);
  const zones = allTimezones();
  if (!zones.includes(group.timezone)) zones.push(group.timezone);
  const minOptions = MIN_BLOCK_OPTIONS.includes(group.minBlockMinutes) ? MIN_BLOCK_OPTIONS : [...MIN_BLOCK_OPTIONS, group.minBlockMinutes].sort((a, b) => a - b);
  const others = roster.filter((m) => m.id !== me?.id);

  return (
    <div>
      <p className="subtitle" style={{ marginBottom: 6 }}>
        <a href={`/group/${group.id}`}>← Back to {group.name}</a>
      </p>
      <h2>Manage group</h2>
      <p className="subtitle">Only you, as the organiser, can see this page.</p>

      {searchParams.error ? <div className="notice error">{searchParams.error}</div> : null}
      {searchParams.notice ? <div className="notice ok">{searchParams.notice}</div> : null}

      {/* ---------------- Join requests ---------------- */}
      <h3 id="requests" style={{ scrollMarginTop: 16 }}>
        Join requests {requests.length > 0 ? <span className="badge pending">{requests.length}</span> : null}
      </h3>
      {requests.length === 0 ? (
        <div className="card muted">
          No one is waiting to join.{' '}
          {group.requireApproval ? 'New people who use your invite code will show up here for approval.' : 'Approval is switched off, so anyone with the invite code joins instantly.'}
        </div>
      ) : (
        <div className="list">
          {requests.map((r) => (
            <div className="list-item" key={r.id}>
              <div className="grow">
                <div className="title">{memberName(r)}</div>
                <div className="meta">
                  {r.email} · requested {fmtDate(r.requestedAt.slice(0, 10))}
                </div>
              </div>
              <div className="btns">
                <form action={resolveRequestAction}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="userId" value={r.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="primary small" type="submit">
                    Approve
                  </button>
                </form>
                <form action={resolveRequestAction}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="userId" value={r.id} />
                  <input type="hidden" name="decision" value="deny" />
                  <button className="small danger" type="submit">
                    Decline
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Settings ---------------- */}
      <h3 id="settings" style={{ scrollMarginTop: 16 }}>
        Settings
      </h3>
      <div className="card">
        <form action={updateSettingsAction}>
          <input type="hidden" name="groupId" value={group.id} />
          <div className="form-grid">
            <div>
              <label htmlFor="name">Group name</label>
              <input id="name" name="name" required defaultValue={group.name} />
            </div>
            <div>
              <label htmlFor="timezone">Timezone</label>
              <select id="timezone" name="timezone" defaultValue={group.timezone}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {tzOptionLabel(z)}
                  </option>
                ))}
              </select>
              <p className="hint">Decides what &ldquo;today&rdquo; and &ldquo;now&rdquo; mean, so past times are never suggested.</p>
            </div>

            <div>
              <label htmlFor="periodKind">Planning period</label>
              <select id="periodKind" name="periodKind" defaultValue={group.periodKind}>
                {PERIOD_KINDS.map((p) => (
                  <option key={p.kind} value={p.kind}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="hint">How far ahead the group is looking for time together.</p>
            </div>
            <div>
              <label htmlFor="minBlockMinutes">Shortest useful get-together</label>
              <select id="minBlockMinutes" name="minBlockMinutes" defaultValue={String(group.minBlockMinutes)}>
                {minOptions.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes` : `${m / 60 === Math.floor(m / 60) ? m / 60 : (m / 60).toFixed(1)} hour${m === 60 ? '' : 's'}`}
                  </option>
                ))}
              </select>
              <p className="hint">Free windows shorter than this are ignored.</p>
            </div>

            <div>
              <label htmlFor="periodStart">Start date (optional)</label>
              <input id="periodStart" name="periodStart" type="date" defaultValue={group.periodStart ?? ''} />
              <p className="hint">Leave empty for a rolling period that always starts today. Required for custom dates.</p>
            </div>
            <div>
              <label htmlFor="periodEnd">End date (custom only)</label>
              <input id="periodEnd" name="periodEnd" type="date" defaultValue={group.periodEnd ?? ''} />
              <p className="hint">Only used when the period is &ldquo;Custom dates&rdquo; (max 400 days).</p>
            </div>

            <div className="full">
              <label className="check-row" htmlFor="requireApproval" style={{ marginTop: 14 }}>
                <input id="requireApproval" name="requireApproval" type="checkbox" defaultChecked={group.requireApproval} />
                <span>
                  Require my approval to join
                  <span className="hint" style={{ display: 'block', margin: 0 }}>
                    When on, people with the invite code wait in the request list above until you approve them. When off, they join instantly.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <div className="actions">
            <button className="primary" type="submit">
              Save settings
            </button>
          </div>
        </form>
      </div>

      {/* ---------------- Members ---------------- */}
      <h3 id="members" style={{ scrollMarginTop: 16 }}>
        Members ({roster.length})
      </h3>
      <div className="list">
        <div className="list-item">
          <div className="grow">
            <div className="title">
              {memberName(roster.find((m) => m.id === me?.id) ?? { displayName: null })} (you) <span className="badge organiser">Organiser</span>
            </div>
          </div>
        </div>
        {others.map((m) => (
          <div className="list-item" key={m.id}>
            <div className="grow">
              <div className="title">{memberName(m)}</div>
              {m.email ? <div className="meta">{m.email}</div> : null}
            </div>
            <div className="btns">
              <details className="confirm">
                <summary className="btn small">Make organiser</summary>
                <p className="why">
                  {memberName(m)} will become the organiser and you&apos;ll become a regular member. You&apos;ll lose access to this page, and only they can hand it back.
                </p>
                <form action={transferOrganiserAction}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="userId" value={m.id} />
                  <button className="small primary" type="submit">
                    Yes, make {memberName(m)} organiser
                  </button>
                </form>
              </details>
              <details className="confirm">
                <summary className="btn small danger">Remove</summary>
                <p className="why">{memberName(m)} will stop appearing in the group&apos;s results. They can request to join again with the invite code unless you change it.</p>
                <form action={removeMemberAction}>
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="userId" value={m.id} />
                  <button className="small danger solid" type="submit">
                    Yes, remove {memberName(m)}
                  </button>
                </form>
              </details>
            </div>
          </div>
        ))}
        {others.length === 0 ? <div className="list-item muted">You&apos;re the only member so far.</div> : null}
      </div>

      {/* ---------------- Invite code ---------------- */}
      <h3 id="invite" style={{ scrollMarginTop: 16 }}>
        Invite code
      </h3>
      <div className="card">
        <div className="spread">
          <div>
            <code style={{ fontSize: 18, padding: '4px 10px' }}>{group.inviteCode}</code>
            <p className="hint">Anyone with this code can {group.requireApproval ? 'request to join' : 'join instantly'}.</p>
          </div>
          <details className="confirm">
            <summary className="btn small">New code…</summary>
            <p className="why">The current code stops working immediately. Existing members aren&apos;t affected.</p>
            <form action={regenerateCodeAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button className="small primary" type="submit">
                Generate a new code
              </button>
            </form>
          </details>
        </div>
      </div>

      {/* ---------------- Danger zone ---------------- */}
      <h3 id="danger" style={{ scrollMarginTop: 16 }}>
        Delete group
      </h3>
      <div className="card danger-zone">
        <div className="spread">
          <p className="muted" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            Permanently removes <strong style={{ color: 'var(--text)' }}>{group.name}</strong> and its {plural(roster.length, 'membership')}. Nobody&apos;s personal tasks or schedule are touched.
          </p>
          <details className="confirm">
            <summary className="btn small danger">Delete group…</summary>
            <p className="why">This can&apos;t be undone.</p>
            <form action={deleteGroupAction}>
              <input type="hidden" name="groupId" value={group.id} />
              <button className="small danger solid" type="submit">
                Yes, delete {group.name}
              </button>
            </form>
          </details>
        </div>
      </div>
    </div>
  );
}
