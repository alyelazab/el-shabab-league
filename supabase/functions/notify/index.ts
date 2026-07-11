// notify — the email engagement worker for El Shabab League.
//
// Driven by pg_cron every 15 minutes (mode 'tick' runs all three phases). Individual modes are
// handy for testing.
//
//   reminders — matches locking within the next 30 min: email opted-in players who have no pick.
//   recaps    — finished non-final matches: email each player their outcome (great/good/rough/card/missed).
//   wrapup    — once the FINAL is scored: email everyone their standings + a thanks, then go quiet.
//
// Every send is logged to email_log and deduped, so the 15-minute tick and any rescoring never
// double-send. Recipient addresses are read from auth.users by the service role and never stored
// in a public table. Auth mirrors score-match: a Vault-backed cron secret, or the commissioner's JWT.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const ADMIN_EMAIL = (Deno.env.get('ADMIN_EMAIL') ?? '').toLowerCase();
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'El Shabab League <elshabab@mymasareef.com>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://elshabab.alyelazab.com';

const REMINDER_WINDOW_MS = 30 * 60 * 1000;

const svc = () => createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Types ───────────────────────────────────────────────────────────────────
type Variant = 'reminder' | 'great' | 'good' | 'rough' | 'card' | 'missed' | 'wrapup';
interface Profile { id: string; display_name: string; email_opt_out: boolean; unsubscribe_token: string; created_at: string; }
interface Match {
  id: string; round: string; status: string;
  home_team: string; away_team: string;
  home_score_reg: number | null; away_score_reg: number | null;
  kickoff_utc: string; lock_at: string;
}
interface Score { user_id: string; match_id: string; points: number; breakdown: Record<string, unknown>; }

// ─── Small helpers ───────────────────────────────────────────────────────────
const esc = (s: string) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fixtureOf = (m: Match) => `${m.home_team} v ${m.away_team}`;
const scorelineOf = (m: Match) => `${m.home_team} ${m.home_score_reg ?? 0}-${m.away_score_reg ?? 0} ${m.away_team}`;

// ─── Email layout + templates (playful voice, no em dashes) ──────────────────
function layout(bodyHtml: string, cta: { label: string; url: string } | null, unsubUrl: string) {
  const button = cta
    ? `<a href="${cta.url}" style="display:inline-block;background:#ff5a4d;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700;font-size:15px;margin-top:14px">${cta.label} →</a>`
    : '';
  return `<div style="background:#f3f2f7;padding:24px 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e9e7f0">
    <div style="background:#141122;padding:18px 24px">
      <span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:.02em">El Shabab <span style="color:#ff5a4d">League</span></span>
    </div>
    <div style="padding:24px;color:#1c1830;font-size:15px;line-height:1.6">
      ${bodyHtml}
      ${button}
    </div>
    <div style="padding:16px 24px;border-top:1px solid #eee;color:#9a96ad;font-size:12px;line-height:1.5">
      You get these because you're playing El Shabab League. <a href="${unsubUrl}" style="color:#9a96ad">Unsubscribe</a>.
    </div>
  </div>
</div>`;
}

interface RecapCtx { name: string; match: Match; points: number; exact: boolean; doubled: boolean; next: string; }

