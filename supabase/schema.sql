-- Personal planner + multi-group availability finder schema for Supabase
-- (Postgres). Run this once in the Supabase SQL editor (or via
-- `supabase db push`).
--
-- Model:
--  - Every person's tasks/events/schedule/availability are fully private
--    (Row Level Security, owner_id = auth.uid() only).
--  - People can create or join any number of "groups" via an invite
--    code. Every group has ONE organiser (its creator, transferable).
--    By default, joining by code only creates a *pending* request that
--    the organiser must approve -- pending people see nothing.
--  - The group finder (find common free time) is scoped to ONE group at
--    a time: a SECURITY DEFINER function verifies that BOTH the caller
--    and every requested person are members of that SAME group before
--    returning anything, and even then only returns busy TIME RANGES and
--    availability-hours PATTERNS -- never task/event titles or content.
--    Being in one group never grants any visibility into a different
--    group you're not in, even if some members overlap.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Profiles -- private by default. Only ever read by other users through
-- the planner_group_roster() function below, which is scoped to shared
-- group membership.
-- ---------------------------------------------------------------------

create table if not exists planner_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  -- What other group members see. Mirrors validateDisplayName() in the app.
  constraint planner_profiles_display_name_len
    check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  -- UI preference only, never read by any RLS policy or SECURITY DEFINER function.
  theme text not null default 'dark' check (theme in ('dark','pink')),
  -- Grants elevated (but still RLS-governed) read access to admin views below.
  -- Deliberately NOT in the `grant update (...)` list a few lines down, so no
  -- signed-in user, however they call the API, can ever set this on themselves
  -- or anyone else. The only way to become an admin is a direct SQL statement
  -- run by a project owner in the Supabase SQL editor -- see the comment above
  -- planner_admin_overview() further down.
  is_admin boolean not null default false,
  -- Unguessable token for the ICS calendar-subscribe feed. NULL until first
  -- requested; also NOT in `grant update (...)` -- only ever set through
  -- planner_get_or_create_ics_token()/planner_regenerate_ics_token() below.
  ics_token text unique,
  -- Last app version whose "what's new" changelog this person has seen (see
  -- APP_VERSION in src/lib/version.ts and the ChangelogModal component).
  -- Low-stakes self-reported field -- fine to let people set it themselves.
  last_seen_version text
);

alter table planner_profiles enable row level security;

create policy "users manage their own profile" on planner_profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- RLS above limits which ROW you can touch (your own). This limits which
-- COLUMN you can change: display_name only. Without it, anyone signed in could
-- rewrite the `email` on their own profile and have the organiser see a fake
-- address in the join-request list.
revoke update on planner_profiles from anon, authenticated;
grant update (display_name, theme, last_seen_version) on planner_profiles to authenticated;

create or replace function public.handle_new_planner_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.planner_profiles (id, email, display_name, theme, is_admin)
  values (new.id, new.email, nullif(left(split_part(coalesce(new.email, 'user'), '@', 1), 40), ''), 'dark', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_planner on auth.users;
create trigger on_auth_user_created_planner
  after insert on auth.users
  for each row execute procedure public.handle_new_planner_user();

-- ---------------------------------------------------------------------
-- Tasks / Events / Blocks / Availability -- always private to their
-- owner. Identical to the single-group version of this schema.
-- ---------------------------------------------------------------------

create table if not exists planner_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  project_id text,
  goal_id text,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  importance numeric,
  difficulty numeric,
  estimated_minutes integer not null check (estimated_minutes >= 0),
  remaining_minutes integer not null check (remaining_minutes >= 0),
  deadline text,
  earliest_start text,
  latest_completion text,
  preferred_time_of_day text check (preferred_time_of_day in ('morning','afternoon','evening','any')),
  min_chunk_minutes integer,
  max_chunk_minutes integer,
  depends_on text[] not null default '{}',
  recurrence jsonb,
  tags text[] not null default '{}',
  auto_schedulable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table planner_tasks enable row level security;
create policy "own tasks only" on planner_tasks for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists planner_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  date text not null,
  start text not null,
  "end" text not null,
  fixed boolean not null default true,
  recurrence jsonb,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint end_after_start check ("end" > start)
);

