'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/auth-redirect';

function str(v: FormDataEntryValue | null): string {
  return (v ?? '').toString().trim();
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = str(formData.get('email'));
  const password = str(formData.get('password'));
  // Only ever follow a same-site path (see safeNextPath) -- `next` comes from the URL.
  const next = safeNextPath(str(formData.get('next')));
  const nextParam = next === '/' ? '' : `&next=${encodeURIComponent(next)}`;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}${nextParam}`);

  redirect(next);
}

export async function signUpAction(formData: FormData): Promise<void> {
  const email = str(formData.get('email'));
  const password = str(formData.get('password'));

  const supabase = await createSupabaseServerClient();
  const { error, data } = await supabase.auth.signUp({ email, password });
  // mode=signup keeps the visitor on the "create account" form so the error appears next to the fields that caused it.
  if (error) redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);

  // If email confirmation is enabled in your Supabase project (the
  // default), there is no session yet — the user needs to click the
  // confirmation link first. If it's disabled, `data.session` is already
  // set and they're signed in immediately.
  if (data.session) {
    redirect('/');
  }
  redirect('/login?notice=' + encodeURIComponent('Check your email to confirm your account, then sign in.'));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
