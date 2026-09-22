import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- see
// src/app/schedule/page.tsx for the real (now-merged) Today/Week/Month page.
export default function MonthRedirect({ searchParams }: { searchParams: { monthStart?: string } }) {
  redirect(searchParams.monthStart ? `/schedule?view=month&monthStart=${searchParams.monthStart}` : '/schedule?view=month');
}
