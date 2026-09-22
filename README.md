# Personal Planner + Group Availability Finder

A constraint-based personal planning and scheduling engine — no AI/LLM anywhere. Everything is deterministic: hard constraints (dependencies, fixed events, availability, deadline feasibility) are checked first, then a local-search optimizer finds the best feasible schedule, balancing workload, mental load, context-switching, and breaks.

Each person gets their own fully private account: tasks, events, schedule, and availability. On top of that, anyone can **create or join any number of groups** via an invite code (roommates, a friend group, a study group, family — as many separate groups as you like), and within a specific group, find the windows where everyone in it is actually free — without exposing anyone's task titles or what their busy time is *for*, and without groups being able to see into each other at all.

Stack: **Next.js** (App Router, Server Actions — plain HTML forms) + **Supabase** (Postgres + Auth). Deploys to **Vercel**, source lives on **GitHub**. Mobile-responsive (the nav collapses to a horizontal scroll bar under ~720px; tables scroll horizontally rather than overflowing).

## What it does

**Personal planner** (private to each account):
- Tasks with priority, **mental workload (1-5 difficulty)**, estimated/remaining time, deadlines, dependencies, preferred time of day, min/max session length
- Fixed or flexible events (school, appointments, exams, sports)
- Configurable availability — wake/sleep, work windows, daily breaks, target utilization, buffer between sessions
- Day/week/month planning: the week planner spreads large tasks across multiple days ahead of a deadline; the optimizer balances daily workload
- Dynamic rescheduling: "couldn't do it," "interrupted" (log actual minutes spent), unexpected events auto-reschedule conflicts
- Task splitting into ordered, dependency-chained phases
- "What should I do right now?" / "I have N minutes free"
- Feasibility check: "you have 17 hours of work but only 10 available" — names exactly which task is at risk
- A first-run checklist on the Today page (set hours → add a task → optionally join a group) so a new account isn't just a wall of empty forms

**Groups** (`/groups`, `/group/[groupId]`, `/group/[groupId]/manage`):
- Create a group (you become its **organiser**) or join one with an invite code — unlimited groups per person, each fully separate
- **Organiser controls** (`/manage`, organiser-only, enforced in Postgres): approve or decline join requests, remove members, hand the organiser role to someone else, regenerate the invite code, delete the group, and choose:
  - the **planning period** — 1 week, 2 weeks, 1 month, 2 months, 3 months, 6 months, 1 year, or custom dates (max 400 days) — either *rolling* (always starts today) or from a fixed start date
  - the **minimum block** that counts as time together (15 min – 6 h), the group **timezone** (defaults to SGT), and whether joining needs approval (on by default; off = instant join)
- By default a join request is **pending**: the person sees only "waiting for approval" — nothing about the group, and nothing about them is visible to it, until approved
- **Group insights, shown to every member** (same answer for everyone): the best time for the group (the most people free together through one continuous block, with who's in and who's out), the soonest day and longest block when *everyone* is free, runner-up slots, days-everyone's-free and total time together, which weekdays and which time of day (morning / afternoon / evening) work best, and a colour-coded calendar of the whole period — tap a day for each member's free windows
- The insights say so when a member hasn't set their hours yet (default hours are assumed for them), and never suggest a time that has already passed (in SGT by default)
- A custom search is still there: any subset of members + any date range + minimum block
- Privacy: only busy *time ranges* and hours *patterns* are ever compared, scoped to one specific shared group at a time, and only for *active* members — nobody can see anyone else's task titles, descriptions, or what a block of busy time is for, and being in one group grants zero visibility into a different group you're not in.

**Accounts & profile**:
- `/login` shows a single Sign in form; "Don't have an account yet? **Create one**" swaps it for the sign-up form (and back). Works without JavaScript too. Post-login redirects only ever follow same-site paths.
- `/profile` (in the sidebar, and under **More** on phones) lets the signed-in user edit their **display name**, stored in `planner_profiles.display_name`. It's what other members see in group rosters and results. 1–40 characters, no invisible/control characters. Only the session decides whose profile is edited, RLS restricts the row to its owner, and a column-level grant means `display_name` is the only column a user can change.
- Members never receive each other's email addresses — only the organiser does (on the Manage page, to identify people they're admitting or removing). Users see only their own email.
- **Theme**: dark (default) or pink (bubblegum pink `#FFB7D9` + butter yellow `#FFE7A8`), chosen on `/profile`, saved to `planner_profiles.theme`, applied server-side via `data-theme` on `<html>` so there's no flash of the wrong theme. It's per-account, not per-device or OS setting. The login page always stays dark.
- **Feedback** (`/feedback`): a short message form that saves to `planner_feedback` (RLS: submit/read your own only) and, if `RESEND_API_KEY` is set, also emails a copy to lucas.cheam@gmail.com via Resend (https://resend.com). Without that env var, submissions still save fine — see "Feedback email" below.
- **Admin** (`/admin`, visible only to admins): read-only usage overview (user/group/task/event counts, a 90-day signup chart) and the feedback inbox. There is deliberately **no in-app way to become an admin** — `is_admin` can only be set by running SQL directly in the Supabase SQL editor (see schema.sql / the migration file). Every admin function still checks the caller's admin status inside Postgres itself, so it's an RLS-governed elevated *read* role, not a bypass of RLS and not a hidden backdoor.

## What's deliberately out of scope (Phase 1)

Preference learning, an interactive apply/reject diff UI for reschedule previews (the `ScheduleDiff` type is already returned by every reschedule call), true minute-level month planning (by design, milestone/feasibility-level only), password reset / magic-link login (email+password only), banning a removed member from re-requesting with the same invite code (regenerate the code instead), co-organisers, notifications when a join request arrives, and a light theme.

If this grows beyond a friend-group tool, the next real additions (deliberately not built yet, since they add real complexity for a "just my friends for now" scope) would be: password reset, rate limiting on auth endpoints, error monitoring, and — if it becomes a paid product later — Stripe billing. None of those are needed for the current scope.
