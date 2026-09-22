import { signInAction, signUpAction } from '@/app/login/actions';
import { AuthForm } from '@/app/login/AuthForm';
import { safeNextPath } from '@/lib/auth-redirect';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string; next?: string; mode?: string };
}) {
  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="auth-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
            <path d="M9 16l2 2 4-4" />
          </svg>
        </div>
        <h1>Planner</h1>
        <p>Plan your days. Find time together.</p>
      </div>

      <AuthForm
        initialMode={searchParams.mode === 'signup' ? 'signup' : 'signin'}
        next={safeNextPath(searchParams.next)}
        error={searchParams.error}
        notice={searchParams.notice}
        signInAction={signInAction}
        signUpAction={signUpAction}
      />
    </div>
  );
}
