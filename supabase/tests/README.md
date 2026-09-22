# SQL permission tests

`rls_scenarios.py` runs the real `schema.sql` against a plain Postgres (16) and acts as
different users (via `request.jwt.claims`, the same mechanism Supabase uses) to check the
group permission model: pending users see nothing, only the organiser can admit / remove /
change settings, direct table writes are blocked, the organiser can't just abandon a group, etc.

```bash
createdb planner_test
psql planner_test -f supabase_stub.sql          # minimal stand-ins for Supabase's auth.users / auth.uid() / roles
psql planner_test -f ../schema.sql
pip install psycopg2-binary
# edit the connect() line at the top of rls_scenarios.py to point at your database, then:
python3 rls_scenarios.py
```

It **truncates** `auth.users` and `planner_groups`, so only ever point it at a throwaway database.
