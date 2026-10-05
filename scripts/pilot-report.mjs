/* What the pilot actually showed.
     DATABASE_URL=<cairn db> node scripts/pilot-report.mjs
     DATABASE_URL=<cairn db> node scripts/pilot-report.mjs 2026-11

   Four questions, in the order they matter:

     1. Did people post?            entries, which equal photos, so uncountable
                                    by any route other than actually doing it
     2. Did people come back?       user_days — opening the app is a separate
                                    question from posting in it, and the one
                                    that says whether the app did any work
     3. Did the audience matter?    comments split by role, which is whether
                                    viewer accounts were worth building
     4. Did money keep arriving?    the snapshot series, first 48 hours against
                                    the rest of the month

   The last one is the number worth showing a charity, and it is the reason the
   snapshots are a series rather than a column.

   It prints its own caveat. There is no control group inside the app: everyone
   here chose to be here, and a group of friends who agreed to try something
   would probably have done better than average anyway. Any comparison has to
   come from published averages or from asking people who did Movember without
   it. Saying so alongside the numbers is what makes the numbers usable. */
import { Client } from "@neondatabase/serverless";
import { challengeFromEnv } from "../api/_lib/challenge.js";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

/* Default to the month that is running, or the one just finished if this is
   run in early December. */
const month = process.argv[2]
  || new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }).slice(0, 7);
const like = `${month}-%`;

/* The day's entries are kind 'fun' even on Cairn — see the note in
   scripts/schema.sql about why that value was left alone. Taking it from the
   config rather than hardcoding it means this script keeps working if the
   rename ever happens. */
const KIND = challengeFromEnv().dayKind;

const c = new Client(url);
await c.connect();
const q = async (text, params = []) => (await c.query(text, params)).rows;

const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const line = (s = "") => console.log(s);
const rule = (t) => { line(); line(t); line("-".repeat(t.length)); };

line(`Cairn — ${month}, ${days} days`);

/* ---- 1. Posting ---- */
const posted = await q(`
  SELECT u.name,
         count(DISTINCT e.date) AS days,
         min(e.date) AS first, max(e.date) AS last
    FROM users u
    LEFT JOIN entries e ON e.user_id = u.id AND e.date LIKE $1
                       AND e.kind = $2 AND e.done
   WHERE coalesce(u.role, 'participant') = 'participant'
   GROUP BY u.id, u.name ORDER BY days DESC, u.name`, [like, KIND]);

rule("1. Days posted");
for (const p of posted) {
  const n = Number(p.days);
  const bar = "#".repeat(Math.round((n / days) * 30));
  line(`  ${p.name.padEnd(14)} ${String(n).padStart(2)}/${days} ${bar}`);
}
const totalDays = posted.reduce((s, p) => s + Number(p.days), 0);
const finishers = posted.filter(p => Number(p.days) >= days - 2).length;
line();
line(`  ${posted.length} participants, ${totalDays} days posted between them`);
line(`  mean ${(totalDays / Math.max(posted.length, 1) / days * 100).toFixed(0)}% of the month`);
line(`  ${finishers} got to the end (within two days of all ${days})`);

/* Where people stopped. A pilot that loses everyone in week two is a different
   finding from one where people drop off evenly, and the shape is only visible
   by week. */
const weeks = await q(`
  SELECT ((substring(e.date from 9 for 2)::int - 1) / 7) + 1 AS week,
         count(DISTINCT e.user_id) AS people, count(*) AS entries
    FROM entries e WHERE e.date LIKE $1 AND e.kind = $2 AND e.done
   GROUP BY week ORDER BY week`, [like, KIND]);
line();
for (const w of weeks) {
  line(`  week ${w.week}: ${w.entries} posts from ${w.people} people`);
}

/* ---- 2. Coming back ---- */
rule("2. Days the app was opened");
const opened = await q(`
  SELECT u.name, coalesce(u.role, 'participant') AS role,
         count(d.date) AS days
    FROM users u
    LEFT JOIN user_days d ON d.user_id = u.id AND d.date LIKE $1
   GROUP BY u.id, u.name, u.role ORDER BY days DESC, u.name`, [like]);
