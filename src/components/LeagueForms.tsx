import { useState } from 'react';
import { createLeague, joinLeague, type League } from '../lib/db';

/** Shared Join / Create controls, used by both the first-league gate and the header switcher. */
export function LeagueForms({ onDone, compact = false }: { onDone: (l: League) => void; compact?: boolean }) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    const v = value.trim();
    if (mode === 'join' && v.length < 3) return setErr('Enter the code from your invite.');
    if (mode === 'create' && v.length < 2) return setErr('Give your league a name (2 letters or more).');
    setErr('');
    setBusy(true);
    try {
      const league = mode === 'join' ? await joinLeague(v) : await createLeague(v);
      setValue('');
      onDone(league);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setErr(/invalid join code/i.test(msg) ? "That code didn't match a league." : msg || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="seg" style={compact ? { marginBottom: 10 } : undefined}>
        <button className={mode === 'join' ? 'on' : ''} onClick={() => { setMode('join'); setErr(''); }}>Join with a code</button>
        <button className={mode === 'create' ? 'on' : ''} onClick={() => { setMode('create'); setErr(''); }}>Create a league</button>
      </div>
      <div className="field">
        <input
          className="input"
          placeholder={mode === 'join' ? 'Join code, e.g. SHABAB26' : 'League name'}
          value={value}
          maxLength={mode === 'join' ? 12 : 40}
          autoCapitalize={mode === 'join' ? 'characters' : 'words'}
          onChange={(e) => setValue(mode === 'join' ? e.target.value.toUpperCase() : e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>
        {busy ? 'Working…' : mode === 'join' ? 'Join league →' : 'Create league →'}
      </button>
      {err && <p className="msg err">{err}</p>}
    </div>
  );
}