function template(variant: Variant, ctx: RecapCtx, unsubUrl: string): { subject: string; html: string } {
  const name = esc(ctx.name);
  const fixture = esc(fixtureOf(ctx.match));
  const scoreline = esc(scorelineOf(ctx.match));
  const next = esc(ctx.next);
  const board = { label: 'See the board', url: APP_URL };
  const predict = { label: 'Predict now', url: APP_URL };

  switch (variant) {
    case 'reminder':
      return {
        subject: `😬 ${fixtureOf(ctx.match)} locks in 30 min, your card's still blank`,
        html: layout(
          `<p>Yalla ${name}. <b>${fixture}</b> locks in about 30 minutes and we still haven't seen your pick. El shabab already called it. Don't be the empty box on the grid. Score, scorers, and the minute they hit. Takes 20 seconds.</p>`,
          predict, unsubUrl),
      };
    case 'great':
      return {
        subject: `🔥 ${ctx.points} points. Show-off.`,
        html: layout(
          `<p>That was filthy, ${name}. <b>${scoreline}</b>, and you banked <b>${ctx.points} pts</b>${ctx.exact ? ', exact scoreline and all' : ''}${ctx.doubled ? '. Your 🃏 doubled it' : ''}. Next up is ${next}. Keep it rolling.</p>`,
          board, unsubUrl),
      };
    case 'good':
      return {
        subject: `✅ ${ctx.points} on the board from ${fixtureOf(ctx.match)}`,
        html: layout(
          `<p>Not bad, ${name}. <b>${scoreline}</b> put <b>${ctx.points} pts</b> in the bag. ${next} is next. Go get more.</p>`,
          { label: 'Make your next pick', url: APP_URL }, unsubUrl),
      };
    case 'rough':
      return {
        subject: `😅 ${fixtureOf(ctx.match)} didn't go your way`,
        html: layout(
          `<p>Rough one, ${name}. <b>${scoreline}</b> left you with ${ctx.points} pts. Shake it off. ${next} is a clean slate.</p>`,
          { label: 'Bounce back', url: APP_URL }, unsubUrl),
      };
    case 'card':
      return {
        subject: `🃏 Ouch, the card didn't pay off`,
        html: layout(
          `<p>Big swing, ${name}. You played your Double-or-Nothing on <b>${fixture}</b> and it went cold, so that's ${ctx.points} pts. It happens to the brave. ${next} is your comeback. Go again.</p>`,
          { label: 'Bounce back', url: APP_URL }, unsubUrl),
      };
    case 'missed':
      return {
        subject: `👀 We missed you for ${fixtureOf(ctx.match)}`,
        html: layout(
          `<p>You sat this one out, ${name}. <b>${scoreline}</b>, and you scored nothing because no pick went in. Don't let ${next} slip the same way. 30 seconds, that's all it takes.</p>`,
          predict, unsubUrl),
      };
    default:
      return { subject: '', html: '' };
  }
}

interface Standing { league: string; rank: number; n: number; champ: string; won: boolean; }
function wrapupTemplate(name: string, standings: Standing[], unsubUrl: string): { subject: string; html: string } {
  const rows = standings.map((s) =>
    `<p style="margin:8px 0"><b>${esc(s.league)}:</b> you finished #${s.rank} of ${s.n}. 👑 Champion: ${esc(s.champ)}${s.won ? `<br><b>You won ${esc(s.league)}. Absolute scenes.</b>` : ''}</p>`,
  ).join('');
  return {
    subject: `🏆 That's a wrap. Thanks for playing El Shabab League.`,
    html: layout(
      `<p>That's the tournament, ${esc(name)}. Here's where you landed:</p>${rows}<p>Thanks for playing with El shabab this summer. Same time next tournament.</p>`,
      { label: 'See the final standings', url: APP_URL }, unsubUrl),
  };
}

// ─── Delivery ────────────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string, unsubUrl: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to,
        subject,
        html,
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Shared load: everything one tick needs ──────────────────────────────────
// Page through a table so large ones (email_log grows ~players×matches×kinds) are never truncated
// by any PostgREST row cap, which would otherwise cause duplicate or false-"missed" emails.
async function fetchAll<T>(columns: string, table: string): Promise<T[]> {
  const db = svc();
  const rows: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await db.from(table).select(columns).range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return rows;
}

async function load() {
  const db = svc();
  const [profs, matches, preds, scores, logs, memberRows] = await Promise.all([
    fetchAll<Profile>('id, display_name, email_opt_out, unsubscribe_token, created_at', 'profiles'),
    fetchAll<Match>('id, round, status, home_team, away_team, home_score_reg, away_score_reg, kickoff_utc, lock_at', 'matches'),
    fetchAll<{ user_id: string; match_id: string }>('user_id, match_id', 'predictions'),
    fetchAll<Score>('user_id, match_id, points, breakdown', 'match_scores'),
    fetchAll<{ user_id: string; match_id: string; kind: string; result: string }>('user_id, match_id, kind, result', 'email_log'),
    fetchAll<{ user_id: string }>('user_id', 'league_members'),
  ]);

  // Recipient emails from auth.users (service role), paged.
  const emailById = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data?.users ?? []) if (u.email) emailById.set(u.id, u.email);
    if (!data || data.users.length < 1000) break;
  }

  // Only email real players: opted in AND in at least one league (skips half-onboarded ghosts).
  const activePlayerIds = new Set(memberRows.map((m) => m.user_id));
  const optedIn = profs.filter((p) => !p.email_opt_out && activePlayerIds.has(p.id));
  const nameById = new Map(profs.map((p) => [p.id, p.display_name]));
  const predSet = new Set(preds.map((p) => `${p.user_id}:${p.match_id}`));
  const scoreByKey = new Map<string, Score>(scores.map((s) => [`${s.user_id}:${s.match_id}`, s]));
  // A send is "handled" once it succeeds or is deliberately suppressed; a 'failed' row may retry.
  const doneSet = new Set(logs.filter((l) => l.result !== 'failed').map((l) => `${l.user_id}:${l.match_id}:${l.kind}`));

  return { db, emailById, allProfiles: profs, optedIn, nameById, predSet, scoreByKey, doneSet, matches, scores };
}
type Ctx = Awaited<ReturnType<typeof load>>;

