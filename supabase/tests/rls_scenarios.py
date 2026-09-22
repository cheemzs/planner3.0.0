import psycopg2, json, uuid, sys
conn = psycopg2.connect(host='/tmp', port=5544, user='postgres', dbname='postgres')
conn.autocommit = True
cur = conn.cursor()
cur.execute("truncate auth.users cascade; truncate planner_groups cascade")

users = {}
for n in ['alice','bob','carol','dave']:
    cur.execute("insert into auth.users(email) values (%s) returning id", (f'{n}@x.com',))
    users[n] = cur.fetchone()[0]
    cur.execute("insert into planner_profiles(id,email,display_name) values (%s,%s,%s) on conflict do nothing", (users[n], f'{n}@x.com', n))

passed = failed = 0
def check(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print(f'  ok   {name}')
    else: failed += 1; print(f'  FAIL {name} {detail}')

def as_user(n):
    cur.execute("reset role"); cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({'sub': str(users[n])}),))

def q(n, sql, args=None):
    """run as user n; returns (rows, None) or (None, error message)"""
    as_user(n)
    try:
        cur.execute(sql, args)
        try: rows = cur.fetchall()
        except psycopg2.ProgrammingError: rows = []
        return rows, None
    except psycopg2.Error as e:
        return None, (e.diag.message_primary or str(e))
    finally:
        cur.execute("reset role")

def su(sql, args=None):
    cur.execute("reset role"); cur.execute(sql, args)
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return []

print('create / timezone validation')
r, e = q('alice', "select planner_create_group('Study', 'Not/AZone')")
check('bad timezone rejected', e and 'Unknown timezone' in e, e)
r, e = q('alice', "select planner_create_group('  ', 'UTC')")
check('blank name rejected', e and 'required' in e, e)
r, e = q('alice', "select planner_create_group('Study crew', 'Asia/Singapore')")
gid = r[0][0]
check('valid create ok', gid is not None, e)
code = su("select invite_code from planner_groups where id=%s", (gid,))[0][0]
check('alice is organiser + active member', su("select organiser_id from planner_groups where id=%s",(gid,))[0][0]==users['alice'])

print('join -> pending (approval required by default)')
r, e = q('bob', "select * from planner_join_group_by_code(%s)", (code.upper(),))
check('bob join is pending (code case-insensitive)', r and r[0][1]=='pending', (r,e))
r, e = q('bob', "select * from planner_join_group_by_code(%s)", (code,))
check('joining twice stays pending, no error', r and r[0][1]=='pending', (r,e))
r, e = q('bob', "select * from planner_groups")
check('pending bob cannot see the group row', r == [], r)
r, e = q('bob', "select * from planner_group_roster(%s)", (gid,))
check('pending bob gets empty roster', r == [], r)
r, e = q('bob', "select * from planner_my_pending_requests()")
check("bob sees his own pending request", r and r[0][1]=='Study crew', (r,e))
r, e = q('bob', "select * from planner_group_pending_requests(%s)", (gid,))
check('bob cannot list pending requests', r == [], r)
r, e = q('bob', "select planner_resolve_join_request(%s,%s,true)", (gid, users['bob']))
check('bob cannot approve himself', e and 'organiser' in e, e)
r, e = q('dave', "select * from planner_join_group_by_code('deadbeef')")
check('invalid code rejected', e and 'Invalid' in e, e)

print('pending users leak nothing (busy times / availability)')
su("insert into planner_events(owner_id,title,date,start,\"end\") values (%s,'secret','2026-10-05','09:00','10:00')", (users['bob'],))
su("insert into planner_availability(owner_id,config) values (%s,'{}')", (users['bob'],))
r, e = q('alice', "select * from planner_group_busy_times(%s, %s::uuid[], '2026-10-01','2026-10-31')", (gid, [str(users['bob'])]))
check("organiser can't read a PENDING user's busy times", r == [], r)
r, e = q('alice', "select * from planner_group_availability(%s, %s::uuid[])", (gid, [str(users['bob'])]))
check("organiser can't read a PENDING user's availability", r == [], r)

