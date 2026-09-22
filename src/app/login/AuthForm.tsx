'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

type Mode = 'signin' | 'signup';
type FormAction = (formData: FormData) => void | Promise<void>;

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary block" type="submit" disabled={pending}>
      {pending ? busy : idle}
    </button>
  );
}

function PasswordField({ id, autoComplete, minLength, hint }: { id: string; autoComplete: string; minLength?: number; hint?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <label htmlFor={id}>Password</label>
      <div className="pw-wrap">
        <input id={id} name="password" type={shown ? 'text' : 'password'} required minLength={minLength} autoComplete={autoComplete} />
        <button type="button" className="pw-toggle" aria-pressed={shown} aria-label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
    </>
  );
}

/**
 * The sign-in / create-account card. Sign in is the default and gets the
 * whole card; "Create one" swaps to the sign-up form (and back), so there
 * is only ever one form on screen. The switch links are real <a href>s, so
 * they still work (as a page navigation) if JavaScript hasn't loaded.
 */
export function AuthForm({
  initialMode,
  next,
  error,
  notice,
  signInAction,
  signUpAction,
}: {
  initialMode: Mode;
  next: string;
  error?: string;
  notice?: string;
  signInAction: FormAction;
  signUpAction: FormAction;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [showMessages, setShowMessages] = useState(true);

  // A redirect back to /login (e.g. after a failed sign-in) can re-use this mounted component with new props.
  useEffect(() => {
    setMode(initialMode);
    setShowMessages(true);
  }, [initialMode, error, notice]);

  const nextQuery = next && next !== '/' ? `&next=${encodeURIComponent(next)}` : '';
  const switchTo = (target: Mode) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMode(target);
    setShowMessages(false); // an old error belongs to the other form
    window.history.replaceState(null, '', target === 'signup' ? `/login?mode=signup${nextQuery}` : `/login${nextQuery ? `?${nextQuery.slice(1)}` : ''}`);
  };

  const isSignIn = mode === 'signin';

  return (
    <div className="auth-card">
      <h2>{isSignIn ? 'Welcome back' : 'Create your account'}</h2>
      <p className="auth-sub">{isSignIn ? 'Sign in to your planner.' : 'Start planning in under a minute.'}</p>

      {showMessages && error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      {showMessages && notice ? (
        <div className="notice ok" role="status">
          {notice}
        </div>
      ) : null}

      {isSignIn ? (
        <form action={signInAction} key="signin">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="si-email">Email</label>
          <input id="si-email" name="email" type="email" required autoComplete="email" autoFocus />
          <PasswordField id="si-password" autoComplete="current-password" />
          <div className="actions">
            <SubmitButton idle="Sign in" busy="Signing in…" />
          </div>
        </form>
      ) : (
        <form action={signUpAction} key="signup">
          <label htmlFor="su-email">Email</label>
          <input id="su-email" name="email" type="email" required autoComplete="email" autoFocus />
          <PasswordField id="su-password" autoComplete="new-password" minLength={6} hint="At least 6 characters." />
          <div className="actions">
            <SubmitButton idle="Create account" busy="Creating account…" />
          </div>
        </form>
      )}

      <p className="auth-switch">
        {isSignIn ? (
          <>
            Don&apos;t have an account yet?{' '}
            <a href={`/login?mode=signup${nextQuery}`} onClick={switchTo('signup')}>
              Create one
            </a>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <a href={`/login${nextQuery ? `?${nextQuery.slice(1)}` : ''}`} onClick={switchTo('signin')}>
              Sign in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
