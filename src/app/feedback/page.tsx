import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- Feedback now
// lives as a section inside /settings.
export default function FeedbackRedirect({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const params = new URLSearchParams({ section: 'feedback' });
  if (searchParams.error) params.set('error', searchParams.error);
  if (searchParams.notice) params.set('notice', searchParams.notice);
  redirect(`/settings?${params.toString()}`);
}
