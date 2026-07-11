import { LeagueForms } from './LeagueForms';
import type { League } from '../lib/db';

/** Shown right after a player picks their name, when they aren't in any league yet. */
export function LeagueGate({ onDone }: { onDone: (l: League) => void }) {
  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-logo" style={{ fontSize: 'clamp(34px,10vw,50px)' }}>
          Pick your league
        </div>
        <p className="auth-tag">Join your friends with a code, or start your own and invite people.</p>
      </div>
      <LeagueForms onDone={onDone} />
      <p className="msg">New here? Create a league and share the code, or ask whoever invited you for theirs.</p>
    </div>
  );
}