print('organiser approves')
r, e = q('alice', "select user_id, email from planner_group_pending_requests(%s)", (gid,))
check('alice sees bob pending', r and r[0][0]==users['bob'], (r,e))
r, e = q('alice', "select planner_resolve_join_request(%s,%s,true)", (gid, users['bob']))
check('approve ok', e is None, e)
r, e = q('bob', "select name from planner_groups")
check('bob now sees group', r == [('Study crew',)], (r,e))
r, e = q('bob', "select display_name, is_organiser from planner_group_roster(%s) order by is_organiser desc", (gid,))
check('roster has both, alice flagged organiser', r == [('alice',True),('bob',False)], (r,e))
r, e = q('alice', "select owner_id from planner_group_busy_times(%s, %s::uuid[], '2026-10-01','2026-10-31')", (gid, [str(users['bob'])]))
check("busy times now visible for ACTIVE bob", r and r[0][0]==users['bob'], (r,e))
r, e = q('bob', "select planner_resolve_join_request(%s,%s,true)", (gid, users['carol']))
check('approving a non-existent request errors (for non-organiser -> organiser msg)', e is not None, e)

print('members cannot see other pending rows')
q('carol', "select * from planner_join_group_by_code(%s)", (code,))
r, e = q('bob', "select user_id from planner_group_members where group_id=%s and status='pending'", (gid,))
check("active member bob can't see carol's pending row via table", r == [], r)
r, e = q('carol', "select user_id from planner_group_members")
check("carol sees only her own pending row", r == [(users['carol'],)], r)

print('non-organiser powers')
for label, sql, args in [
  ('update settings', "select planner_update_group(%s,'x','UTC','week',null,null,60,true)", (gid,)),
  ('remove member', "select planner_remove_member(%s,%s)", (gid, users['bob'])),
  ('regenerate code', "select planner_regenerate_invite_code(%s)", (gid,)),
  ('transfer organiser', "select planner_transfer_organiser(%s,%s)", (gid, users['bob'])),
]:
    r, e = q('bob', sql, args)
    check(f'bob cannot {label}', e and 'organiser' in e, e)

print('direct table tampering is blocked')
r, e = q('bob', "insert into planner_group_members(group_id,user_id,status) values (%s,%s,'active')", (gid, users['dave']))
check('cannot insert membership directly', e is not None, e)
r, e = q('carol', "update planner_group_members set status='active' where user_id=%s", (users['carol'],))
check('carol cannot self-approve via UPDATE (0 rows or error)', su("select status from planner_group_members where user_id=%s",(users['carol'],))[0][0]=='pending')
q('bob', "update planner_groups set organiser_id=%s where id=%s", (users['bob'], gid))
check('bob cannot take over via UPDATE', su("select organiser_id from planner_groups where id=%s",(gid,))[0][0]==users['alice'])
q('bob', "delete from planner_groups where id=%s", (gid,))
check('bob cannot delete group', len(su("select 1 from planner_groups where id=%s",(gid,)))==1)

