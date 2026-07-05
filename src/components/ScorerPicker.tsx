import { useMemo, useState } from 'react';
import type { SquadPlayerRow } from '../lib/db';

// Likely scorers first: forwards, then mids, then defenders, then keepers.
const POS_ORDER: Record<string, number> = { FW: 0, MF: 1, DF: 2, GK: 3 };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

interface Props {
  players: SquadPlayerRow[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/** Searchable, team-scoped scorer picker: tap to open, filter by name, tap a chip. */
export function ScorerPicker({ players, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const sorted = useMemo(
    () =>
      [...players].sort(
        (a, b) =>
          (POS_ORDER[a.position ?? ''] ?? 9) - (POS_ORDER[b.position ?? ''] ?? 9) ||
          a.name.localeCompare(b.name),
      ),
    [players],
  );

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return nq ? sorted.filter((p) => norm(p.name).includes(nq)) : sorted;
  }, [sorted, q]);

  const selected = players.find((p) => p.api_player_id === value);

  if (!open) {
    return (
      <button
        type="button"
        className={`scorer-trigger ${selected ? 'picked' : ''}`}
        disabled={disabled}
        onClick={() => {
          setQ('');
          setOpen(true);
        }}
      >
        <span className="scorer-trigger-name">{selected ? selected.name : 'Who scores it?'}</span>
        {!disabled && <span className="scorer-trigger-cta">{selected ? 'Change' : 'Pick'}</span>}
      </button>
    );
  }

  return (
    <div className="scorer-picker">
      <input
        className="input scorer-search"
        autoFocus
        inputMode="search"
        placeholder="Search players…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="scorer-grid">
        {filtered.map((p) => (
          <button
            type="button"
            key={p.api_player_id}
            className={`scorer-chip ${p.api_player_id === value ? 'on' : ''}`}
            onClick={() => {
              onChange(p.api_player_id);
              setOpen(false);
            }}
          >
            <span className="scorer-pos">{p.position ?? ''}</span>
            <span className="scorer-chip-name">{p.name}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="section-hint scorer-empty">No players match “{q.trim()}”.</p>}
      </div>
    </div>
  );
}
