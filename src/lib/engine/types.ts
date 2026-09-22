/**
 * Planning engine domain model.
 *
 * Time convention: all dates are "YYYY-MM-DD" and all times are "HH:mm"
 * (24h, zero-padded) in the *user's local wall-clock time*. Datetimes that
 * combine the two are "YYYY-MM-DDTHH:mm". We deliberately do not attach a
 * timezone/offset to every value — the planner reasons entirely in the
 * user's own local calendar, the same way a paper planner would. If XOPC
 * later needs multi-timezone awareness, a single IANA timezone can be
 * threaded through `AvailabilityConfig.timezone` without changing the
 * scheduling math, since everything downstream only ever compares local
 * wall-clock minutes-since-midnight.
 */

export type ISODate = string; // "YYYY-MM-DD"
export type ClockTime = string; // "HH:mm"
export type ISODateTime = string; // "YYYY-MM-DDTHH:mm"

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** Coarse user-set priority label. Mapped to a numeric baseline by the scorer. */
export type PriorityLabel = 'low' | 'medium' | 'high' | 'critical';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

export interface RecurrenceRule {
  /** Days of week the item recurs on: 0=Sunday .. 6=Saturday */
  daysOfWeek: number[];
  /** Optional end date (inclusive) for the recurrence. */
  until?: ISODate;
}

export interface PlanTask {
  id: string;
  title: string;
  description?: string;
  projectId?: string;
  goalId?: string;
  status: TaskStatus;

  /** User-set coarse priority; combined with `importance` by the scorer. */
  priority: PriorityLabel;
  /** 1 (low) - 5 (high) fine-grained importance. Defaults derived from `priority` if omitted. */
  importance?: number;
  /** 1 (light) - 5 (demanding) cognitive/physical difficulty, used for workload balancing. */
  difficulty?: number;

  /** Total estimated effort in minutes. */
  estimatedMinutes: number;
  /** Effort still required. Starts equal to estimatedMinutes; drained as work is logged. */
  remainingMinutes: number;

  deadline?: ISODateTime;
  earliestStart?: ISODateTime;
  /** Latest acceptable completion, if different/softer than a hard deadline. */
  latestCompletion?: ISODateTime;

  preferredTimeOfDay?: TimeOfDay;
  /** Smallest useful chunk of work, in minutes. Below this, scheduling the task is pointless. */
  minChunkMinutes?: number;
  /** Largest single sitting the planner should schedule, in minutes. */
  maxChunkMinutes?: number;

  /** Task IDs that must be completed (or at least scheduled earlier) before this one. */
  dependsOn?: string[];

  recurrence?: RecurrenceRule;
  tags?: string[];

  /** false = the user has manually pinned this task's time; the auto-planner must not move it. */
  autoSchedulable?: boolean;

  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;
}

export type NewPlanTask = Omit<
  PlanTask,
  'id' | 'createdAt' | 'updatedAt' | 'status' | 'remainingMinutes'
> & {
  status?: TaskStatus;
  remainingMinutes?: number;
};

export interface PlanEvent {
  id: string;
  title: string;
  description?: string;
  date: ISODate;
  start: ClockTime;
  end: ClockTime;
  /** Fixed events cannot be overwritten by the auto-planner (school, exams, appointments...). */
  fixed: boolean;
  recurrence?: RecurrenceRule;
  category?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type NewPlanEvent = Omit<PlanEvent, 'id' | 'createdAt' | 'updatedAt'>;

export interface AvailabilityWindow {
  start: ClockTime;
  end: ClockTime;
  label?: TimeOfDay;
}

export interface DayAvailability {
  /** 0=Sunday .. 6=Saturday. Omit a day to fall back to `default`. */
  dayOfWeek?: number;
  wake: ClockTime;
  sleep: ClockTime;
  /** Windows within [wake, sleep] where the user is actually schedulable (excludes school/work etc). */
  workWindows: AvailabilityWindow[];
  /** Recurring breaks (lunch, etc) subtracted from work windows every matching day. */
  breaks: AvailabilityWindow[];
}

export interface AvailabilityOverride {
  date: ISODate;
  /** If true, the whole day is unavailable for auto-scheduling. */
  unavailable?: boolean;
  workWindows?: AvailabilityWindow[];
}

export interface AvailabilityConfig {
  timezone?: string;
  /** Fallback used for any weekday without a specific entry. */
  default: DayAvailability;
  /** Per-weekday overrides (e.g. different hours on weekends). */
  perWeekday?: DayAvailability[];
  /** One-off overrides for specific dates (holidays, sick days, etc). */
  overrides?: AvailabilityOverride[];
  /** Target fraction (0-1) of free time the planner should fill by default. Never 1.0. */
  targetUtilization: number;
  /** Minutes of buffer inserted between auto-scheduled blocks. */
  bufferMinutes: number;
}

export type BlockType = 'task' | 'event' | 'break' | 'buffer';
export type BlockSource = 'auto' | 'manual';

export interface ScheduleBlock {
  id: string;
  date: ISODate;
  start: ClockTime;
  end: ClockTime;
  type: BlockType;
  /** Task or event id this block represents, if any. */
  refId?: string;
  title: string;
  locked: boolean;
  source: BlockSource;
  /** Human-readable reason the deterministic engine placed this block (section 19: explainability). */
  reason?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PriorityScore {
  taskId: string;
  score: number; // 0-100
  breakdown: {
    deadlineUrgency: number;
    importance: number;
    overdue: number;
    effortRisk: number;
    dependencyPenalty: number;
    flexibilityPenalty: number;
  };
  explanation: string;
  schedulable: boolean;
  blockedReason?: string;
}
