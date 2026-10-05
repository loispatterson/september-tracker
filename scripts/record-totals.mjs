/* Write down what each participant's fundraising page says today.
     DATABASE_URL=<cairn db> node scripts/record-totals.mjs            # show the pages to read
     DATABASE_URL=<cairn db> node scripts/record-totals.mjs lois=120 ahmed=45.50

   Read by hand, twice a week, on purpose.

   The obvious thing is a scraper. A scraper against someone else's marketing
   site breaks the week they change their markup, fails silently, and the first
   anyone notices is in December when the series has a hole through the middle
   of the month. There is no recovering those readings afterwards — the pages
   only ever show today's total. Thirty seconds of typing twice a week buys a
   series that is certainly correct, and the series is the entire reason the
   pilot has anything to show a charity.

   Names are matched loosely (case-insensitive, on the start of the name) so
   there is no need to go and look up ids. Ambiguity is refused rather than
   guessed at.

   Re-running on the same day overwrites that day's figure, so a typo is fixed
   by running it again rather than by opening a SQL console. */
import { Client } from "@neondatabase/serverless";
import { parseAmount } from "../api/_lib/fundraising.js";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

/* The date in Paris, not UTC: a reading taken at 23:30 belongs to the day it
   felt like, and the rest of the app already works in Europe/Paris. */
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

const c = new Client(url);
await c.connect();

const { rows: people } = await c.query(`
  SELECT u.id, u.name, u.fundraising_url,
         (SELECT amount FROM fundraising_snapshots s
           WHERE s.user_id = u.id ORDER BY s.date DESC LIMIT 1) AS last_amount,
         (SELECT date   FROM fundraising_snapshots s
           WHERE s.user_id = u.id ORDER BY s.date DESC LIMIT 1) AS last_date
    FROM users u
   WHERE coalesce(u.role, 'participant') = 'participant'
   ORDER BY u.name`);

const args = process.argv.slice(2);

/* No arguments: print the list to work from, with the links to open and what
   each page said last time, so a number that has gone down is obvious. */
if (!args.length) {
  console.log(`Fundraising pages to read — ${today}\n`);
  for (const p of people) {
    const was = p.last_amount === null
      ? "nothing recorded yet"
      : `£${Number(p.last_amount).toFixed(2)} on ${p.last_date}`;
    console.log(`  ${p.name}`);
    console.log(`    ${p.fundraising_url || "— no page linked —"}`);
    console.log(`    last: ${was}\n`);
  }
  console.log(`Then: node scripts/record-totals.mjs ${
    people.slice(0, 2).map(p => `${p.name.toLowerCase().split(" ")[0]}=0`).join(" ")}`);
  await c.end();
  process.exit(0);
}

/* Resolve every argument before writing anything. A run that is going to fail
   on the third name should not have recorded the first two. */
const writes = [];
const problems = [];

for (const arg of args) {
  const at = arg.indexOf("=");
  if (at < 1) { problems.push(`${arg}: expected name=amount`); continue; }
  const name = arg.slice(0, at).trim().toLowerCase();
  const amount = parseAmount(arg.slice(at + 1));
  if (amount === null) { problems.push(`${arg}: "${arg.slice(at + 1)}" is not an amount`); continue; }

  const hits = people.filter(p => p.name.toLowerCase().startsWith(name));
  if (!hits.length) problems.push(`${arg}: nobody matches "${name}"`);
  else if (hits.length > 1) problems.push(`${arg}: "${name}" matches ${hits.map(h => h.name).join(", ")}`);
  else writes.push({ user: hits[0], amount });
}

if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nNothing written.");
  await c.end();
  process.exit(1);
}

for (const w of writes) {
  await c.query(
    `INSERT INTO fundraising_snapshots (user_id, date, amount, source)
     VALUES ($1, $2, $3, 'recorded')
     ON CONFLICT (user_id, date) DO UPDATE SET amount = excluded.amount,
                                               source = excluded.source`,
    [w.user.id, today, w.amount]);
  const prev = w.user.last_amount === null ? null : Number(w.user.last_amount);
  const move = prev === null ? "first reading"
    : w.amount === prev ? "no change"
    : `${w.amount > prev ? "+" : ""}${(w.amount - prev).toFixed(2)} since ${w.user.last_date}`;
  console.log(`  ${w.user.name.padEnd(14)} £${w.amount.toFixed(2)}   (${move})`);
}

const { rows: [tot] } = await c.query(
  `SELECT sum(amount) AS total FROM fundraising_snapshots s
    WHERE s.date = (SELECT max(date) FROM fundraising_snapshots WHERE user_id = s.user_id)`);
console.log(`\nLatest figures add up to £${Number(tot.total || 0).toFixed(2)}.`);

await c.end();
