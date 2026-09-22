import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildIcsCalendar, type IcsEventRow } from '@/lib/ics';

// Calendar apps poll this on their own schedule with no login session at
// all, so it must be reachable without auth (see middleware.ts's PUBLIC_
// PREFIXES) and must never trigger a fresh plan/replan -- it only reads
// already-stored data via the planner_ics_feed(token) SECURITY DEFINER
// function, which resolves the token to its owner server-side and returns
// nothing for an unknown/rotated token.
export const dynamic = 'force-dynamic';

interface FeedRow {
  id: string;
  date: string;
  start: string;
  end: string;
  type: string;
  ref_id: string | null;
  title: string;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!token) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!url || !anonKey) {
    return new NextResponse('Calendar feed is not configured.', { status: 503 });
  }

  // Deliberately a plain (anon-key, no cookies) client -- this request has
  // no session to attach. planner_ics_feed is SECURITY DEFINER and does its
  // own token-based authorization, bypassing RLS on purpose for this one
  // narrow, read-only, token-scoped case.
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.rpc('planner_ics_feed', { p_token: token });
  if (error) {
    return new NextResponse('Not found', { status: 404 });
  }

  const rows: IcsEventRow[] = ((data ?? []) as FeedRow[]).map((r) => ({
    id: r.id,
    date: r.date,
    start: r.start,
    end: r.end,
    type: r.type,
    title: r.title,
  }));

  const body = buildIcsCalendar(rows, 'Planner Schedule');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="planner-schedule.ics"',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
