/* Merge duplicate exercise labels.
     DATABASE_URL=<db> node scripts/merge-activities.mjs          # report only
     DATABASE_URL=<db> node scripts/merge-activities.mjs --apply  # write

   "Other…" is free text, so the same activity arrives under several spellings:
   case variants ("Body pump" / "Body Pump") and genuine synonyms ("Building
   works" / "Worked on house"). Case is fixed automatically on write now, so
   this is for the rows written before that and for the synonyms, which no rule
   should merge on its own.

   Per user, never globally. Two people can reasonably use the same word for
   different things, and nobody's labels should be rewritten because of
   someone else's. */
import { Client } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

/* Synonyms to fold, lower-cased. Deliberately explicit rather than fuzzy:
   "Press" and "Press-ups" are not the same activity, and any rule clever
   enough to merge these would eventually merge those. */
const SYNONYMS = [
  { into: "Building work", from: [
      "building works", "worked on building site", "worked on house"] },
];

const c = new Client(url);
await c.connect();

const rows = await c.query(`
  SELECT user_id, activity, count(*)::int AS n
    FROM entries
   WHERE kind = 'exercise' AND activity IS NOT NULL AND activity <> ''
GROUP BY user_id, activity`);

const names = await c.query(`SELECT id, name FROM users`);
const who = new Map(names.rows.map(r => [r.id, r.name]));

/* user -> lower(activity) -> [{activity, n}] */
const byUser = new Map();
for (const r of rows.rows) {
  const m = byUser.get(r.user_id) || new Map();
  const k = r.activity.trim().toLowerCase();
  m.set(k, [...(m.get(k) || []), { activity: r.activity, n: r.n }]);
  byUser.set(r.user_id, m);
}

const plan = [];
for (const [userId, m] of byUser) {
  /* case variants: keep the spelling used most */
  for (const [, variants] of m) {
    if (variants.length < 2) continue;
    const winner = variants.slice().sort((a, b) => b.n - a.n || a.activity.localeCompare(b.activity))[0];
    for (const v of variants) {
      if (v.activity !== winner.activity)
        plan.push({ userId, from: v.activity, to: winner.activity, n: v.n, why: "case" });
    }
  }
  /* synonyms: only where this person actually used them */
  for (const s of SYNONYMS) {
    const has = s.from.filter(f => m.has(f));
    if (!has.length) continue;
    const targetUsed = m.has(s.into.toLowerCase());
    if (!targetUsed && has.length < 2) continue;    /* nothing to merge into */
    for (const f of has) {
      for (const v of m.get(f)) {
        if (v.activity === s.into) continue;
        plan.push({ userId, from: v.activity, to: s.into, n: v.n, why: "synonym" });
      }
    }
  }
}

if (!plan.length) { console.log("Nothing to merge."); await c.end(); process.exit(0); }

for (const p of plan)
  console.log(`${(who.get(p.userId) || p.userId).padEnd(10)} ${String(p.n).padStart(2)}x  ` +
              `${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}  (${p.why})`);

if (!APPLY) {
  console.log(`\n${plan.length} merges. Re-run with --apply to write them.`);
  await c.end(); process.exit(0);
}

let n = 0;
for (const p of plan) {
  const r = await c.query(
    `UPDATE entries SET activity = $1
      WHERE user_id = $2 AND kind = 'exercise' AND activity = $3`,
    [p.to, p.userId, p.from]);
  n += r.rowCount;
}
console.log(`\nUpdated ${n} entries.`);
await c.end();
