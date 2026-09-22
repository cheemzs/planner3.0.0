import { redirect } from 'next/navigation';

// Old route, kept as a redirect so bookmarks/links don't 404 -- "What should
// I do right now?" now lives as a mode inside Tasks > Right now.
export default function NowRedirect() {
  redirect('/tasks?section=right-now&mode=now');
}
