-- Profile / display-name update. Safe to run more than once.
-- Only needed if you ALREADY ran an earlier supabase/schema.sql; a fresh
-- install of the current schema.sql already includes all of this.
--
--  1. Users can edit only the display_name column of their own profile
--     (RLS already limits them to their own row).
--  2. display_name must be 1-40 characters (existing rows are left alone).
--  3. The signup trigger truncates the email-prefix default to 40 characters,
--     so a very long email can't make signup fail on the new limit.
--  4. planner_group_roster() no longer hands every member the other members'
--     email addresses; only the organiser receives them.

-- 1
revoke update on public.planner_profiles from anon, authenticated;
grant update (display_name) on public.planner_profiles to authenticated;

-- 2 (NOT VALID: applies to new/changed values without failing on any existing row)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'planner_profiles_display_name_len') then
    alter table public.planner_profiles
      add constraint planner_profiles_display_name_len
      check (display_name is null or char_length(btrim(display_name)) between 1 and 40) not valid;
  end if;
end $$;

-- 3
create or replace function public.handle_new_planner_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.planner_profiles (id, email, display_name)
  values (new.id, new.email, nullif(left(split_part(coalesce(new.email, 'user'), '@', 1), 40), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 4 (same signature and return type as before, so a plain CREATE OR REPLACE works)
create or replace function public.planner_group_roster(p_group_id uuid)
returns table(id uuid, email text, display_name text, is_organiser boolean, joined_at timestamptz)
language sql
security definer set search_path = public
stable
as $$
  select p.id,
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
