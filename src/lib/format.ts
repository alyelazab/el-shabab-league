import type { MatchRow } from './db';
import { BUCKETS, type Bucket } from './scoring/types';

export type MatchState = 'open' | 'locked' | 'final';

export function matchState(m: MatchRow, now: number = Date.now()): MatchState {
  if (m.status === 'finished') return 'final';
  if (now >= new Date(m.lock_at).getTime()) return 'locked';
  return 'open';
}

/** e.g. "Sun 5 Jul, 22:00" in the viewer's local time. */
export function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact countdown to a target time, e.g. "2d 4h", "3h 12m", "8m", "Locked". */
export function countdown(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'Locked';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export const bucketLabel = (b: Bucket): string => (b === '76-90+' ? "76'–90+" : `${b.replace('-', "'–")}'`);
export const ALL_BUCKETS = BUCKETS;
