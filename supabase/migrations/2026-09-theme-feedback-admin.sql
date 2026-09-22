-- Theme preference, feedback inbox, and read-only admin views. Safe to run
-- more than once. Only needed if you already ran an earlier schema.sql; a
-- fresh install of the current schema.sql already includes all of this.

-- 1. Theme preference (defaults everyone to 'dark', today's behaviour).
alter table public.planner_profiles add column if not exists theme text not null default 'dark';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'planner_profiles_theme_valid') then
    alter table public.planner_profiles
      add constraint planner_profiles_theme_valid check (theme in ('dark','pink'));
  end if;
end $$;

-- 2. is_admin flag. NOT settable through the app -- see step 4's grant, and
-- the instructions at the bottom of this file for how to set it yourself.
alter table public.planner_profiles add column if not exists is_admin boolean not null default false;

-- 3. Update the signup trigger to populate both new columns.
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

-- 4. Let users change their own theme (display_name was already grantable;
-- this widens that same grant -- is_admin is deliberately never included).
revoke update on public.planner_profiles from anon, authenticated;
grant update (display_name, theme) on public.planner_profiles to authenticated;

-- 5. Feedback table + RLS (insert/read your own only).
create table if not exists public.planner_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  contact_email text,
  page text,
  created_at timestamptz not null default now(),
  handled boolean not null default false
);
alter table public.planner_feedback enable row level security;
drop policy if exists "submit your own feedback" on public.planner_feedback;
create policy "submit your own feedback" on public.planner_feedback for insert
  with check (user_id = auth.uid());
drop policy if exists "read your own feedback" on public.planner_feedback;
create policy "read your own feedback" on public.planner_feedback for select
  using (user_id = auth.uid());
create index if not exists idx_planner_feedback_user on public.planner_feedback (user_id);
create index if not exists idx_planner_feedback_created on public.planner_feedback (created_at desc);

create or replace function public.planner_submit_feedback(p_message text, p_contact_email text, p_page text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.planner_feedback (user_id, message, contact_email, page)
  values (auth.uid(), p_message, nullif(trim(coalesce(p_contact_email, '')), ''), nullif(trim(coalesce(p_page, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- 6. Admin read functions -- see schema.sql for the full explanation of why
-- these are not a bypass of RLS.
create or replace function public.is_planner_admin(p_user_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$ select coalesce((select is_admin from public.planner_profiles where id = p_user_id), false); $$;

create or replace function public.planner_admin_overview()
returns table(total_users bigint, total_groups bigint, total_tasks bigint, total_events bigint, signups_last_7d bigint, signups_last_30d bigint, open_feedback bigint)
language sql security definer set search_path = public stable
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

create or replace function public.planner_admin_signup_series()
returns table(day date, signups bigint)
language sql security definer set search_path = public stable
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
language sql security definer set search_path = public stable
as $$
  select f.id, p.email, p.display_name, f.message, f.contact_email, f.page, f.created_at, f.handled
  from planner_feedback f
  join planner_profiles p on p.id = f.user_id
  where public.is_planner_admin(auth.uid())
  order by f.created_at desc;
$$;

create or replace function public.planner_admin_set_feedback_handled(p_feedback_id uuid, p_handled boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_planner_admin(auth.uid()) then raise exception 'Only an admin can do that'; end if;
  update planner_feedback set handled = p_handled where id = p_feedback_id;
end;
$$;

-- ---------------------------------------------------------------------
-- To make yourself an admin, run (once, in the Supabase SQL editor):
--   update planner_profiles set is_admin = true where email = 'you@example.com';
-- There is no other way to set this column -- see step 4 above.
-- ---------------------------------------------------------------------
