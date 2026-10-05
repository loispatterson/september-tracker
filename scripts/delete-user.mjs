/* Take someone off the board, completely.
     DATABASE_URL=<cairn db> node scripts/delete-user.mjs lois
     DATABASE_URL=<cairn db> node scripts/delete-user.mjs lois --yes

   This exists because the board is a public URL with people's real names and
   faces on it. "Take me off it" has to have an answer, and the answer cannot
   be "Loïs will write some SQL" — it has to be a thing that works on the
   evening somebody asks, without thinking.

   Everything goes: their entries, their photos, the likes and comments they
   left on other people, the comments other people left on their days, their
   sessions, their push subscriptions and their fundraising readings. Most of
   that happens by ON DELETE CASCADE, but not all of it, so the deletes are
   written out rather than trusted.

   It shows what it is about to destroy and waits, unless told not to. There is
   no undo and no soft-delete flag: a half-deleted person whose face is still
   in the gallery is worse than no feature at all. */
import { Client } from "@neondatabase/serverless";
import { createInterface } from "node:readline/promises";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const who = args.filter(a => !a.startsWith("--"))[0];
if (!who) {
  console.error("Usage: node scripts/delete-user.mjs <name> [--yes]");
  process.exit(1);
}

const c = new Client(url);
await c.connect();

const { rows: hits } = await c.query(
  `SELECT id, name, coalesce(role, 'participant') AS role FROM users
    WHERE lower(name) LIKE $1 ORDER BY name`, [`${who.toLowerCase()}%`]);

if (!hits.length) { console.error(`Nobody matches "${who}".`); await c.end(); process.exit(1); }
if (hits.length > 1) {
  console.error(`"${who}" matches ${hits.map(h => h.name).join(", ")} — be more specific.`);
  await c.end(); process.exit(1);
}
const user = hits[0];

/* What is about to go. Counted before anything is touched, and printed, so the
   confirmation is informed rather than a reflex. */
const counts = await c.query(`
  SELECT (SELECT count(*) FROM entries        WHERE user_id = $1) AS entries,
         (SELECT count(*) FROM entry_photos   WHERE user_id = $1) AS photos,
         (SELECT count(*) FROM entry_comments WHERE user_id = $1) AS comments_written,
         (SELECT count(*) FROM entry_comments WHERE owner_id = $1) AS comments_received,
         (SELECT count(*) FROM photo_likes    WHERE user_id = $1) AS likes_given,
         (SELECT count(*) FROM sessions       WHERE user_id = $1) AS sessions,
         (SELECT count(*) FROM user_days      WHERE user_id = $1) AS days_opened,
         (SELECT count(*) FROM fun_ideas      WHERE added_by = $1) AS ideas`,
  [user.id]);
const n = counts.rows[0];

console.log(`\n${user.name} (${user.role}, id ${user.id})\n`);
console.log(`  ${n.entries} day entries`);
console.log(`  ${n.photos} photos`);
console.log(`  ${n.comments_written} comments they wrote, ${n.comments_received} written on their days`);
console.log(`  ${n.likes_given} likes they gave`);
console.log(`  ${n.days_opened} recorded days of opening the app`);
console.log(`  ${n.sessions} sessions, ${n.ideas} shared ideas`);
console.log(`\nThis cannot be undone.`);

if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nType the name "${user.name}" to confirm: `);
  rl.close();
  if (answer.trim() !== user.name) { console.log("Nothing deleted."); await c.end(); process.exit(0); }
}

/* Order matters where there is no cascade. Comments on their days are keyed to
   (owner_id, date, kind) and go when the entries do, but comments they left on
   other people are keyed to their user_id — that cascade exists, and is listed
   anyway so this reads as a complete account of what happens.

   fun_ideas keeps the idea and forgets who added it: the pool is shared
   content other people are still using, and removing a person should not
   silently delete everyone's suggestions. */
const steps = [
  ["comments they wrote",    `DELETE FROM entry_comments WHERE user_id = $1`],
  ["comments on their days", `DELETE FROM entry_comments WHERE owner_id = $1`],
  ["likes they gave",        `DELETE FROM photo_likes WHERE user_id = $1`],
  ["likes on their photos",  `DELETE FROM photo_likes WHERE photo_id IN
                                (SELECT id FROM entry_photos WHERE user_id = $1)`],
  ["photos",                 `DELETE FROM entry_photos WHERE user_id = $1`],
  ["entries",                `DELETE FROM entries WHERE user_id = $1`],
  ["sessions",               `DELETE FROM sessions WHERE user_id = $1`],
  ["push subscriptions",     `DELETE FROM push_subscriptions WHERE user_id = $1`],
  ["fundraising readings",   `DELETE FROM fundraising_snapshots WHERE user_id = $1`],
  ["days opened",            `DELETE FROM user_days WHERE user_id = $1`],
  ["their name off shared ideas", `UPDATE fun_ideas SET added_by = NULL WHERE added_by = $1`],
  ["whoever was cheering them",   `UPDATE users SET cheering = NULL WHERE cheering = $1`],
  ["the account",            `DELETE FROM users WHERE id = $1`],
];

console.log();
for (const [label, text] of steps) {
  const r = await c.query(text, [user.id]);
  console.log(`  ${String(r.rowCount).padStart(4)}  ${label}`);
}

console.log(`\n${user.name} is gone. Their photos are not in a backup anywhere —`);
console.log(`Neon's point-in-time restore window still has them, and expires on its own.`);

await c.end();
