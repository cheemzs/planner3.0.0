import * as repo from '@/lib/repository';
import { getCurrentUser } from '@/lib/supabase/server';
import { createGroupAction, joinGroupAction, leaveGroupAction } from '@/app/groups/actions';
import { tzOptionLabel } from '@/lib/format';
import { allTimezones } from '@/lib/timezones';
import { APP_TIMEZONE } from '@/lib/engine/time-utils';

export const dynamic = 'force-dynamic';


export default async function GroupsPage({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const [me, groups, pending] = await Promise.all([getCurrentUser(), repo.listMyGroups(), repo.listMyPendingRequests()]);
  const zones = allTimezones();

  return (
    <div>
      <h2>Groups</h2>
      <p className="subtitle">
        Create or join as many groups as you like — each is fully separate. Your tasks and schedule are always private;
        being in a group only lets its other members see when you&apos;re free, nothing else.
      </p>

      {searchParams.error ? <div className="notice error">{searchParams.error}</div> : null}
      {searchParams.notice ? <div className="notice ok">{searchParams.notice}</div> : null}

      {groups.length === 0 && pending.length === 0 ? (
        <div className="empty">You&apos;re not in any groups yet.</div>
      ) : null}

      {groups.length > 0 ? (
        <div className="list">
          {groups.map((g) => {
            const isOrganiser = g.organiserId === me?.id;
            return (
              <div className="list-item" key={g.id}>
                <div className="grow">
                  <div className="title">
                    <a href={`/group/${g.id}`}>{g.name}</a> {isOrganiser ? <span className="badge organiser">Organiser</span> : null}
                  </div>
                  <div className="meta">
                    Invite code <code>{g.inviteCode}</code>
                  </div>
                </div>
                <div className="btns">
                  <a className="btn small" href={`/group/${g.id}`}>
                    Open
                  </a>
                  {isOrganiser ? (
                    <a className="btn small" href={`/group/${g.id}/manage`}>
                      Manage
                    </a>
                  ) : (
                    <details className="confirm">
                      <summary className="btn small danger">Leave</summary>
                      <p className="why">You&apos;ll stop appearing in {g.name}&apos;s free-time results. You can request to join again later.</p>
                      <form action={leaveGroupAction}>
                        <input type="hidden" name="groupId" value={g.id} />
                        <button className="small danger solid" type="submit">
                          Yes, leave {g.name}
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {pending.length > 0 ? (
        <>
          <h3>Waiting for approval</h3>
          <div className="list">
            {pending.map((p) => (
              <div className="list-item" key={p.groupId}>
                <div className="grow">
                  <div className="title">
                    {p.groupName} <span className="badge pending">Pending</span>
                  </div>
                  <div className="meta">The organiser needs to approve your request. Nothing about you is visible to the group until then.</div>
                </div>
                <form action={leaveGroupAction}>
                  <input type="hidden" name="groupId" value={p.groupId} />
                  <button className="small" type="submit">
                    Cancel request
                  </button>
                </form>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h3>Create a new group</h3>
      <div className="card">
        <form action={createGroupAction}>
          <div className="form-grid">
            <div>
              <label htmlFor="name">Group name</label>
              <input id="name" name="name" required placeholder="Roommates, Study group, Family…" />
            </div>
            <div>
              <label htmlFor="timezone">Group timezone</label>
              <select id="timezone" name="timezone" defaultValue={APP_TIMEZONE}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {tzOptionLabel(z)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="hint">You&apos;ll be the group&apos;s organiser: you approve who joins and choose the planning period. You can change all of this later.</p>
          <div className="actions">
            <button className="primary" type="submit">
              Create group
            </button>
          </div>
        </form>
      </div>

      <h3>Join a group</h3>
      <div className="card">
        <form action={joinGroupAction}>
          <label htmlFor="code">Invite code</label>
          <input id="code" name="code" required placeholder="e.g. a1b2c3d4" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <p className="hint">Most groups need the organiser to approve you before you can see anything.</p>
          <div className="actions">
            <button type="submit">Request to join</button>
          </div>
        </form>
      </div>
    </div>
  );
}
