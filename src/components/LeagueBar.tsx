import { useState } from 'react';
import type { League } from '../lib/db';
import { LeagueForms } from './LeagueForms';

interface Props {
  leagues: League[];
  activeId: string;
  onSwitch: (id: string) => void;
  onChanged: (l: League) => void;
}

/** The league context bar under the app header: shows the active league, its share code, and a
 *  menu to switch between your leagues or create / join another. */
export function LeagueBar({ leagues, activeId, onSwitch, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);

  const active = leagues.find((l) => l.id === activeId) ?? leagues[0];
  if (!active) return null;

  function close() {
    setOpen(false);
    setAdding(false);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(active.join_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the code is visible to type manually */
    }
  }

  return (
    <div className="league-bar">
      <button className="league-pick" onClick={() => (open ? close() : setOpen(true))}>
        <span className="league-trophy">🏆</span>
        <span className="league-name">{active.name}</span>
        <span className="league-caret">▾</span>
      </button>

      <button className="league-code" onClick={copyCode} title="Copy the join code to share">
        {copied ? 'Copied!' : active.join_code}
        <span className="league-copy-ic">⧉</span>
      </button>

      {open && (
        <>
          <div className="acct-backdrop" onClick={close} />
          <div className="league-menu">
            <div className="acct-menu-name">Your leagues</div>
            {leagues.map((l) => (
              <button
                key={l.id}
                className={`acct-menu-item ${l.id === active.id ? 'on' : ''}`}
                onClick={() => { onSwitch(l.id); close(); }}
              >
                {l.id === active.id ? '● ' : ''}{l.name}
              </button>
            ))}

            {adding ? (
              <div className="league-add">
                <LeagueForms
                  compact
                  onDone={(l) => { onChanged(l); close(); }}
                />
              </div>
            ) : (
              <button className="acct-menu-item add" onClick={() => setAdding(true)}>
                ＋ Create or join another
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