alter table planner_events enable row level security;
create policy "own events only" on planner_events for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists planner_blocks (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  start text not null,
  "end" text not null,
  type text not null check (type in ('task','event','break','buffer')),
  ref_id text,
  title text not null,
  locked boolean not null default false,
  source text not null check (source in ('auto','manual')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table planner_blocks enable row level security;
create policy "own blocks only" on planner_blocks for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists planner_availability (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

alter table planner_availability enable row level security;
create policy "own availability only" on planner_availability for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Groups -- a person can create or join any number of them via an
-- invite code. Only ACTIVE membership unlocks any cross-person
-- visibility, and only within that specific group. The organiser
-- (planner_groups.organiser_id) controls admission and settings.
--
-- Every write to groups/memberships goes through a SECURITY DEFINER
-- function below that checks the caller is allowed to do it; there are
-- deliberately NO insert/update policies on these tables.
-- ---------------------------------------------------------------------

create table if not exists planner_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
  created_by uuid not null references auth.users(id) on delete cascade,
  organiser_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Organiser-controlled settings ------------------------------------
  -- IANA timezone (default SGT) used to decide what "today"/"now" mean for the group
  -- (so we never suggest a time that has already passed).
  timezone text not null default 'Asia/Singapore',
  -- What span of time the group is planning for. period_start NULL means
  -- "rolling": the window always starts today. 'custom' needs both dates.
  period_kind text not null default 'month'
    check (period_kind in ('week','two_weeks','month','two_months','quarter','half_year','year','custom')),
  period_start date,
  period_end date,
  -- Shortest continuous block that counts as "time together".
  min_block_minutes integer not null default 60 check (min_block_minutes between 15 and 720),
  -- true: join-by-code creates a pending request. false: instant join.
  require_approval boolean not null default true,

  constraint planner_groups_period_valid check (
    (period_kind <> 'custom' and period_end is null)
    or (period_kind = 'custom' and period_start is not null and period_end is not null
        and period_end >= period_start and period_end - period_start <= 400)
  )
);

create table if not exists planner_group_members (
  group_id uuid not null references planner_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','pending')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table planner_groups enable row level security;
alter table planner_group_members enable row level security;

-- SECURITY DEFINER helpers: bypass RLS internally so they can be used
-- *inside* the policies below without recursive-policy issues.
-- Only ACTIVE members count -- a pending request grants nothing.
create or replace function public.is_planner_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from planner_group_members
    where group_id = p_group_id and user_id = p_user_id and status = 'active'
  );
$$;

create or replace function public.is_planner_group_organiser(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from planner_groups
    where id = p_group_id and organiser_id = p_user_id
  ) and public.is_planner_group_member(p_group_id, p_user_id);
$$;

create policy "select groups you belong to" on planner_groups for select
  using (public.is_planner_group_member(id, auth.uid()));
create policy "organiser can delete group" on planner_groups for delete
  using (organiser_id = auth.uid());

-- You can always see your own membership row (including a pending one);
-- you see other people's rows only if you're an active member, and only
-- their ACTIVE rows (who is merely pending is for the organiser alone).
create policy "select memberships" on planner_group_members for select
  using (
    user_id = auth.uid()
    or (status = 'active' and public.is_planner_group_member(group_id, auth.uid()))
  );

-- ---- Create / join / leave ------------------------------------------

create or replace function public.planner_create_group(p_name text, p_timezone text default 'Asia/Singapore')
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_group_id uuid;
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'Asia/Singapore');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown timezone: %', v_tz;
  end if;
  insert into planner_groups (name, created_by, organiser_id, timezone)
  values (trim(p_name), auth.uid(), auth.uid(), v_tz)
  returning id into v_group_id;
  insert into planner_group_members (group_id, user_id, status) values (v_group_id, auth.uid(), 'active');
  return v_group_id;
end;
$$;

-- Returns the group id and what actually happened: 'active' (you're in)
-- or 'pending' (the organiser must approve you first).
create or replace function public.planner_join_group_by_code(p_code text)
returns table(group_id uuid, status text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_group planner_groups%rowtype;
  v_existing text;
  v_status text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into v_group from planner_groups g where g.invite_code = lower(trim(p_code));
  if v_group.id is null then
    raise exception 'Invalid invite code';
  end if;

  select m.status into v_existing from planner_group_members m
   where m.group_id = v_group.id and m.user_id = auth.uid();
  if v_existing is not null then
    return query select v_group.id, v_existing;
    return;
  end if;

  v_status := case when v_group.require_approval then 'pending' else 'active' end;
  insert into planner_group_members (group_id, user_id, status) values (v_group.id, auth.uid(), v_status);
  return query select v_group.id, v_status;
end;
$$;

-- Leave a group, or withdraw your own pending request. The organiser
-- can't just walk out: hand the role over first (or, if they're the only
-- member left, leaving deletes the now-empty group).
create or replace function public.planner_leave_group(p_group_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_others integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if public.is_planner_group_organiser(p_group_id, auth.uid()) then
    select count(*) into v_others from planner_group_members
     where group_id = p_group_id and status = 'active' and user_id <> auth.uid();
    if v_others > 0 then
      raise exception 'You are the organiser. Make someone else the organiser before leaving.';
    end if;
    delete from planner_groups where id = p_group_id;
    return;
  end if;
  delete from planner_group_members where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- The caller's own pending requests (the group row itself is hidden by
-- RLS until they're approved, so this is how they see "waiting on X").
create or replace function public.planner_my_pending_requests()
returns table(group_id uuid, group_name text, requested_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select m.group_id, g.name, m.joined_at
  from planner_group_members m
  join planner_groups g on g.id = m.group_id
  where m.user_id = auth.uid() and m.status = 'pending'
  order by m.joined_at;
$$;

-- ---- Organiser-only actions -----------------------------------------

create or replace function public.planner_group_pending_requests(p_group_id uuid)
returns table(user_id uuid, email text, display_name text, requested_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select p.id, p.email, p.display_name, m.joined_at
  from planner_group_members m
  join planner_profiles p on p.id = m.user_id
  where m.group_id = p_group_id and m.status = 'pending'
    and public.is_planner_group_organiser(p_group_id, auth.uid())
  order by m.joined_at;
$$;

create or replace function public.planner_resolve_join_request(p_group_id uuid, p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_planner_group_organiser(p_group_id, auth.uid()) then
    raise exception 'Only the organiser can do that';
  end if;
  if not exists (select 1 from planner_group_members
                  where group_id = p_group_id and user_id = p_user_id and status = 'pending') then
    raise exception 'That request no longer exists';
  end if;
  if p_approve then
    update planner_group_members set status = 'active', joined_at = now()
     where group_id = p_group_id and user_id = p_user_id;
  else
    delete from planner_group_members where group_id = p_group_id and user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.planner_remove_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_planner_group_organiser(p_group_id, auth.uid()) then
    raise exception 'Only the organiser can do that';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t remove yourself while you''re the organiser';
  end if;
  delete from planner_group_members where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function public.planner_transfer_organiser(p_group_id uuid, p_new_organiser uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_planner_group_organiser(p_group_id, auth.uid()) then
    raise exception 'Only the organiser can do that';
  end if;
  if not public.is_planner_group_member(p_group_id, p_new_organiser) then
    raise exception 'The new organiser must already be a member of the group';
  end if;
  update planner_groups set organiser_id = p_new_organiser where id = p_group_id;
end;
$$;

-- Old code stops working, new code is returned. Existing members are
-- unaffected; only people still holding the old code are locked out.
create or replace function public.planner_regenerate_invite_code(p_group_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  if not public.is_planner_group_organiser(p_group_id, auth.uid()) then
    raise exception 'Only the organiser can do that';
  end if;
  update planner_groups set invite_code = v_code where id = p_group_id;
  return v_code;
end;
$$;

create or replace function public.planner_update_group(
  p_group_id uuid,
  p_name text,
  p_timezone text,
  p_period_kind text,
  p_period_start date,
  p_period_end date,
  p_min_block_minutes integer,
  p_require_approval boolean
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_planner_group_organiser(p_group_id, auth.uid()) then
    raise exception 'Only the organiser can do that';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Group name is required';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown timezone: %', p_timezone;
  end if;
  if p_period_kind = 'custom' then
    if p_period_start is null or p_period_end is null then
      raise exception 'A custom period needs both a start and an end date';
    end if;
    if p_period_end < p_period_start then
      raise exception 'The end date must be on or after the start date';
    end if;
    if p_period_end - p_period_start > 400 then
      raise exception 'A custom period can be at most 400 days long';
    end if;
  end if;

  update planner_groups set
    name = trim(p_name),
    timezone = p_timezone,
    period_kind = p_period_kind,
    period_start = p_period_start,
    period_end = case when p_period_kind = 'custom' then p_period_end else null end,
    min_block_minutes = p_min_block_minutes,
    require_approval = p_require_approval
  where id = p_group_id;
end;
$$;

-- ---- Cross-person reads (active members of the SAME group only) -----

-- Roster of a specific group -- only returns anything if the caller is
-- themselves an active member of that group. `email` is NULL unless the
-- caller is the organiser.
create or replace function public.planner_group_roster(p_group_id uuid)
returns table(id uuid, email text, display_name text, is_organiser boolean, joined_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select p.id,
         -- Members never receive each other's email addresses; only the organiser
         -- (who admits and removes people and may need to tell two "Sam"s apart) does.
         case when g.organiser_id = auth.uid() then p.email end as email,
         p.display_name,
         (g.organiser_id = p.id) as is_organiser,
         m.joined_at
  from planner_profiles p
  join planner_group_members m on m.user_id = p.id and m.status = 'active'
  join planner_groups g on g.id = m.group_id
  where m.group_id = p_group_id
    and public.is_planner_group_member(p_group_id, auth.uid())
  order by (g.organiser_id = p.id) desc, m.joined_at;
$$;

-- Busy time ranges (no titles/content) for the given people, scoped to
-- one group: every one of p_user_ids must ALSO be an active member of
-- p_group_id, and so must the caller, or nothing is returned for them.
create or replace function public.planner_group_busy_times(p_group_id uuid, p_user_ids uuid[], p_from text, p_to text)
returns table(owner_id uuid, date text, start text, "end" text)
language sql
security definer set search_path = public
stable
as $$
  select b.owner_id, b.date, b.start, b."end"
  from planner_blocks b
  where b.owner_id = any(p_user_ids)
    and b.date >= p_from and b.date <= p_to
    and public.is_planner_group_member(p_group_id, auth.uid())
    and public.is_planner_group_member(p_group_id, b.owner_id)
  union all
  select e.owner_id, e.date, e.start, e."end"
  from planner_events e
  where e.owner_id = any(p_user_ids)
    and e.date >= p_from and e.date <= p_to
    and public.is_planner_group_member(p_group_id, auth.uid())
    and public.is_planner_group_member(p_group_id, e.owner_id);
$$;

-- Availability config (hours pattern, not content) for the given people,
-- scoped to one shared group the same way.
create or replace function public.planner_group_availability(p_group_id uuid, p_user_ids uuid[])
returns table(owner_id uuid, config jsonb)
language sql
security definer set search_path = public
stable
as $$
  select a.owner_id, a.config
  from planner_availability a
  where a.owner_id = any(p_user_ids)
    and public.is_planner_group_member(p_group_id, auth.uid())
    and public.is_planner_group_member(p_group_id, a.owner_id);
$$;

create index if not exists idx_planner_blocks_date on planner_blocks (date);
create index if not exists idx_planner_blocks_owner on planner_blocks (owner_id);
create index if not exists idx_planner_events_date on planner_events (date);
create index if not exists idx_planner_events_owner on planner_events (owner_id);
create index if not exists idx_planner_tasks_status on planner_tasks (status);
create index if not exists idx_planner_tasks_owner on planner_tasks (owner_id);
create index if not exists idx_planner_group_members_user on planner_group_members (user_id);

-- ---------------------------------------------------------------------
-- Feedback -- a simple mailbox. Anyone signed in can submit; nobody can
-- read anyone else's submission except an admin (is_admin = true above).
-- There's no update/delete policy for regular users: feedback, once
-- sent, can't be edited or withdrawn -- like an email.
-- ---------------------------------------------------------------------

create table if not exists planner_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  -- Optional alternate reply-to; defaults to the account's own email if left blank.
  contact_email text,
  page text,
  created_at timestamptz not null default now(),
  -- Set true once someone has emailed/actioned it (admin-only, see below).
  handled boolean not null default false
);

alter table planner_feedback enable row level security;

create policy "submit your own feedback" on planner_feedback for insert
  with check (user_id = auth.uid());
create policy "read your own feedback" on planner_feedback for select
  using (user_id = auth.uid());

create or replace function public.planner_submit_feedback(p_message text, p_contact_email text, p_page text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into planner_feedback (user_id, message, contact_email, page)
  values (auth.uid(), p_message, nullif(trim(coalesce(p_contact_email, '')), ''), nullif(trim(coalesce(p_page, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- ICS calendar feed -- lets Apple/Google/Outlook calendars *subscribe* to
-- a read-only feed of the signed-in user's schedule, no OAuth needed. The
-- feed is fetched by calendar apps with no session/cookies, so it can't be
-- gated by RLS the normal way -- instead it's addressed by an unguessable
-- per-user token (ics_token) and served by a SECURITY DEFINER function that
-- resolves that token to its owner and returns ONLY that owner's schedule.
-- Anyone with the token can read that one person's schedule (titles and
-- times) -- nothing else -- which is the standard security model for
-- calendar subscribe links. Regenerating the token invalidates any old URL.
-- ---------------------------------------------------------------------

create or replace function public.planner_get_or_create_ics_token()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_token text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select ics_token into v_token from planner_profiles where id = auth.uid();
  if v_token is not null then return v_token; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  update planner_profiles set ics_token = v_token where id = auth.uid();
  return v_token;
end;
$$;

create or replace function public.planner_regenerate_ics_token()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_token text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  update planner_profiles set ics_token = v_token where id = auth.uid();
  return v_token;
end;
$$;

-- Read-only feed: given a valid ics_token, returns that user's stored
-- schedule blocks plus synthesized event occurrences (including recurring
-- events) for the next 60 days. Deliberately does NOT trigger a fresh
-- plan/replan -- calendar apps poll this frequently and it must stay fast
-- and side-effect-free. Returns zero rows for an unknown/rotated token
-- (rather than an error), so a stale subscribe URL just goes quiet.
create or replace function public.planner_ics_feed(p_token text)
returns table(id text, date date, start text, "end" text, type text, ref_id text, title text)
language sql
security definer set search_path = public
stable
as $$
  with owner as (
    select id from planner_profiles where ics_token = p_token
  ),
  range as (
    select current_date as from_date, current_date + 60 as to_date
  )
  select b.id, b.date::date, b.start, b."end", b.type, b.ref_id, b.title
  from planner_blocks b, owner, range
  where b.owner_id = owner.id
    and b.date::date between range.from_date and range.to_date

  union all

  select
    'event-block:' || e.id::text || ':' || d.day::text,
    d.day,
    e.start,
    e."end",
    'event',
    e.id::text,
    e.title
  from planner_events e, owner, range
  cross join lateral generate_series(range.from_date, range.to_date, interval '1 day') as d(day)
  where e.owner_id = owner.id
    and (
      (e.recurrence is null and e.date::date = d.day::date)
      or (
        e.recurrence is not null
        and d.day::date >= e.date::date
        and (e.recurrence->>'until' is null or d.day::date <= (e.recurrence->>'until')::date)
        and (e.recurrence->'daysOfWeek') @> to_jsonb(extract(dow from d.day)::int)
      )
    )
  order by date, start;
$$;

-- Explicit (belt-and-suspenders) grant: this must be callable with NO
-- session at all, since calendar apps poll it without ever signing in.
grant execute on function public.planner_ics_feed(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Admin -- read-only usage overview + the feedback inbox, gated by
-- planner_profiles.is_admin. This is NOT a bypass of Row Level Security:
-- every function here is still a normal SECURITY DEFINER function that
-- checks the caller first, the same pattern used for the group functions
-- above, and it grants READ access only, never write access to anyone
-- else's tasks/events/schedule content.
--
-- To make yourself an admin, run this once in the Supabase SQL editor
-- (never through the app -- there is deliberately no UI or API path that
-- can set this column; see the `grant update` above):
--   update planner_profiles set is_admin = true where email = 'you@example.com';
-- ---------------------------------------------------------------------

create or replace function public.is_planner_admin(p_user_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from planner_profiles where id = p_user_id), false);
$$;

-- Coarse, privacy-conscious usage counts -- no task/event titles, no
-- message bodies, just totals and a per-day signup/active count for the
-- last 90 days.
create or replace function public.planner_admin_overview()
returns table(
  total_users bigint,
  total_groups bigint,
  total_tasks bigint,
  total_events bigint,
  signups_last_7d bigint,
  signups_last_30d bigint,
  open_feedback bigint
)
language sql
security definer set search_path = public
stable
as $$
  select
    (select count(*) from planner_profiles),
    (select count(*) from planner_groups),
    (select count(*) from planner_tasks),
    (select count(*) from planner_events),
    (select count(*) from planner_profiles where created_at >= now() - interval '7 days'),
    (select count(*) from planner_profiles where created_at >= now() - interval '30 days'),
    (select count(*) from planner_feedback where not handled)
  where public.is_planner_admin(auth.uid());
$$;

-- Daily signups for the last 90 days, for a simple activity chart.
create or replace function public.planner_admin_signup_series()
returns table(day date, signups bigint)
language sql
security definer set search_path = public
stable
as $$
  select d.day, count(p.id)
  from generate_series(current_date - interval '89 days', current_date, interval '1 day') as d(day)
  left join planner_profiles p on p.created_at::date = d.day
  where public.is_planner_admin(auth.uid())
  group by d.day
  order by d.day;
$$;

create or replace function public.planner_admin_list_feedback()
returns table(id uuid, email text, display_name text, message text, contact_email text, page text, created_at timestamptz, handled boolean)
language sql
security definer set search_path = public
stable
as $$
  select f.id, p.email, p.display_name, f.message, f.contact_email, f.page, f.created_at, f.handled
  from planner_feedback f
  join planner_profiles p on p.id = f.user_id
  where public.is_planner_admin(auth.uid())
  order by f.created_at desc;
$$;

create or replace function public.planner_admin_set_feedback_handled(p_feedback_id uuid, p_handled boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_planner_admin(auth.uid()) then
    raise exception 'Only an admin can do that';
  end if;
  update planner_feedback set handled = p_handled where id = p_feedback_id;
end;
$$;

create index if not exists idx_planner_feedback_user on planner_feedback (user_id);
create index if not exists idx_planner_feedback_created on planner_feedback (created_at desc);
