import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- "I have free
// time" now lives as a mode inside Tasks > Right now.
export default function FreeTimeRedirect({ searchParams }: { searchParams: { minutes?: string } }) {
  const params = new URLSearchParams({ section: 'right-now', mode: 'free-time' });
  if (searchParams.minutes) params.set('minutes', searchParams.minutes);
  redirect(`/tasks?${params.toString()}`);
}
