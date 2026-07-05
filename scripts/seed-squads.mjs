// One-off: build the SQL to reseed `squad_players` with full 26-man rosters from
// the public-domain openfootball feed (same source as results, so player names line
// up with goalscorer names). Prints SQL to stdout; a summary to stderr.
//
//   node scripts/seed-squads.mjs > /tmp/seed.sql
//
// Then apply the SQL against the project (service-role / admin connection).

const SQUADS = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.squads.json';

// R16 fixtures (matches.api_fixture_id → the two teams). Stable; the `matches` table
// isn't publicly readable, and this maps team → (fixture, side) for the seed.
const MATCHES = [
  { fixture: 'of-89', home: 'Paraguay', away: 'France' },
  { fixture: 'of-90', home: 'Canada', away: 'Morocco' },
  { fixture: 'of-91', home: 'Brazil', away: 'Norway' },
  { fixture: 'of-92', home: 'Mexico', away: 'England' },
  { fixture: 'of-93', home: 'Portugal', away: 'Spain' },
  { fixture: 'of-94', home: 'USA', away: 'Belgium' },
  { fixture: 'of-95', home: 'Argentina', away: 'Egypt' },
  { fixture: 'of-96', home: 'Switzerland', away: 'Colombia' },
];

// openfootball team names vs our stored match team names (normalized). Extend as needed.
const ALIAS = {
  'usa': 'united states',
  'united states': 'usa',
  'south korea': 'korea republic',
  'korea republic': 'south korea',
};

const norm = (s) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z ]/g, '').trim();

const squads = await fetch(SQUADS).then((r) => r.json());

const byName = new Map();
for (const t of squads) byName.set(norm(t.name), t);

const findTeam = (name) => {
  const n = norm(name);
  if (byName.has(n)) return byName.get(n);
  if (ALIAS[n] && byName.has(ALIAS[n])) return byName.get(ALIAS[n]);
  return null;
};

const rows = [];
const missing = [];
for (const m of MATCHES) {
  for (const [side, team] of [['home', m.home], ['away', m.away]]) {
    const t = findTeam(team);
    if (!t) { missing.push(team); continue; }
    const code = t.fifa_code.toLowerCase();
    for (const p of t.players) {
      rows.push({ fixture: m.fixture, side, pid: `${code}-${p.number}`, name: p.name, pos: p.pos });
    }
  }
}

const esc = (s) => String(s).replace(/'/g, "''");
const values = rows
  .map((r) => `('${esc(r.fixture)}','${r.side}','${esc(r.pid)}','${esc(r.name)}','${r.pos}')`)
  .join(',\n');

const sql = `delete from squad_players;
insert into squad_players (match_id, team, api_player_id, name, position, is_starter)
select m.id, v.team::team_side, v.pid, v.pname, v.pos, false
from (values
${values}
) as v(fixture, team, pid, pname, pos)
join matches m on m.api_fixture_id = v.fixture;`;

process.stderr.write(`teams matched, rows=${rows.length}, missing=${JSON.stringify([...new Set(missing)])}\n`);
process.stdout.write(sql);
