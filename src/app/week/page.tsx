import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- see
// src/app/schedule/page.tsx for the real (now-merged) Today/Week/Month page.
export default function WeekRedirect({ searchParams }: { searchParams: { weekStart?: string; day?: string } }) {
  const date = searchParams.day || searchParams.weekStart;
  redirect(date ? `/schedule?view=week&date=${date}` : '/schedule?view=week');
}
