-- Run once in the Supabase SQL editor for an existing project. Safe to
-- re-run. Adds:
--   1. planner_profiles.ics_token + the token get/rotate functions and the
--      planner_ics_feed(token) read-only feed, for the ICS calendar-
--      subscribe export (see src/app/api/ics/[token]/route.ts).
--   2. planner_profiles.last_seen_version, for the one-time "what's new"
--      changelog modal shown after an update (see src/lib/version.ts).

alter table planner_profiles add column if not exists ics_token text unique;
alter table planner_profiles add column if not exists last_seen_version text;

grant update (display_name, theme, last_seen_version) on planner_profiles to authenticated;

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

grant execute on function public.planner_ics_feed(text) to anon, authenticated;
