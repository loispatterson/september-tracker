/* Who has tried the public demo.
     DATABASE_URL=<demo db> node scripts/demo-stats.mjs

   Counts accounts, not visits: a row appears only when someone presses
   "Have a look around" or creates an account. People who read the splash and
   left are invisible here — Vercel's dashboard has the page views.

   Guests idle for two days are deleted by /api/demo, so this is a rolling
   window rather than a running total. */
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!url.includes("septdemo")) {
  console.error("Refusing to run: DATABASE_URL is not the demo database.");
  process.exit(1);
}

const c = new Client(url);
await c.connect();

/* SEEDED counts as the entries the demo hands out; anything above it is
   something the visitor typed themselves. */
const SEEDED = 3;

const guests = await c.query(`
  SELECT u.name,
         to_char(min(s.created_at) AT TIME ZONE 'Europe/Paris', 'DD Mon HH24:MI') AS seen,
         (SELECT count(*) FROM entries e WHERE e.user_id = u.id) AS entries,
         (SELECT count(*) FROM entry_photos p WHERE p.user_id = u.id) AS photos
  FROM users u LEFT JOIN sessions s ON s.user_id = u.id
  WHERE u.name LIKE 'Guest %'
  GROUP BY u.id, u.name ORDER BY min(s.created_at)`);

const signups = await c.query(`
  SELECT name, to_char(created_at AT TIME ZONE 'Europe/Paris', 'DD Mon HH24:MI') AS t
  FROM users
  WHERE name NOT LIKE 'Guest %' AND id NOT IN ('u_demo_ada', 'u_demo_sam')
  ORDER BY created_at`);

const played = guests.rows.filter(g => Number(g.entries) > SEEDED || Number(g.photos) > 0);

console.log(`\nDemo accounts opened: ${guests.rows.length}`);
for (const g of guests.rows) {
  const extra = Number(g.entries) - SEEDED;
  const note = extra > 0 || Number(g.photos) > 0
    ? `logged ${extra > 0 ? `${extra} of their own` : "nothing"}${Number(g.photos) ? `, ${g.photos} photo(s)` : ""}`
    : "just looked";
  console.log(`  ${g.name.padEnd(11)} ${g.seen || "—"}   ${note}`);
}

console.log(`\nOf those, ${played.length} logged something themselves.`);
console.log(`Accounts created: ${signups.rows.length}`);
for (const s of signups.rows) console.log(`  ${s.name}  ${s.t}`);
console.log("");

await c.end();