print('settings')
r, e = q('alice', "select planner_update_group(%s,'Study crew','Asia/Singapore','custom','2026-10-01','2026-10-05',45,false)", (gid,))
check('custom period valid', e is None, e)
row = su("select period_kind,period_start::text,period_end::text,min_block_minutes,require_approval from planner_groups where id=%s",(gid,))[0]
check('settings persisted', row==('custom','2026-10-01','2026-10-05',45,False), row)
r, e = q('alice', "select planner_update_group(%s,'x','UTC','custom','2026-10-01','2027-12-31',45,true)", (gid,))
check('custom >400 days rejected', e and '400' in e, e)
r, e = q('alice', "select planner_update_group(%s,'x','UTC','custom','2026-10-05','2026-10-01',45,true)", (gid,))
check('custom end<start rejected', e and 'end date' in e, e)
r, e = q('alice', "select planner_update_group(%s,'x','UTC','custom',null,null,45,true)", (gid,))
check('custom w/o dates rejected', e and 'start and an end' in e, e)
r, e = q('alice', "select planner_update_group(%s,'x','UTC','decade',null,null,45,true)", (gid,))
check('unknown period kind rejected by CHECK', e is not None, e)
r, e = q('alice', "select planner_update_group(%s,'x','UTC','month','2026-10-01','2026-10-05',45,true)", (gid,))
row = su("select period_start::text, period_end from planner_groups where id=%s",(gid,))[0]
check('non-custom keeps start but nulls end', row==('2026-10-01',None), row)
r, e = q('alice', "select planner_update_group(%s,'Study crew','Asia/Singapore','year',null,null,10,true)", (gid,))
check('min block below 15 rejected by CHECK', e is not None, e)
q('alice', "select planner_update_group(%s,'Study crew','Asia/Singapore','two_months',null,null,60,false)", (gid,))

print('instant join when approval is off')
r, e = q('dave', "select * from planner_join_group_by_code(%s)", (code,))
check('dave joins instantly', r and r[0][1]=='active', (r,e))
q('alice', "select planner_update_group(%s,'Study crew','Asia/Singapore','month',null,null,60,true)", (gid,))

print('deny + regenerate code')
r, e = q('alice', "select planner_resolve_join_request(%s,%s,false)", (gid, users['carol']))
check('deny ok', e is None, e)
check('denied row is gone', su("select count(*) from planner_group_members where user_id=%s and group_id=%s",(users['carol'],gid))[0][0]==0)
r, e = q('alice', "select planner_regenerate_invite_code(%s)", (gid,))
newcode = r[0][0]
check('new code differs', newcode != code)
r, e = q('carol', "select * from planner_join_group_by_code(%s)", (code,))
check('old code no longer works', e and 'Invalid' in e, e)
r, e = q('carol', "select * from planner_join_group_by_code(%s)", (newcode,))
check('new code works (pending again)', r and r[0][1]=='pending', (r,e))

print('remove / leave / transfer')
r, e = q('alice', "select planner_remove_member(%s,%s)", (gid, users['alice']))
check('organiser cannot remove herself', e and "can't remove yourself" in e, e)
r, e = q('alice', "select planner_remove_member(%s,%s)", (gid, users['dave']))
check('organiser removes dave', e is None and su("select count(*) from planner_group_members where user_id=%s and group_id=%s",(users['dave'],gid))[0][0]==0, e)
r, e = q('alice', "select planner_leave_group(%s)", (gid,))
check('organiser cannot leave while others remain', e and 'Make someone else' in e, e)
r, e = q('alice', "select planner_transfer_organiser(%s,%s)", (gid, users['carol']))
check('cannot transfer to a pending user', e and 'already be a member' in e, e)
r, e = q('alice', "select planner_transfer_organiser(%s,%s)", (gid, users['dave']))
check('cannot transfer to a non-member', e and 'already be a member' in e, e)
r, e = q('alice', "select planner_transfer_organiser(%s,%s)", (gid, users['bob']))
check('transfer to bob ok', e is None, e)
r, e = q('alice', "select planner_regenerate_invite_code(%s)", (gid,))
check('alice lost organiser powers', e and 'organiser' in e, e)
r, e = q('bob', "select planner_regenerate_invite_code(%s)", (gid,))
check('bob has them now', e is None, e)
r, e = q('alice', "select planner_leave_group(%s)", (gid,))
check('alice can now leave', e is None, e)
r, e = q('carol', "select planner_leave_group(%s)", (gid,))
check('pending carol can withdraw her request', e is None and su("select count(*) from planner_group_members where user_id=%s",(users['carol'],))[0][0]==0, e)
r, e = q('bob', "select planner_leave_group(%s)", (gid,))
check('sole-member organiser leaving deletes the group', e is None and su("select count(*) from planner_groups where id=%s",(gid,))[0][0]==0, e)