for (const p of opened) {
  const tag = p.role === "viewer" ? " (viewer)" : "";
  line(`  ${(p.name + tag).padEnd(22)} ${String(p.days).padStart(2)}/${days}`);
}

/* The gap between opening and posting is the interesting part: a day someone
   opened the app and did not post is a day the app asked and was refused. */
const gap = await q(`
  SELECT count(*) AS n FROM user_days d
   WHERE d.date LIKE $1
     AND NOT EXISTS (SELECT 1 FROM entries e
                      WHERE e.user_id = d.user_id AND e.date = d.date
                        AND e.kind = $2 AND e.done)`, [like, KIND]);
line();
line(`  ${gap[0].n} days were opened without a post`);

/* ---- 3. The audience ---- */
rule("3. Comments and likes");
const social = await q(`
  SELECT coalesce(u.role, 'participant') AS role, count(*) AS n
    FROM entry_comments c JOIN users u ON u.id = c.user_id
   WHERE c.date LIKE $1 AND c.kind = $2 GROUP BY role`, [like, KIND]);
const byRole = Object.fromEntries(social.map(r => [r.role, Number(r.n)]));
line(`  ${byRole.participant || 0} comments from participants`);
line(`  ${byRole.viewer || 0} comments from viewers`);

const likes = await q(`
  SELECT count(*) AS n FROM photo_likes l
    JOIN entry_photos p ON p.id = l.photo_id
   WHERE p.date LIKE $1`, [like]);
line(`  ${likes[0].n} likes on photos`);

/* Did the people who got attention post more? Not causal — the popular are
   also the regular — but worth seeing before designing anything around it. */
const attention = await q(`
  SELECT u.name, count(DISTINCT e.date) AS days,
         count(DISTINCT c.id) AS comments
    FROM users u
    JOIN entries e ON e.user_id = u.id AND e.date LIKE $1
                  AND e.kind = $2 AND e.done
    LEFT JOIN entry_comments c ON c.owner_id = u.id AND c.date = e.date
                             AND c.kind = e.kind AND c.user_id <> u.id
   GROUP BY u.id, u.name HAVING count(DISTINCT e.date) > 0
   ORDER BY comments DESC`, [like, KIND]);
if (attention.length) {
  line();
  for (const a of attention) {
    line(`  ${a.name.padEnd(14)} ${a.comments} comments received over ${a.days} days`);
  }
}

/* ---- 4. Money ---- */
rule("4. Fundraising");
const snaps = await q(`
  SELECT s.date, sum(s.amount) AS total, count(*) AS people
    FROM fundraising_snapshots s WHERE s.date LIKE $1
   GROUP BY s.date ORDER BY s.date`, [like]);

if (!snaps.length) {
  line("  No readings recorded. scripts/record-totals.mjs takes them.");
} else {
  for (const s of snaps) {
    line(`  ${s.date}  £${Number(s.total).toFixed(2)}  (${s.people} pages)`);
  }
  /* The shape of the curve, not the total. A month where everything arrives in
     the first two days says sponsors gave once because they were asked once;
     a month where it keeps climbing says the daily thing was doing work. */
  const first = Number(snaps[0].total);
  const last = Number(snaps[snaps.length - 1].total);
  line();
  line(`  first reading (${snaps[0].date}):  £${first.toFixed(2)}`);
  line(`  last reading  (${snaps[snaps.length - 1].date}):  £${last.toFixed(2)}`);
  if (last > 0) {
    line(`  ${(first / last * 100).toFixed(0)}% of the final total was already in at the first reading`);
    line(`  £${(last - first).toFixed(2)} arrived after it`);
  }
}

/* ---- The caveat, printed with the numbers rather than remembered ---- */
rule("Reading this honestly");
line(`  There is no control group. Everyone counted here volunteered, and a`);
line(`  group of friends who agreed to try something new would likely have`);
line(`  done better than average regardless of the app.`);
line();
line(`  So these numbers describe what happened, not what the app caused. The`);
line(`  comparison has to come from somewhere outside: Movember's own published`);
line(`  averages, or asking people who did it this year without this.`);
line();
line(`  Fundraising figures are read off public pages by hand and are only as`);
line(`  good as the readings. Gaps in the series above are missed readings,`);
line(`  not flat weeks.`);

await c.end();
