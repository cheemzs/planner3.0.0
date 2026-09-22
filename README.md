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

**UI**: dark theme for everyone (it does not follow the OS light/dark setting); desktop gets a sidebar, phones get a bottom tab bar with a "More" sheet, 16px form controls (so iOS doesn't zoom on focus) and safe-area padding for notches/home bars.

## Feedback email

The feedback form (`/feedback`) always saves to Supabase first — that's the durable record, visible at `/admin` or in the Supabase table editor. To *also* get an email copy at lucas.cheam@gmail.com:

1. Sign up at https://resend.com (free tier is enough) and create an API key.
2. Add to `.env.local` (and your Vercel project's environment variables):
   ```
   RESEND_API_KEY=re_your_key_here
   RESEND_FROM_EMAIL=Planner Feedback <feedback@yourdomain.com>
   ```
   `RESEND_FROM_EMAIL` needs a domain you've verified with Resend; for quick testing you can omit it and it falls back to Resend's shared `onboarding@resend.dev` sender.
3. Redeploy. No code changes needed — `src/lib/notify-feedback.ts` reads these at request time and no-ops (feedback still saves) if they're unset.

## Tracking user activity

Two things are already built in (see "Admin" above): `/admin` shows feature-usage totals and a signup chart, and every submitted feedback message is visible there.

For broader activity tracking (page views, request volume, geography), the lower-effort option is **Vercel Analytics** — a toggle in your Vercel project's dashboard, no code changes. Supabase's own **Authentication → Users** page also shows each user's sign-up date and last sign-in, with no setup needed.

## Setup

### 1. Create a Supabase project

1. [supabase.com](https://supabase.com) → New project.
2. **SQL Editor** → run the contents of [`supabase/schema.sql`](./supabase/schema.sql). This creates: the private per-user tables (`planner_tasks`, `planner_events`, `planner_blocks`, `planner_availability`, all Row Level Security-enforced), `planner_profiles` (auto-populated on signup via a trigger), `planner_groups` / `planner_group_members`, and `SECURITY DEFINER` Postgres functions. Every group write (create, join, leave, approve/decline, remove, transfer organiser, settings, new invite code) goes through one of them — there are deliberately no insert/update policies on the group tables — and each checks the caller is the organiser (or an active member) itself. The read functions (`planner_group_roster`, `planner_group_busy_times`, `planner_group_availability`) are the *only* way any cross-person data is ever read, and only between *active* members of the same group. Run this on a fresh project. **If you already ran an earlier `schema.sql`, don't re-run it — run `supabase/migrations/2026-09-profile-display-name.sql` instead** (safe to run more than once; it adds the display-name length check and column-level grant, and stops the roster from returning other members' emails). The profile page itself works even before you run it, but until then users could still edit their own `email` column through the API and members would still receive each other's emails.
3. **Authentication → Settings**: you can turn off "Confirm email" if you want people to sign up and start using it immediately without an email confirmation step first (reasonable for a trusted group; leave it on for more friction/security).
4. **Settings → API**: copy the **Project URL** and the **`anon` `public` key** (not `service_role` — see Security below).

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```
Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

### 3. Run locally

```bash
npm install
npm run dev
```
Open `http://localhost:3000` → sign up → you'll see a "Get started" checklist on the Today page. Set your **Availability**, add a **Task**, hit **Plan Today**. Create a **Group** to get an invite code, and have a friend (their own account) join it with that code — you'll then show up in each other's `/group/[id]` finder for that group only.

### 4. Deploy (GitHub + Vercel)

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → New Project → import the repo.
3. Vercel project → **Settings → Environment Variables** → add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. Deploy. Every push to your default branch auto-deploys. Share the URL — each person creates their own account and gets their own fully private planner, plus the ability to create/join groups.

## Security

Postgres Row Level Security is the real enforcement boundary, not app code. The app talks to Supabase using the public `anon` key plus each user's signed-in session; every RLS policy in `supabase/schema.sql` keys off `auth.uid()`. The only cross-person data access is through the `SECURITY DEFINER` functions listed above, each of which re-checks shared group membership on every call — never a blanket "any signed-in user can read this" grant.

**Never** swap the app's Supabase client over to the `service_role` key for normal operation — that key bypasses RLS entirely.

## Architecture

```
Form submit (or page load)
 -> Server Action / Server Component (src/app/**)
 -> src/lib/engine-service.ts   (async facade)          -> src/lib/group-finder.ts (group availability)
 -> src/lib/repository.ts       (Supabase/Postgres persistence, RLS-scoped per request)
 -> src/lib/supabase/server.ts  (per-request client bound to the signed-in user's cookies)
 -> src/lib/engine/*            (the actual solver -- pure functions, zero I/O, zero AI)
```

`src/lib/engine/` is the same framework-agnostic, independently-tested constraint-based planning engine throughout this project's history: hard constraints first via `constraints.ts`, then the objective-driven local-search optimizer in `optimizer.ts`, day-level placement in `day-placement.ts`, weekly/monthly wrapping, feasibility analysis, dynamic rescheduling, next-action, free-time fitting, task splitting, and `intersectRanges` in `time-utils.ts` for the group finder. Only the persistence layer, auth model, and group concept changed on top of it.

`src/middleware.ts` refreshes the Supabase session on every request, sends signed-out visitors to `/login` (remembering where they were headed) and signed-in users away from it. It **must** live in `src/` because the app uses a `src/` directory — Next.js silently ignores a `middleware.ts` in the project root in that case, which used to let signed-out visitors reach the pages and crash with a 500 `Not signed in`. As a second line of defence, `requireUserId()` redirects to `/login` rather than throwing.

## Running the tests

```bash
npm run test         # 150 tests -- the planning engine, group insights/period logic, SGT clock/timezone handling, login-redirect safety, display-name validation; no DB needed
npm run typecheck     # tsc --noEmit (app layer, with Next.js/DOM types)
npx tsc --noEmit -p tsconfig.engine.json   # engine + repository layer on their own
```

## Honest status / what I could not verify

- **150/150 unit tests pass**, including the new group-insights engine (best window, "different people free in adjacent hours ≠ a shared block", weekday/time-of-day patterns, tie-breaking), planning-period resolution (month-end clamping, rolling vs fixed, ended/upcoming), and timezone handling.
- **The organiser/approval permission model was executed against a real PostgreSQL 16** with Supabase-style stand-ins (`auth.uid()`, the `authenticated` role, RLS on): 67 scenario checks in `supabase/tests/rls_scenarios.py` (including the profile rules: own-row-only edits, `display_name`-only column grant, length check, roster emails withheld from non-organisers, and the migration applied on top of the previous schema) — e.g. a pending user sees nothing and the organiser can't read a pending user's busy times until approved; non-organisers can't approve/remove/change settings/transfer; direct table writes can't self-approve or take over a group; the organiser can't abandon a group without handing it over.
- **The app ran end-to-end against that database** through a small PostgREST/GoTrue stand-in I wrote, with a headless browser at desktop (1280px) and phone (390px) widths: 111 checks (50 for groups/insights/mobile + 61 for sign-in/sign-out/profile, driven through the real `@supabase/ssr` cookie flow) covering signed-out redirects, the single-form login and its switch to sign-up, profile edit persisting across refresh and re-login, dark rendering (including with the OS set to light), no horizontal overflow, the tab bar/"More" sheet, the insights and calendar, approving a request, saving settings (year view renders 12+ months), friendly errors instead of crash pages, and non-organisers / pending users / outsiders being kept out.
- **The whole app builds cleanly** (`npm run build`), including the new `/group/[groupId]/manage` route.
- **What I still have not done: run it against a real Supabase project** (real GoTrue sign-up, real PostgREST). The stand-in is mine, not Supabase's, so real-world quirks could still exist — most likely candidates: the `pg_timezone_names` check in `planner_create_group` / `planner_update_group` (should be fine on Supabase, and every timezone the UI offers was verified against Postgres), and email-confirmation flow. If group creation fails, run `select planner_create_group('x','UTC')` as an authenticated user in the SQL editor with `set local role authenticated; select set_config('request.jwt.claims','{\"sub\":\"<uuid>\"}',true);` first.
- **Everything runs on Singapore Time (SGT, UTC+8).** "Today", "now", the planner's don't-schedule-in-the-past rule and the group insights all use one clock pinned to `Asia/Singapore` (`APP_TIMEZONE` in `src/lib/engine/time-utils.ts`), never the server's own timezone (which is UTC on Vercel). The tests are pinned to explicit instants and pass under `TZ=UTC`, `TZ=America/Los_Angeles` and `TZ=Asia/Singapore`. New groups default to SGT; an organiser can still pick another timezone for a group in Manage → Settings.
- **No transactions** beyond what's wrapped in the `SECURITY DEFINER` functions (group creation/joining are atomic; task splitting and day-replanning are sequential awaited calls, not one transaction). Fine for normal personal/small-group use.
- **TypeScript is pinned to an exact version (`5.9.3`)** in `package.json` rather than a caret range — a TypeScript 6.0 was published to npm partway through building this and isn't necessarily something Next.js 14.2's tooling has been tested against yet, so this avoids an unexpected major-version jump on a fresh `npm install`. Worth revisiting if you upgrade Next.js later.

## What's deliberately out of scope (Phase 1)

Preference learning, an interactive apply/reject diff UI for reschedule previews (the `ScheduleDiff` type is already returned by every reschedule call), true minute-level month planning (by design, milestone/feasibility-level only), password reset / magic-link login (email+password only), banning a removed member from re-requesting with the same invite code (regenerate the code instead), co-organisers, notifications when a join request arrives, and a light theme.

If this grows beyond a friend-group tool, the next real additions (deliberately not built yet, since they add real complexity for a "just my friends for now" scope) would be: password reset, rate limiting on auth endpoints, error monitoring, and — if it becomes a paid product later — Stripe billing. None of those are needed for the current scope.
