import { redirect } from 'next/navigation';

// Today/Week/Month were consolidated into a single /schedule page (with a
// view= query param). Keep old bookmarks/links to "/" working.
export default function HomeRedirect() {
  redirect('/schedule?view=day');
}
