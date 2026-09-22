import type { PlanTask } from './types';
import { rankTasks, scoreTask, type ScoringContext } from './scoring';

export interface FreeTimeSuggestion {
  taskId: string;
  title: string;
  score: number;
  fitMinutes: number;
  wouldComplete: boolean;
  reason: string;
}

export interface FreeTimeFitResult {
  windowMinutes: number;
  best?: FreeTimeSuggestion;
  alternatives: FreeTimeSuggestion[];
  note?: string;
}

const DEFAULT_MIN_CHUNK = 20;

/**
 * Given an ad-hoc free window (the user just says "I have 45 minutes"),
 * finds the best-fitting pending task(s): a task that fits and would be
 * *completed* by this window is preferred over one that would merely be
 * started, all else equal, since finishing something is usually more
 * valuable than a partial chunk of a different task.
 */
export function findFreeTimeFit(
  windowMinutes: number,
  tasks: PlanTask[],
  scoringCtx: ScoringContext,
): FreeTimeFitResult {
  const eligible = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.remainingMinutes > 0,
  );
  const ranked = rankTasks(eligible, scoringCtx);

  const candidates = ranked
    .map((t) => {
      const minChunk = t.minChunkMinutes ?? DEFAULT_MIN_CHUNK;
      if (minChunk > windowMinutes) return undefined;
      const score = scoreTask(t, scoringCtx).score;
      const wouldComplete = t.remainingMinutes <= windowMinutes;
      const fitMinutes = Math.min(t.remainingMinutes, windowMinutes);
      return {
        taskId: t.id,
        title: t.title,
        score,
        fitMinutes,
        wouldComplete,
        reason: wouldComplete
          ? `Fits entirely in ${windowMinutes} minutes — would finish "${t.title}".`
          : `Would make a ${fitMinutes}-minute dent in "${t.title}" (${t.remainingMinutes} min remaining total).`,
      } satisfies FreeTimeSuggestion;
    })
    .filter((x): x is FreeTimeSuggestion => x != null)
    // Completing something is weighted above raw score, then fall back to score.
    .sort((a, b) => {
      if (a.wouldComplete !== b.wouldComplete) return a.wouldComplete ? -1 : 1;
      return b.score - a.score;
    });

  if (candidates.length === 0) {
    return {
      windowMinutes,
      alternatives: [],
      note:
        eligible.length === 0
          ? 'No pending tasks to suggest.'
          : `Nothing pending has a small enough minimum chunk to fit in ${windowMinutes} minutes.`,
    };
  }

  return {
    windowMinutes,
    best: candidates[0],
    alternatives: candidates.slice(1, 5),
  };
}
