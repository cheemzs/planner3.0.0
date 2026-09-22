import { redirect } from 'next/navigation';

// Renamed to Insights -- kept as a redirect so bookmarks/links don't 404.
export default function FeasibilityRedirect({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const params = new URLSearchParams();
  if (searchParams.from) params.set('from', searchParams.from);
  if (searchParams.to) params.set('to', searchParams.to);
  const qs = params.toString();
  redirect(qs ? `/insights?${qs}` : '/insights');
}
