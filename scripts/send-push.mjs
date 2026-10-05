/* Send the evening nudge.
     DATABASE_URL=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… \
       node scripts/send-push.mjs reminder
     … node scripts/send-push.mjs late
     … node scripts/send-push.mjs reminder --dry

   Run from GitHub Actions, NOT from Vercel.

   That is not a preference. Vercel Hobby allows twelve serverless functions
   and api/ holds exactly twelve, so a sender living in api/ would be the
   thirteenth and the deploy would fail — quietly, serving the previous build
   while the push errors. Hobby cron also fires once a day, best-effort, with
   no control over the hour. GitHub Actions has neither limit and costs
   nothing for a public repository.

   Two sends a day at most:

     reminder  early evening, to everyone who has not posted today
     late      an hour before midnight, and only to someone with a streak long
               enough to be worth saving

   A notification on a day someone has already posted is the fastest way to
   teach them to swipe the next one away unread, so neither send goes to
   anyone who has done their day.

   Dead subscriptions are pruned rather than retried: a 404 or 410 from the
   push service means the browser is gone for good, and three consecutive
   failures of any other kind means it is not coming back either. */
import { Client } from "@neondatabase/serverless";
import webpush from "web-push";
import { challengeFromEnv } from "../api/_lib/challenge.js";
import { needsReminder, needsLateNudge, streakEndingYesterday, nudgeText } from "../js/push.js";

const kind = (process.argv[2] || "reminder").toLowerCase();
const dry = process.argv.includes("--dry");
if (!["reminder", "late"].includes(kind)) {
  console.error(`Unknown send "${kind}" — expected reminder or late`);
  process.exit(1);
}

const { DATABASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
for (const [name, v] of Object.entries({ DATABASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY })) {
  if (!v) { console.error(`${name} not set`); process.exit(1); }
}
webpush.setVapidDetails(VAPID_SUBJECT || "mailto:nobody@example.com",
                        VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cfg = challengeFromEnv();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

const c = new Client(DATABASE_URL);
await c.connect();
const q = async (text, params = []) => (await c.query(text, params)).rows;

/* Everyone who could be sent to, and what they have done. One query each
   rather than a join, because the entries set is needed whole to work out
   streaks and a join would return it once per subscription. */
const people = await q(`
  SELECT id, name, coalesce(role,'participant') AS role, coalesce(notify,true) AS notify
    FROM users`);
const posted = await q(
  `SELECT DISTINCT user_id FROM entries WHERE date = $1 AND kind = $2 AND done`,
  [today, cfg.dayKind]);
const postedToday = posted.map(r => r.user_id);

/* Who, by the rules in js/push.js — the rules are there so they can be tested
   against a table rather than against a live evening. */
let targets = [];
let streakOf = {};
if (kind === "late") {
  /* Sixty days back is far more than a thirty-day challenge needs and keeps
     the query bounded if this engine is still running next year. */
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 60);
  const recent = await q(
    `SELECT user_id, date FROM entries
      WHERE kind = $1 AND done AND date < $2 AND date >= $3`,
    [cfg.dayKind, today, since.toISOString().slice(0, 10)]);

  const byUser = new Map();
  for (const r of recent) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r.date);
  }
  for (const [id, dates] of byUser) streakOf[id] = streakEndingYesterday(dates, today);
  targets = needsLateNudge(people, postedToday, streakOf);
} else {
  targets = needsReminder(people, postedToday);
}

/* Who HAS posted, for the reminder's opening line. Being told two friends are
   already up is the part that actually moves anyone. */
const movers = people.filter(p => postedToday.includes(p.id)).map(p => p.name);

if (!targets.length) {
  console.log(`${kind}: nobody to tell (${postedToday.length} of ${
    people.filter(p => p.role !== "viewer").length} have posted)`);
  await c.end();
  process.exit(0);
}

const subs = await q(
  `SELECT endpoint, user_id, p256dh, auth, failures FROM push_subscriptions
    WHERE user_id = ANY($1)`,
  [targets.map(t => t.id)]);

console.log(`${kind}: ${targets.length} people, ${subs.length} devices${dry ? " (dry run)" : ""}`);

let sent = 0, pruned = 0, failed = 0;
for (const s of subs) {
  const person = targets.find(t => t.id === s.user_id);
  const text = nudgeText(kind, cfg, { streak: streakOf[s.user_id] || 0, movers });
  const payload = JSON.stringify({ ...text, tag: `cairn-${today}`, url: "/" });

  if (dry) { console.log(`  → ${person.name}: ${text.title} — ${text.body}`); sent++; continue; }

  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    await c.query(
      `UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE endpoint = $1`,
      [s.endpoint]);
    sent++;
  } catch (e) {
    /* 404 and 410 are the push service saying this browser is gone — not a
       transient failure, and retrying it every evening for a month achieves
       nothing. Anything else gets three strikes. */
    const code = e && e.statusCode;
    if (code === 404 || code === 410 || s.failures >= 2) {
      await c.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
      pruned++;
    } else {
      await c.query(
        `UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = $1`,
        [s.endpoint]);
      failed++;
      console.error(`  ${person.name}: ${code || e.message}`);
    }
  }
}

console.log(`sent ${sent}, retrying ${failed}, pruned ${pruned}`);
await c.end();
