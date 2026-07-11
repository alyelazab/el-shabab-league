import { useState } from 'react';

/**
 * Shown to a signed-in player when their profile couldn't be loaded (network / permission error) —
 * never to a genuinely-new user, who gets Onboarding. This is the "log me in, don't sign me up" guard:
 * a stale cached client that errors on load lands here with a retry, not on the sign-up screen.
 */
export function ProfileLoadError({
  onRetry,
  onSignOut,
}: {
  onRetry: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-logo" style={{ fontSize: 'clamp(34px,10vw,50px)' }}>
          Hang on.
        </div>
        <p className="auth-tag">We couldn't load your account just now.</p>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={retry}>
        {busy ? 'Retrying…' : 'Try again →'}
      </button>
      <p className="msg">
        Still stuck?{' '}
        <button className="link-btn" onClick={onSignOut}>
          Sign out
        </button>{' '}
        and back in.
      </p>
    </div>
  );
}
