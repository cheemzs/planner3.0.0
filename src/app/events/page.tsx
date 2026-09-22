import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- Events now
// lives as a section inside /tasks.
export default function EventsRedirect() {
  redirect('/tasks?section=events');
}
