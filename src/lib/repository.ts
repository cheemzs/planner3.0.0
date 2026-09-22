import { createSupabaseServerClient, requireUser, requireUserId } from './supabase/server';
import { defaultAvailability, eventsOnDate } from './engine/availability';
import { rangesOverlap, timeToMinutes } from './engine/time-utils';
import { planTaskSplit, type SplitPhase } from './engine/task-split';
import type { PeriodKind } from './engine/group-period';
import type {
  AvailabilityConfig,
  ISODate,
  NewPlanEvent,
  NewPlanTask,
  PlanEvent,
  PlanTask,
  ScheduleBlock,
  TaskStatus,
} from './engine/types';

/**
 * Ownership / sharing model: every task and event has an `owner_id`. If
 * it's set, the row is private to that person; if it's NULL, it's
 * "shared" -- visible and editable by every signed-in user (see
 * supabase/schema.sql). This module never manually filters by owner for
 * *reads* -- Postgres Row Level Security does that automatically based on
 * the authenticated session carried by the Supabase client from
 * ./supabase/server. For *writes* it explicitly stamps owner_id (null for
 * shared, the current user's id for private) since the caller has to say
 * which one they want.
 *
 * Known limitation vs. an earlier SQLite version of this repository:
 * Postgres via supabase-js doesn't give us simple client-side multi-
 * statement transactions without a database function/RPC. Multi-step
 * operations below (splitTask, saveGeneratedBlocks) run as sequential
 * awaited calls rather than one atomic transaction. For personal/small-
 * group use with infrequent concurrent writes to the *same* row this is a
 * reasonable trade-off, but it is not the same ACID guarantee a real
 * transaction gives you.
 */

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function taskFromRow(row: any): PlanTask & { ownerId: string | null } {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    projectId: row.project_id ?? undefined,
    goalId: row.goal_id ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority,
    importance: row.importance == null ? undefined : Number(row.importance),
    difficulty: row.difficulty == null ? undefined : Number(row.difficulty),
    estimatedMinutes: Number(row.estimated_minutes),
    remainingMinutes: Number(row.remaining_minutes),
    deadline: row.deadline ?? undefined,
    earliestStart: row.earliest_start ?? undefined,
    latestCompletion: row.latest_completion ?? undefined,
    preferredTimeOfDay: row.preferred_time_of_day ?? undefined,
    minChunkMinutes: row.min_chunk_minutes == null ? undefined : Number(row.min_chunk_minutes),
    maxChunkMinutes: row.max_chunk_minutes == null ? undefined : Number(row.max_chunk_minutes),
    dependsOn: row.depends_on ?? [],
    recurrence: row.recurrence ?? undefined,
    tags: row.tags ?? [],
    autoSchedulable: row.auto_schedulable !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    ownerId: row.owner_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function taskToRow(task: Omit<PlanTask, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): any {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    project_id: task.projectId ?? null,
    goal_id: task.goalId ?? null,
    status: task.status,
    priority: task.priority,
    importance: task.importance ?? null,
    difficulty: task.difficulty ?? null,
    estimated_minutes: task.estimatedMinutes,
    remaining_minutes: task.remainingMinutes,
    deadline: task.deadline ?? null,
    earliest_start: task.earliestStart ?? null,
    latest_completion: task.latestCompletion ?? null,
    preferred_time_of_day: task.preferredTimeOfDay ?? null,
    min_chunk_minutes: task.minChunkMinutes ?? null,
    max_chunk_minutes: task.maxChunkMinutes ?? null,
    depends_on: task.dependsOn ?? [],
    recurrence: task.recurrence ?? null,
    tags: task.tags ?? [],
    auto_schedulable: task.autoSchedulable !== false,
    completed_at: task.completedAt ?? null,
    updated_at: nowIso(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eventFromRow(row: any): PlanEvent & { ownerId: string | null } {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    date: row.date,
    start: row.start,
    end: row.end,
    fixed: row.fixed !== false,
    recurrence: row.recurrence ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerId: row.owner_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockFromRow(row: any): ScheduleBlock {
  return {
    id: row.id,
    date: row.date,
    start: row.start,
    end: row.end,
    type: row.type,
    refId: row.ref_id ?? undefined,
    title: row.title,
    locked: Boolean(row.locked),
    source: row.source,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function blockToRow(b: ScheduleBlock, ownerId: string): any {
  return {
    id: b.id,
    owner_id: ownerId,
    date: b.date,
    start: b.start,
    end: b.end,
    type: b.type,
    ref_id: b.refId ?? null,
    title: b.title,
    locked: b.locked,
    source: b.source,
    reason: b.reason ?? null,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function check<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(input: NewPlanTask): Promise<PlanTask> {
  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId();
  const now = nowIso();
  const row = taskToRow({
    ...input,
    id: undefined as unknown as string,
    status: input.status ?? 'pending',
    remainingMinutes: input.remainingMinutes ?? input.estimatedMinutes,
    createdAt: now,
    updatedAt: now,
  } as PlanTask);
  delete row.id;
  row.created_at = now;
  row.owner_id = userId;
  const result = await supabase.from('planner_tasks').insert(row).select().single();
  return taskFromRow(check(result, 'createTask'));
}

export async function getTask(id: string): Promise<(PlanTask & { ownerId: string | null }) | undefined> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_tasks').select('*').eq('id', id).maybeSingle();
  if (result.error) throw new Error(`getTask: ${result.error.message}`);
  return result.data ? taskFromRow(result.data) : undefined;
}

export interface ListTasksFilter {
  status?: TaskStatus | TaskStatus[];
  projectId?: string;
}

/** RLS scopes results to just the signed-in user's own tasks. */
export async function listTasks(filter: ListTasksFilter = {}): Promise<(PlanTask & { ownerId: string | null })[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('planner_tasks').select('*').order('created_at', { ascending: true });
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    query = query.in('status', statuses);
  }
  if (filter.projectId) query = query.eq('project_id', filter.projectId);
  const result = await query;
  if (result.error) throw new Error(`listTasks: ${result.error.message}`);
  return (result.data ?? []).map(taskFromRow);
}

export async function updateTask(id: string, patch: Partial<Omit<PlanTask, 'id' | 'createdAt'>>): Promise<PlanTask> {
  const existing = await getTask(id);
  if (!existing) throw new Error(`Task not found: ${id}`);
  const merged: PlanTask = { ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: nowIso() };
  const row = taskToRow(merged);
  delete row.id;
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_tasks').update(row).eq('id', id).select().single();
  return taskFromRow(check(result, 'updateTask'));
}

export async function completeTask(id: string): Promise<PlanTask> {
  return updateTask(id, { status: 'completed', remainingMinutes: 0, completedAt: nowIso() });
}

/** Deletes a task, its schedule blocks, and un-blocks any dependents. RLS also guarantees this only succeeds for a task you're allowed to touch (yours, or shared). */
export async function deleteTask(id: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const existing = await getTask(id);
  if (!existing) return false;

  await supabase.from('planner_blocks').delete().eq('ref_id', id);

  const all = await listTasks({});
  const dependents = all.filter((t) => (t.dependsOn ?? []).includes(id));
  for (const dep of dependents) {
    await updateTask(dep.id, { dependsOn: (dep.dependsOn ?? []).filter((d) => d !== id) });
  }

  const result = await supabase.from('planner_tasks').delete().eq('id', id);
  if (result.error) throw new Error(`deleteTask: ${result.error.message}`);
  return true;
}

/** Splits a task into ordered, dependency-chained sub-tasks. */
export async function splitTask(id: string, phases?: SplitPhase[]): Promise<PlanTask[]> {
  const original = await getTask(id);
  if (!original) throw new Error(`Task not found: ${id}`);

  const plannedSubtasks = planTaskSplit(original, phases);
  const created: PlanTask[] = [];
  let previousRealId: string | undefined;

  for (const sub of plannedSubtasks) {
    const { _tempId, dependsOn: _placeholderDeps, ...rest } = sub;
    void _tempId;
    void _placeholderDeps;
    const dependsOn = previousRealId ? [previousRealId] : [];
    const task = await createTask({ ...rest, dependsOn });
    created.push(task);
    previousRealId = task.id;
  }

  const all = await listTasks({});
  const dependents = all.filter((t) => (t.dependsOn ?? []).includes(id));
  for (const dep of dependents) {
    const nextDeps = (dep.dependsOn ?? []).filter((d) => d !== id);
    if (previousRealId) nextDeps.push(previousRealId);
    await updateTask(dep.id, { dependsOn: nextDeps });
  }

  await updateTask(id, {
    status: 'cancelled',
    remainingMinutes: 0,
    description: `${original.description ? original.description + ' ' : ''}(Split into ${created.length} sub-tasks.)`,
  });

  return created;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function createEvent(input: NewPlanEvent): Promise<PlanEvent> {
  if (timeToMinutes(input.end) <= timeToMinutes(input.start)) {
    throw new Error(`Event "${input.title}" has end <= start (${input.start}-${input.end}).`);
  }
  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId();
  const now = nowIso();
  const result = await supabase
    .from('planner_events')
    .insert({
      title: input.title,
      description: input.description ?? null,
      date: input.date,
      start: input.start,
      end: input.end,
      fixed: input.fixed,
      recurrence: input.recurrence ?? null,
      category: input.category ?? null,
      owner_id: userId,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  return eventFromRow(check(result, 'createEvent'));
}

export async function getEvent(id: string): Promise<(PlanEvent & { ownerId: string | null }) | undefined> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_events').select('*').eq('id', id).maybeSingle();
  if (result.error) throw new Error(`getEvent: ${result.error.message}`);
  return result.data ? eventFromRow(result.data) : undefined;
}

/** RLS scopes results to just the signed-in user's own events. */
export async function listEvents(): Promise<(PlanEvent & { ownerId: string | null })[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase
    .from('planner_events')
    .select('*')
    .order('date', { ascending: true })
    .order('start', { ascending: true });
  if (result.error) throw new Error(`listEvents: ${result.error.message}`);
  return (result.data ?? []).map(eventFromRow);
}

export async function updateEvent(id: string, patch: Partial<Omit<PlanEvent, 'id' | 'createdAt'>>): Promise<PlanEvent> {
  const existing = await getEvent(id);
  if (!existing) throw new Error(`Event not found: ${id}`);
  const merged: PlanEvent = { ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: nowIso() };
  if (timeToMinutes(merged.end) <= timeToMinutes(merged.start)) {
    throw new Error(`Event "${merged.title}" would have end <= start (${merged.start}-${merged.end}).`);
  }
  const supabase = await createSupabaseServerClient();
  const result = await supabase
    .from('planner_events')
    .update({
      title: merged.title,
      description: merged.description ?? null,
      date: merged.date,
      start: merged.start,
      end: merged.end,
      fixed: merged.fixed,
      recurrence: merged.recurrence ?? null,
      category: merged.category ?? null,
      updated_at: merged.updatedAt,
    })
    .eq('id', id)
    .select()
    .single();
  return eventFromRow(check(result, 'updateEvent'));
}

export async function deleteEvent(id: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_events').delete().eq('id', id);
  if (result.error) throw new Error(`deleteEvent: ${result.error.message}`);
  return true;
}

// ---------------------------------------------------------------------------
// Availability -- always personal, one row per user.
// ---------------------------------------------------------------------------

export async function getAvailability(): Promise<AvailabilityConfig> {
  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId();
  const result = await supabase.from('planner_availability').select('*').eq('owner_id', userId).maybeSingle();
  if (result.error) throw new Error(`getAvailability: ${result.error.message}`);
  if (!result.data) return defaultAvailability();
  return result.data.config as AvailabilityConfig;
}

/** True once the user has explicitly saved their own hours (as opposed to just seeing the engine's fallback default). Used for first-run onboarding. */
export async function hasConfiguredAvailability(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId();
  const result = await supabase.from('planner_availability').select('owner_id').eq('owner_id', userId).maybeSingle();
  if (result.error) throw new Error(`hasConfiguredAvailability: ${result.error.message}`);
  return result.data != null;
}

export async function setAvailability(config: AvailabilityConfig): Promise<AvailabilityConfig> {
  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId();
  const result = await supabase
    .from('planner_availability')
    .upsert({ owner_id: userId, config, updated_at: nowIso() })
    .select()
    .single();
  check(result, 'setAvailability');
  return config;
}

// ---------------------------------------------------------------------------
// Schedule blocks -- always personal (RLS restricts these to the signed-in
// user no matter what; see schema.sql).
// ---------------------------------------------------------------------------

export async function listStoredBlocks(filter: { from?: ISODate; to?: ISODate; date?: ISODate } = {}): Promise<ScheduleBlock[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('planner_blocks').select('*').order('date', { ascending: true }).order('start', { ascending: true });
  if (filter.date) query = query.eq('date', filter.date);
  if (filter.from) query = query.gte('date', filter.from);
  if (filter.to) query = query.lte('date', filter.to);
  const result = await query;
  if (result.error) throw new Error(`listStoredBlocks: ${result.error.message}`);
  return (result.data ?? []).map(blockFromRow);
}

/** Merges the signed-in user's stored blocks with synthesized event blocks (their private events + all shared events) for display. */
export async function getScheduleForRange(from: ISODate, to: ISODate): Promise<ScheduleBlock[]> {
  const stored = await listStoredBlocks({ from, to });
  const events = await listEvents();
  const dates = enumerateDates(from, to);
  const eventBlocks: ScheduleBlock[] = [];
  for (const date of dates) {
    for (const ev of eventsOnDate(events, date)) {
      eventBlocks.push({
        id: `event-block:${ev.id}:${date}`,
        date,
        start: ev.start,
        end: ev.end,
        type: 'event',
        refId: ev.id,
        title: ev.title,
        locked: ev.fixed,
        source: 'manual',
        createdAt: ev.createdAt,
        updatedAt: ev.updatedAt,
      });
    }
  }
  return [...stored, ...eventBlocks].sort((a, b) =>
    a.date === b.date ? timeToMinutes(a.start) - timeToMinutes(b.start) : a.date < b.date ? -1 : 1,
  );
}

function enumerateDates(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let d = from;
  while (d <= to) {
    out.push(d);
    const [y, m, day] = d.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, day + 1));
    d = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
  return out;
}

function validateNoOverlaps(blocks: ScheduleBlock[]): void {
  const byDate = new Map<string, ScheduleBlock[]>();
  for (const b of blocks) {
    const arr = byDate.get(b.date) ?? [];
    arr.push(b);
    byDate.set(b.date, arr);
  }
  for (const [date, dayBlocks] of byDate) {
    const sorted = [...dayBlocks].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (
        rangesOverlap(
          { start: timeToMinutes(prev.start), end: timeToMinutes(prev.end) },
          { start: timeToMinutes(cur.start), end: timeToMinutes(cur.end) },
        )
      ) {
        throw new Error(
          `Refusing to save overlapping schedule blocks on ${date}: "${prev.title}" (${prev.start}-${prev.end}) overlaps "${cur.title}" (${cur.start}-${cur.end}).`,
        );
      }
    }
  }
}

/**
 * Persists freshly-generated task/break/buffer blocks (always owned by
 * the signed-in user) for the given dates, replacing whatever auto-
 * generated blocks previously existed for those dates while preserving
 * manually-locked blocks. Validates no overlaps before writing anything.
 */
export async function saveGeneratedBlocks(dates: ISODate[], blocks: ScheduleBlock[]): Promise<void> {
  const toStore = blocks.filter((b) => b.type !== 'event');
  validateNoOverlaps(toStore);

  const supabase = await createSupabaseServerClient();
  const userId = await requireUserId();

  for (const date of dates) {
    const existing = await listStoredBlocks({ date });
    const keepIds = existing.filter((b) => b.locked).map((b) => b.id);
    let del = supabase.from('planner_blocks').delete().eq('date', date).eq('owner_id', userId);
    if (keepIds.length > 0) del = del.not('id', 'in', `(${keepIds.map((id) => `"${id}"`).join(',')})`);
    const delResult = await del;
    if (delResult.error) throw new Error(`saveGeneratedBlocks (clear ${date}): ${delResult.error.message}`);
  }

  const newRows = toStore.map((b) => blockToRow(b, userId));
  if (newRows.length > 0) {
    const insertResult = await supabase.from('planner_blocks').upsert(newRows);
    if (insertResult.error) throw new Error(`saveGeneratedBlocks (insert): ${insertResult.error.message}`);
  }
}

export async function deleteBlocksForDate(date: ISODate): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_blocks').delete().eq('date', date);
  if (result.error) throw new Error(`deleteBlocksForDate: ${result.error.message}`);
}

// ---------------------------------------------------------------------------
// Groups -- create/join any number of groups via invite code. Every group has
// one organiser who admits people and controls the group's settings. All
// cross-person visibility (roster, busy times, availability) is scoped to
// ACTIVE members of a specific shared group via SECURITY DEFINER Postgres
// functions (see schema.sql) -- never broad "any signed-in user" access, and
// a pending join request grants no visibility at all.
//
// Every organiser-only operation below is authorised inside Postgres, not
// here: calling these as a non-organiser fails with "Only the organiser can
// do that" no matter what the UI shows.
// ---------------------------------------------------------------------------

export type { PeriodKind };

export interface PlannerGroup {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  organiserId: string;
  createdAt: string;
  /** IANA timezone that defines "today"/"now" for this group. */
  timezone: string;
  periodKind: PeriodKind;
  /** null = rolling (window starts today). */
  periodStart: ISODate | null;
  /** Only used by periodKind === 'custom'. */
  periodEnd: ISODate | null;
  minBlockMinutes: number;
  requireApproval: boolean;
}

export type JoinStatus = 'active' | 'pending';

export type Theme = 'dark' | 'pink';
export const THEMES: Theme[] = ['dark', 'pink'];
export function isTheme(v: string): v is Theme {
  return (THEMES as string[]).includes(v);
}

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  theme: Theme;
  isAdmin: boolean;
  /** App version this person last saw the "what's new" changelog for; null if never shown. */
  lastSeenVersion: string | null;
}

export interface GroupMember {
  id: string;
  displayName: string | null;
  /** Only present when the caller is the group's organiser (Postgres withholds it from everyone else). */
  email: string | null;
  isOrganiser: boolean;
  joinedAt: string;
}

export interface JoinRequest {
  id: string;
  email: string;
  displayName: string | null;
  requestedAt: string;
}

export interface PendingMembership {
  groupId: string;
  groupName: string;
  requestedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function groupFromRow(row: any): PlannerGroup {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    organiserId: row.organiser_id,
    createdAt: row.created_at,
    timezone: row.timezone,
    periodKind: row.period_kind,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    minBlockMinutes: row.min_block_minutes,
    requireApproval: row.require_approval,
  };
}

/** Calls a Postgres function and surfaces its message verbatim (organiser-action errors are already written for humans). */
async function rpcOrThrow<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc(fn, args);
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function createGroup(name: string, timezone = 'UTC'): Promise<string> {
  return rpcOrThrow<string>('planner_create_group', { p_name: name, p_timezone: timezone });
}

/** Joins (or requests to join) by invite code. `status` says whether you're in or waiting for the organiser. */
export async function joinGroupByCode(code: string): Promise<{ groupId: string; status: JoinStatus }> {
  const rows = await rpcOrThrow<{ group_id: string; status: JoinStatus }[]>('planner_join_group_by_code', { p_code: code });
  const row = rows[0];
  if (!row) throw new Error('Could not join that group');
  return { groupId: row.group_id, status: row.status };
}

/** RLS scopes this to groups the signed-in user is an ACTIVE member of. */
export async function listMyGroups(): Promise<PlannerGroup[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_groups').select('*').order('created_at', { ascending: true });
  if (result.error) throw new Error(`listMyGroups: ${result.error.message}`);
  return (result.data ?? []).map(groupFromRow);
}

/** Join requests the signed-in user has made that the organiser hasn't approved yet. */
export async function listMyPendingRequests(): Promise<PendingMembership[]> {
  const rows = await rpcOrThrow<{ group_id: string; group_name: string; requested_at: string }[]>(
    'planner_my_pending_requests',
    {},
  );
  return (rows ?? []).map((r) => ({ groupId: r.group_id, groupName: r.group_name, requestedAt: r.requested_at }));
}

export async function getGroup(groupId: string): Promise<PlannerGroup | undefined> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_groups').select('*').eq('id', groupId).maybeSingle();
  if (result.error) throw new Error(`getGroup: ${result.error.message}`);
  return result.data ? groupFromRow(result.data) : undefined;
}

/** Leave a group or withdraw a pending request. The organiser must hand the role over first (unless they're the last one in). */
export async function leaveGroup(groupId: string): Promise<void> {
  await rpcOrThrow('planner_leave_group', { p_group_id: groupId });
}

/** Active members of a specific group, organiser first -- empty if the caller isn't an active member. Emails are only included for the organiser. */
export async function getGroupRoster(groupId: string): Promise<GroupMember[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('planner_group_roster', { p_group_id: groupId });
  if (result.error) throw new Error(`getGroupRoster: ${result.error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((result.data ?? []) as any[]).map((r) => ({
    id: r.id,
    email: r.email ?? null,
    displayName: r.display_name ?? null,
    isOrganiser: !!r.is_organiser,
    joinedAt: r.joined_at,
  }));
}

// ---- Organiser-only ----

export async function listJoinRequests(groupId: string): Promise<JoinRequest[]> {
  const rows = await rpcOrThrow<{ user_id: string; email: string; display_name: string | null; requested_at: string }[]>(
    'planner_group_pending_requests',
    { p_group_id: groupId },
  );
  return (rows ?? []).map((r) => ({
    id: r.user_id,
    email: r.email,
    displayName: r.display_name ?? null,
    requestedAt: r.requested_at,
  }));
}

export async function resolveJoinRequest(groupId: string, userId: string, approve: boolean): Promise<void> {
  await rpcOrThrow('planner_resolve_join_request', { p_group_id: groupId, p_user_id: userId, p_approve: approve });
}

export async function removeMember(groupId: string, userId: string): Promise<void> {
  await rpcOrThrow('planner_remove_member', { p_group_id: groupId, p_user_id: userId });
}

export async function transferOrganiser(groupId: string, newOrganiserId: string): Promise<void> {
  await rpcOrThrow('planner_transfer_organiser', { p_group_id: groupId, p_new_organiser: newOrganiserId });
}

export async function regenerateInviteCode(groupId: string): Promise<string> {
  return rpcOrThrow<string>('planner_regenerate_invite_code', { p_group_id: groupId });
}

export interface GroupSettingsInput {
  name: string;
  timezone: string;
  periodKind: PeriodKind;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  minBlockMinutes: number;
  requireApproval: boolean;
}

export async function updateGroupSettings(groupId: string, s: GroupSettingsInput): Promise<void> {
  await rpcOrThrow('planner_update_group', {
    p_group_id: groupId,
    p_name: s.name,
    p_timezone: s.timezone,
    p_period_kind: s.periodKind,
    p_period_start: s.periodStart,
    p_period_end: s.periodEnd,
    p_min_block_minutes: s.minBlockMinutes,
    p_require_approval: s.requireApproval,
  });
}

/** Permanently deletes the group and all memberships. Allowed by RLS for the organiser only. */
export async function deleteGroup(groupId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.from('planner_groups').delete().eq('id', groupId).select('id');
  if (result.error) throw new Error(result.error.message);
  if (!result.data || result.data.length === 0) throw new Error('Only the organiser can do that');
}

// ---- Cross-person reads (active members of the same group only) ----

export interface BusyTime {
  ownerId: string;
  date: ISODate;
  start: string;
  end: string;
}

/** Busy time ranges (no titles/content) for the given people, scoped to one shared group. */
export async function getGroupBusyTimes(groupId: string, userIds: string[], from: ISODate, to: ISODate): Promise<BusyTime[]> {
  if (userIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('planner_group_busy_times', {
    p_group_id: groupId,
    p_user_ids: userIds,
    p_from: from,
    p_to: to,
  });
  if (result.error) throw new Error(`getGroupBusyTimes: ${result.error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((result.data ?? []) as any[]).map((r) => ({ ownerId: r.owner_id, date: r.date, start: r.start, end: r.end }));
}

/**
 * Each requested (co-group-member) person's availability config. Anyone
 * who hasn't configured theirs yet gets the engine's default hours -- but
 * they're also listed in `usingDefaults` so the UI can say so honestly
 * instead of presenting guessed hours as fact.
 */
export async function getGroupAvailability(
  groupId: string,
  userIds: string[],
): Promise<{ byUser: Map<string, AvailabilityConfig>; usingDefaults: string[] }> {
  const byUser = new Map<string, AvailabilityConfig>();
  const usingDefaults: string[] = [];
  if (userIds.length === 0) return { byUser, usingDefaults };
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('planner_group_availability', { p_group_id: groupId, p_user_ids: userIds });
  if (result.error) throw new Error(`getAvailabilityForUsers: ${result.error.message}`);
  for (const row of (result.data ?? []) as { owner_id: string; config: AvailabilityConfig }[]) {
    byUser.set(row.owner_id, row.config);
  }
  for (const id of userIds) {
    if (!byUser.has(id)) {
      byUser.set(id, defaultAvailability());
      usingDefaults.push(id);
    }
  }
  return { byUser, usingDefaults };
}

export async function getAvailabilityForUsers(groupId: string, userIds: string[]): Promise<Map<string, AvailabilityConfig>> {
  return (await getGroupAvailability(groupId, userIds)).byUser;
}

// ---------------------------------------------------------------------------
// Profile -- the signed-in user's own row in planner_profiles. Identity always
// comes from the session (never from a form field or URL), and RLS
// ("users manage their own profile") means Postgres refuses to read or change
// anyone else's row even if this code were wrong.
// ---------------------------------------------------------------------------

/** The caller's own profile, or undefined if they have none. Passing someone else's id just returns undefined (RLS: "own profile" policy covers every column of your own row, including is_admin -- there is no write path for it, see schema.sql). */
export async function getOwnProfile(userId: string): Promise<Profile | undefined> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase
    .from('planner_profiles')
    .select('id, email, display_name, theme, is_admin, last_seen_version')
    .eq('id', userId)
    .maybeSingle();
  if (result.error) throw new Error(`getOwnProfile: ${result.error.message}`);
  const row = result.data as
    | { id: string; email: string; display_name: string | null; theme: string | null; is_admin: boolean | null; last_seen_version: string | null }
    | null;
  return row
    ? {
        id: row.id,
        email: row.email,
        displayName: row.display_name ?? null,
        theme: row.theme && isTheme(row.theme) ? row.theme : 'dark',
        isAdmin: !!row.is_admin,
        lastSeenVersion: row.last_seen_version ?? null,
      }
    : undefined;
}

/** Marks the "what's new" changelog for the given app version as seen, so the modal doesn't show again until the next version bump. */
export async function markChangelogSeen(version: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const updated = await supabase.from('planner_profiles').update({ last_seen_version: version }).eq('id', user.id).select('id');
  if (updated.error) throw new Error(`Could not save changelog state: ${updated.error.message}`);
}

/** Returns the signed-in user's ICS calendar-subscribe token, generating one on first use. */
export async function getOrCreateIcsToken(): Promise<string> {
  return rpcOrThrow<string>('planner_get_or_create_ics_token', {});
}

/** Rotates the ICS token, immediately invalidating any previously shared subscribe URL. */
export async function regenerateIcsToken(): Promise<string> {
  return rpcOrThrow<string>('planner_regenerate_ics_token', {});
}

/** Saves the signed-in user's theme preference. Same own-row-only path as the display name. */
export async function updateMyTheme(theme: Theme): Promise<void> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const updated = await supabase.from('planner_profiles').update({ theme }).eq('id', user.id).select('id');
  if (updated.error) throw new Error(`Could not save your theme: ${updated.error.message}`);
  if (updated.data && updated.data.length > 0) return;
  const inserted = await supabase.from('planner_profiles').insert({ id: user.id, email: user.email ?? '', theme });
  if (inserted.error) throw new Error(`Could not save your theme: ${inserted.error.message}`);
}

/**
 * Saves the signed-in user's display name. Only the display_name column is
 * ever written. Accounts created before the signup trigger existed may lack a
 * profile row; for those we create it (allowed by RLS: id must equal auth.uid()).
 */
export async function updateMyDisplayName(displayName: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const updated = await supabase.from('planner_profiles').update({ display_name: displayName }).eq('id', user.id).select('id');
  if (updated.error) throw new Error(`Could not save your display name: ${updated.error.message}`);
  if (updated.data && updated.data.length > 0) return;

  const inserted = await supabase.from('planner_profiles').insert({ id: user.id, email: user.email ?? '', display_name: displayName });
  if (inserted.error) throw new Error(`Could not save your display name: ${inserted.error.message}`);
}

// ---------------------------------------------------------------------------
// Feedback -- a short message from the signed-in user, stored in Postgres
// (planner_feedback, RLS: insert/read your own only) and best-effort emailed
// (see src/lib/notify-feedback.ts). The DB row is the durable record even if
// the email send fails or isn't configured.
// ---------------------------------------------------------------------------

export async function submitFeedback(message: string, contactEmail: string | null, page: string | null): Promise<string> {
  return rpcOrThrow<string>('planner_submit_feedback', { p_message: message, p_contact_email: contactEmail, p_page: page });
}

// ---------------------------------------------------------------------------
// Admin -- read-only. Every function below is a SECURITY DEFINER Postgres
// function that itself checks planner_profiles.is_admin for the CALLER
// before returning anything (see schema.sql); a non-admin gets back either
// an empty result or a "not an admin" error, enforced in the database, not
// just hidden in the UI.
// ---------------------------------------------------------------------------

export interface AdminOverview {
  totalUsers: number;
  totalGroups: number;
  totalTasks: number;
  totalEvents: number;
  signupsLast7d: number;
  signupsLast30d: number;
  openFeedback: number;
}

/** Undefined for a non-admin (the function returns zero rows for them), never a thrown "forbidden" -- callers should check profile.isAdmin before showing an admin page at all. */
export async function getAdminOverview(): Promise<AdminOverview | undefined> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('planner_admin_overview');
  if (result.error) throw new Error(`getAdminOverview: ${result.error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = ((result.data ?? []) as any[])[0];
  if (!row) return undefined;
  return {
    totalUsers: Number(row.total_users),
    totalGroups: Number(row.total_groups),
    totalTasks: Number(row.total_tasks),
    totalEvents: Number(row.total_events),
    signupsLast7d: Number(row.signups_last_7d),
    signupsLast30d: Number(row.signups_last_30d),
    openFeedback: Number(row.open_feedback),
  };
}

export interface SignupDay {
  day: ISODate;
  signups: number;
}

export async function getAdminSignupSeries(): Promise<SignupDay[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('planner_admin_signup_series');
  if (result.error) throw new Error(`getAdminSignupSeries: ${result.error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((result.data ?? []) as any[]).map((r) => ({ day: r.day, signups: Number(r.signups) }));
}

export interface FeedbackItem {
  id: string;
  email: string;
  displayName: string | null;
  message: string;
  contactEmail: string | null;
  page: string | null;
  createdAt: string;
  handled: boolean;
}

export async function listAllFeedback(): Promise<FeedbackItem[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc('planner_admin_list_feedback');
  if (result.error) throw new Error(`listAllFeedback: ${result.error.message}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((result.data ?? []) as any[]).map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name ?? null,
    message: r.message,
    contactEmail: r.contact_email ?? null,
    page: r.page ?? null,
    createdAt: r.created_at,
    handled: !!r.handled,
  }));
}

export async function setFeedbackHandled(feedbackId: string, handled: boolean): Promise<void> {
  await rpcOrThrow('planner_admin_set_feedback_handled', { p_feedback_id: feedbackId, p_handled: handled });
}