print('profiles: edit own display name, nobody else\'s')
# fresh group for these checks: alice organiser, bob member
r, e = q('alice', "select planner_create_group('Profiles', 'Asia/Singapore')")
pg_ = r[0][0]
pcode = su("select invite_code from planner_groups where id=%s", (pg_,))[0][0]
q('bob', "select * from planner_join_group_by_code(%s)", (pcode,))
q('alice', "select planner_resolve_join_request(%s,%s,true)", (pg_, users['bob']))

r, e = q('alice', "update planner_profiles set display_name = 'Alice Tan' where id = %s returning display_name", (users['alice'],))
check('user can set their own display name', e is None and r == [('Alice Tan',)], (r, e))
r, e = q('alice', "select display_name from planner_profiles where id = %s", (users['alice'],))
check('and reads it back', r == [('Alice Tan',)], (r, e))
q('alice', "update planner_profiles set display_name = 'HACKED' where id = %s", (users['bob'],))
check("alice cannot change bob's display name (RLS: 0 rows)", su("select display_name from planner_profiles where id=%s",(users['bob'],))[0][0] != 'HACKED')
r, e = q('alice', "select id from planner_profiles where id = %s", (users['bob'],))
check("alice cannot even read bob's profile row directly", r == [], r)
r, e = q('alice', "update planner_profiles set email = 'boss@corp.com' where id = %s", (users['alice'],))
check('user cannot rewrite their own email column (column privilege)', e is not None and 'permission denied' in e, e)
r, e = q('alice', "update planner_profiles set display_name = %s where id = %s", ('x' * 41, users['alice']))
check('41-character display name rejected by CHECK', e is not None and 'display_name_len' in e, e)
r, e = q('alice', "update planner_profiles set display_name = '   ' where id = %s", (users['alice'],))
check('blank display name rejected by CHECK', e is not None and 'display_name_len' in e, e)
r, e = q('alice', "update planner_profiles set display_name = %s where id = %s returning 1", ('y' * 40, users['alice']))
check('exactly 40 characters accepted', e is None and r == [(1,)], (r, e))
q('alice', "update planner_profiles set display_name = 'Alice Tan' where id = %s", (users['alice'],))
q('bob', "update planner_profiles set display_name = 'Bobby' where id = %s", (users['bob'],))

print('profiles: what group members see')
r, e = q('bob', "select display_name from planner_group_roster(%s) order by display_name", (pg_,))
check("bob's roster shows alice's NEW display name", ('Alice Tan',) in r and ('Bobby',) in r, r)
r, e = q('bob', "select email from planner_group_roster(%s)", (pg_,))
check("a regular member receives NO email addresses in the roster", r and all(row[0] is None for row in r), r)
r, e = q('alice', "select email from planner_group_roster(%s) order by email", (pg_,))
check("the organiser does receive members' emails (to identify them)", set(x[0] for x in r) == {'alice@x.com', 'bob@x.com'}, r)

print('profiles: signup trigger with a very long email prefix')
long_local = 'l' * 60
cur.execute("reset role")
cur.execute("insert into auth.users(email) values (%s) returning id", (f'{long_local}@x.com',))
uid = cur.fetchone()[0]
cur.execute("select display_name from planner_profiles where id = %s", (uid,))
row = cur.fetchone()
check('signup still works; default name truncated to 40 chars', row is not None and len(row[0]) == 40, row)


