import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- Availability
// now lives as a section inside /settings.
export default function AvailabilityRedirect() {
  redirect('/settings?section=availability');
}