async function logSend(db: ReturnType<typeof svc>, userId: string, matchId: string, kind: string, variant: string, result: string) {
  await db.from('email_log').upsert(
    { user_id: userId, match_id: matchId, kind, variant, result },
    { onConflict: 'user_id,match_id,kind' },
  );
}

async function deliver(c: Ctx, prof: Profile, matchId: string, kind: string, variant: Variant, subject: string, html: string): Promise<number> {
  const key = `${prof.id}:${matchId}:${kind}`;
  if (c.doneSet.has(key)) return 0;
  const email = c.emailById.get(prof.id);
  if (!email) return 0;
  const unsubUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${prof.unsubscribe_token}`;
  const ok = await sendEmail(email, subject, html, unsubUrl);
  await logSend(c.db, prof.id, matchId, kind, variant, ok ? 'sent' : 'failed');
  if (ok) c.doneSet.add(key);
  return ok ? 1 : 0;
}

// Next fixture this player still hasn't predicted (fallback: next fixture, then a generic phrase).
function nextLabel(c: Ctx, now: number, userId: string): string {
  const upcoming = c.matches
    .filter((m) => m.status === 'scheduled' && new Date(m.lock_at).getTime() > now)
    .sort((a, b) => +new Date(a.kickoff_utc) - +new Date(b.kickoff_utc));
  const pick = upcoming.find((m) => !c.predSet.has(`${userId}:${m.id}`)) ?? upcoming[0];
  return pick ? fixtureOf(pick) : 'the next round';
}

// ─── Phase: reminders ────────────────────────────────────────────────────────
async function reminders(c: Ctx, now: number): Promise<number> {
  const soon = c.matches.filter((m) => {
    const lock = new Date(m.lock_at).getTime();
    return m.status === 'scheduled' && lock > now && lock <= now + REMINDER_WINDOW_MS;
  });
  let sent = 0;
  for (const m of soon) {
    for (const prof of c.optedIn) {
      if (c.predSet.has(`${prof.id}:${m.id}`)) continue; // already picked
      const ctx: RecapCtx = { name: prof.display_name, match: m, points: 0, exact: false, doubled: false, next: '' };
      const unsubUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${prof.unsubscribe_token}`;
      const t = template('reminder', ctx, unsubUrl);
      sent += await deliver(c, prof, m.id, 'reminder', 'reminder', t.subject, t.html);
    }
  }
  return sent;
}

// How many finished non-final matches in a row (ending at `current`) this player skipped. Matches
// that locked before they joined don't count against them, so the streak reflects real skips only.
function consecutiveMisses(c: Ctx, userId: string, createdAtMs: number, sorted: Match[], currentId: string): number {
  const idx = sorted.findIndex((m) => m.id === currentId);
  let count = 0;
  for (let i = idx; i >= 0; i--) {
    if (new Date(sorted[i].lock_at).getTime() < createdAtMs) break; // predates the player
    if (c.predSet.has(`${userId}:${sorted[i].id}`)) break;
    count++;
  }
  return count;
}