print('theme: users can pick dark/pink, nobody can grant is_admin to themselves')
r, e = q('alice', "update planner_profiles set theme = 'pink' where id = %s returning theme", (users['alice'],))
check('user can set their own theme to pink', e is None and r == [('pink',)], (r, e))
r, e = q('alice', "update planner_profiles set theme = 'blue' where id = %s", (users['alice'],))
check("an unsupported theme value is rejected by CHECK", e is not None, e)
check('is_admin defaults to false for a brand-new user', su("select is_admin from planner_profiles where id=%s", (users['bob'],))[0][0] is False)
r, e = q('bob', "update planner_profiles set is_admin = true where id = %s", (users['bob'],))
check('a user cannot grant themselves is_admin (column not in the grant list)', e is not None and 'permission denied' in e, e)
r, e = q('bob', "update planner_profiles set is_admin = true where id = %s returning is_admin", (users['alice'],))
check("...and can't grant it to someone else either", e is not None and 'permission denied' in e, e)
q('alice', "update planner_profiles set theme = 'dark' where id = %s", (users['alice'],))  # reset for later checks

print('feedback: submit your own, read only your own')
r, e = q('alice', "select planner_submit_feedback('Love the app! One bug: X', 'alt@x.com', '/week')")
fb_id = r[0][0]
check('submitting feedback succeeds and returns an id', e is None and fb_id is not None, e)
r, e = q('alice', "select message, contact_email, page, handled from planner_feedback where id = %s", (fb_id,))
check('alice reads her own feedback back', r == [('Love the app! One bug: X', 'alt@x.com', '/week', False)], (r, e))
r, e = q('bob', "select id from planner_feedback where id = %s", (fb_id,))
check("bob cannot read alice's feedback directly (RLS)", r == [], r)
r, e = q('alice', "select planner_submit_feedback('', null, null)")
check('an empty message is rejected by the CHECK constraint', e is not None, e)
r, e = q('alice', "select planner_submit_feedback(%s, null, null)", ('x' * 4001,))
check('a message over 4000 characters is rejected', e is not None, e)
r, e = q('alice', "update planner_feedback set handled = true where id = %s", (fb_id,))
check("a regular user has no UPDATE policy on feedback (can't mark their own as handled)", e is not None or su("select handled from planner_feedback where id=%s",(fb_id,))[0][0] is False)

print('admin: functions return nothing/refuse for a non-admin, work for an admin')
r, e = q('bob', "select * from planner_admin_overview()")
check('a non-admin gets zero rows from planner_admin_overview (not an error, not real data)', r == [], r)
r, e = q('bob', "select * from planner_admin_list_feedback()")
check('a non-admin gets zero rows from planner_admin_list_feedback (feedback stays private)', r == [], r)
r, e = q('bob', "select planner_admin_set_feedback_handled(%s, true)", (fb_id,))
check('a non-admin cannot mark feedback handled (explicit exception)', e is not None and 'admin' in e, e)
check("...and it really wasn't marked handled", su("select handled from planner_feedback where id=%s",(fb_id,))[0][0] is False)

cur.execute("reset role")
cur.execute("update planner_profiles set is_admin = true where id = %s", (users['bob'],))  # the ONE way: direct SQL as postgres, never through the app
r, e = q('bob', "select total_users, open_feedback from planner_admin_overview()")
check('once is_admin is set directly in SQL, the same function now returns real totals', e is None and r and r[0][0] >= 4 and r[0][1] >= 1, (r, e))
r, e = q('bob', "select email, message from planner_admin_list_feedback() where id = %s", (fb_id,))
check("an admin CAN read alice's feedback (that's the point of the inbox)", r == [('alice@x.com', 'Love the app! One bug: X')], (r, e))
r, e = q('bob', "select * from planner_admin_signup_series()")
check('signup series returns ~90 rows for an admin', e is None and len(r) >= 89, len(r) if r else e)
r, e = q('bob', "select planner_admin_set_feedback_handled(%s, true)", (fb_id,))
check('admin marks feedback handled', e is None, e)
check('...and it actually changed', su("select handled from planner_feedback where id=%s",(fb_id,))[0][0] is True)
r, e = q('alice', "select handled from planner_feedback where id = %s", (fb_id,))
check("alice (feedback's author, not an admin) sees the updated handled status on her own row", r == [(True,)], r)
cur.execute("reset role")
cur.execute("update planner_profiles set is_admin = false where id = %s", (users['bob'],))  # revert

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
