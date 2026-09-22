import { NextRequest, NextResponse } from 'next/server';
import * as repo from '@/lib/repository';
import { buildIcsCalendar, type IcsEventRow } from '@/lib/ics';

// Authenticated download ("export this view as a file"), as opposed to
// src/app/api/ics/[token]/route.ts which is the public, token-based
// *subscribe* feed. This one runs through the normal session-scoped
// repository (RLS-backed), same as any other page.
export const dynamic = 'force-dynamic';

function isIsoDate(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!isIsoDate(from) || !isIsoDate(to)) {
    return new NextResponse('Query params "from" and "to" (YYYY-MM-DD) are required.', { status: 400 });
  }

  const blocks = await repo.getScheduleForRange(from, to);
  const rows: IcsEventRow[] = blocks.map((b) => ({ id: b.id, date: b.date, start: b.start, end: b.end, type: b.type, title: b.title }));
  const body = buildIcsCalendar(rows, 'Planner Schedule Export');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="schedule-${from}-to-${to}.ics"`,
    },
  });
}