// ─── Phase: recaps ───────────────────────────────────────────────────────────
async function recaps(c: Ctx, now: number): Promise<number> {
  const finished = c.matches
    .filter((m) => m.status === 'finished' && m.round !== 'FINAL')
    .sort((a, b) => +new Date(a.kickoff_utc) - +new Date(b.kickoff_utc));
  let sent = 0;
  for (const m of finished) {
    for (const prof of c.optedIn) {
      const key = `${prof.id}:${m.id}:recap`;
      if (c.doneSet.has(key)) continue;
      // A player only gets a recap for a match they could have played: skip fixtures that locked
      // before they joined, so mid-tournament joiners aren't back-filled with "we missed you".
      const createdAt = new Date(prof.created_at).getTime();
      if (createdAt > new Date(m.lock_at).getTime()) continue;

      const unsubUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${prof.unsubscribe_token}`;
      const predicted = c.predSet.has(`${prof.id}:${m.id}`);

      if (!predicted) {
        // Soft cap: nudge the first two misses in a row, then go quiet until they play again.
        if (consecutiveMisses(c, prof.id, createdAt, finished, m.id) >= 3) {
          await logSend(c.db, prof.id, m.id, 'recap', 'missed', 'suppressed');
          c.doneSet.add(key);
          continue;
        }
        const ctx: RecapCtx = { name: prof.display_name, match: m, points: 0, exact: false, doubled: false, next: nextLabel(c, now, prof.id) };
        const t = template('missed', ctx, unsubUrl);
        sent += await deliver(c, prof, m.id, 'recap', 'missed', t.subject, t.html);
        continue;
      }

      const score = c.scoreByKey.get(`${prof.id}:${m.id}`);
      if (!score) continue; // finished but this player's score row hasn't landed yet; recap next tick
      const points = score.points;
      const card = (score.breakdown?.card ?? {}) as { played?: boolean; outcome?: string };
      const exact = score.breakdown?.exactScore === true;
      const doubled = card.outcome === 'double';

      let variant: Variant;
      if (points >= 10) variant = 'great';
      else if (points >= 1) variant = 'good';
      else if (card.played && (card.outcome === 'penalty' || points < 0)) variant = 'card';
      else variant = 'rough';

      const ctx: RecapCtx = { name: prof.display_name, match: m, points, exact, doubled, next: nextLabel(c, now, prof.id) };
      const t = template(variant, ctx, unsubUrl);
      sent += await deliver(c, prof, m.id, 'recap', variant, t.subject, t.html);
    }
  }
  return sent;
}

// ─── Phase: season wrap-up ───────────────────────────────────────────────────
async function wrapup(c: Ctx): Promise<number> {
  const final = c.matches.find((m) => m.round === 'FINAL' && m.status === 'finished');
  if (!final) return 0;

  const totalByUser = new Map<string, number>();
  for (const s of c.scores) totalByUser.set(s.user_id, (totalByUser.get(s.user_id) ?? 0) + s.points);

  const { data: leagues } = await c.db.from('leagues').select('id, name');
  const { data: members } = await c.db.from('league_members').select('league_id, user_id');
  const membersByLeague = new Map<string, string[]>();
  for (const m of members ?? []) {
    const arr = membersByLeague.get(m.league_id) ?? [];
    arr.push(m.user_id);
    membersByLeague.set(m.league_id, arr);
  }

  let sent = 0;
  for (const prof of c.optedIn) {
    const key = `${prof.id}:${final.id}:wrapup`;
    if (c.doneSet.has(key)) continue;

    const standings: Standing[] = [];
    for (const l of leagues ?? []) {
      const ids = membersByLeague.get(l.id) ?? [];
      if (!ids.includes(prof.id)) continue;
      const ranked = ids
        .map((id) => ({ id, pts: totalByUser.get(id) ?? 0 }))
        .sort((a, b) => b.pts - a.pts);
      const rank = ranked.findIndex((r) => r.id === prof.id) + 1;
      const champ = c.nameById.get(ranked[0]?.id) ?? '—';
      standings.push({ league: l.name, rank, n: ranked.length, champ, won: rank === 1 });
    }

    const unsubUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${prof.unsubscribe_token}`;
    const t = wrapupTemplate(prof.display_name, standings, unsubUrl);
    sent += await deliver(c, prof, final.id, 'wrapup', 'wrapup', t.subject, t.html);
  }
  return sent;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
async function authorized(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-cron-secret') ?? '';
  if (provided) {
    if (provided === CRON_SECRET) return true;
    const { data } = await svc().rpc('check_cron_secret', { provided });
    if (data === true) return true;
  }
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (token && ADMIN_EMAIL) {
    const { data } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(token);
    if (data.user?.email?.toLowerCase() === ADMIN_EMAIL) return true;
  }
  return false;
}

// ─── HTTP entrypoint ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    if (!(await authorized(req))) return json({ error: 'unauthorized' }, 401);

    // Stay dormant until the Resend key is configured, so we don't log a backlog of 'failed' sends
    // (which would then all retry-burst the moment the key is finally set).
    if (!RESEND_API_KEY) return json({ ok: true, skipped: 'RESEND_API_KEY not set' });

    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? 'tick';
    const now = Date.now();
    const c = await load();

    const out: Record<string, number> = {};
    if (mode === 'tick' || mode === 'reminders') out.reminders = await reminders(c, now);
    if (mode === 'tick' || mode === 'recaps') out.recaps = await recaps(c, now);
    if (mode === 'tick' || mode === 'wrapup') out.wrapup = await wrapup(c);

    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
