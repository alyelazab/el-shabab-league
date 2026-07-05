import { useState } from 'react';
import { useAuth } from '../auth';
import { JOIN_CODE } from '../lib/supabase';
import { createMyProfile } from '../lib/db';

/** Email → 6-digit code → verified. No passwords, no redirect deep-links. */
export function Login() {
  const { sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [join, setJoin] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const joinOk = !JOIN_CODE || join.trim().toUpperCase() === JOIN_CODE.toUpperCase();

  async function send() {
    setErr('');
    if (!joinOk) return setErr('That join code is not right. Ask whoever invited you.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email.');
    setBusy(true);
    try {
      await sendCode(email.trim());
      setStep('code');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setErr('');
    setBusy(true);
    try {
      await verifyCode(email.trim(), code.trim());
      // On success the auth listener swaps the screen.
    } catch {
      setErr('That code did not work. Check it or send a new one.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-logo">
          El Shabab
          <span className="accent">League</span>
        </div>
        <p className="auth-tag">
          Predict the knockouts. Beat <span className="ar">الشباب</span>.
        </p>
      </div>

      {step === 'email' ? (
        <>
          {JOIN_CODE && (
            <div className="field">
              <label htmlFor="join">Join code</label>
              <input
                id="join"
                className="input"
                placeholder="From your invite"
                value={join}
                autoCapitalize="characters"
                onChange={(e) => setJoin(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Your email</label>
            <input
              id="email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : 'Send my code →'}
          </button>
          <p className="msg">We email you a 6-digit code — no password to remember.</p>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="code">Enter the code sent to {email}</label>
            <input
              id="code"
              className="input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && verify()}
            />
          </div>
          <button className="btn btn-primary" disabled={busy || code.length < 6} onClick={verify}>
            {busy ? 'Checking…' : 'Enter the league →'}
          </button>
          <p className="msg">
            No code?{' '}
            <button className="link-btn" onClick={() => setStep('email')}>
              Try again
            </button>
          </p>
        </>
      )}

      {err && <p className="msg err">{err}</p>}
    </div>
  );
}

/** Shown once, right after first sign-in, to pick a display name. */
export function Onboarding() {
  const { refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setErr('');
    if (name.trim().length < 2) return setErr('Pick a name at least 2 letters long.');
    setBusy(true);
    try {
      await createMyProfile(name.trim());
      await refreshProfile();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save your name.');
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-logo" style={{ fontSize: 'clamp(38px,11vw,54px)' }}>
          You're in.
        </div>
        <p className="auth-tag">What should the shabab call you?</p>
      </div>
      <div className="field">
        <label htmlFor="dn">Display name</label>
        <input
          id="dn"
          className="input"
          placeholder="e.g. Aly"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Start predicting →'}
      </button>
      {err && <p className="msg err">{err}</p>}
    </div>
  );
}
