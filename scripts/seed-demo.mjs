/* Fill the demo database with a couple of example people so a visitor lands on
   a board that looks lived-in rather than empty.
     DATABASE_URL=<demo db> node scripts/seed-demo.mjs
   Safe to re-run: it clears the seeded people first. Never point this at the
   real database — it refuses to run unless the URL names the demo one.

   Photos come from scripts/demo-photos/ (see scripts/demo-photos.mjs). They
   are drawn, not photographed: the demo is public, so it can't show anyone's
   real pictures. */
import { Client } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes, createHash } from "node:crypto";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
if (!url.includes("septdemo")) {
  console.error("Refusing to run: DATABASE_URL is not the demo database.");
  process.exit(1);
}

const hashPin = (pin) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${pbkdf2Sync(pin, salt, 100000, 32, "sha256").toString("hex")}`;
};

/* days[0] is today, days[1] yesterday, and so on. Counting back from today
   rather than from the 1st keeps the demo current: re-run it any day in
   September and the example people are up to date instead of looking like
   they gave up in week one.

   exercise: null is a missed day. fun.photo: null means the fun happened but
   wasn't photographed, which breaks the photo streak while leaving the fun
   streak intact — worth showing, since that rule is the one people ask about. */
const PEOPLE = [
  {
    id: "u_demo_ada", name: "Ada", emoji: "🦊", band: "30-34",
    goals: "cardio,general", fitness: "regular",
    days: [
      { exercise: { act: "Swim",  min: 30, feel: "easy" }, fun: { text: "Tried a new recipe",        photo: "recipe" } },
      { exercise: { act: "Cycle", min: 50, feel: "hard" }, fun: { text: "Stargazed for a bit",       photo: "stars" } },
      { exercise: { act: "Run",   min: 35, feel: "good" }, fun: { text: "Baked bread",               photo: "bread" } },
      { exercise: { act: "Run",   min: 40, feel: "good" }, fun: null },
      { exercise: null,                                    fun: { text: "Long bath, no phone",       photo: null } },
      { exercise: { act: "Class", min: 45, feel: "good" }, fun: { text: "Photo walk round the park", photo: "park" } },
    ],
  },
  {
    id: "u_demo_sam", name: "Sam", emoji: "🐙", band: "50-54",
    goals: "weightloss,mobility", fitness: "occasional",
    days: [
      { exercise: { act: "Yoga", min: 30, feel: "easy" }, fun: { text: "Sunset from the balcony", photo: "sunset" } },
      { exercise: null,                                   fun: { text: "Called an old friend",    photo: null } },
      { exercise: { act: "Walk", min: 30, feel: "good" }, fun: { text: "Board game night",        photo: "boardgame" } },
      { exercise: { act: "Walk", min: 45, feel: "good" }, fun: null },
      { exercise: { act: "Gym",  min: 30, feel: "hard" }, fun: null },
      { exercise: null,                                   fun: null },
    ],
  },
];

const photoFile = (name) =>
  readFileSync(new URL(`./demo-photos/${name}.jpg`, import.meta.url));

const c = new Client(url);
await c.connect();

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8")
  .split("\n").map(l => l.replace(/--.*$/, "")).join("\n")
  .split(";").map(s => s.trim()).filter(Boolean);
for (const stmt of schema) await c.query(stmt);

const ids = PEOPLE.map(p => p.id);
await c.query("DELETE FROM entry_photos WHERE user_id = ANY($1)", [ids]);
await c.query("DELETE FROM entries WHERE user_id = ANY($1)", [ids]);
await c.query("DELETE FROM sessions WHERE user_id = ANY($1)", [ids]);
await c.query("DELETE FROM users WHERE id = ANY($1)", [ids]);

const now = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const today = iso(now);
const daysBack = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return iso(d); };
let photos = 0, entries = 0;

for (const p of PEOPLE) {
  /* Backdate to the earliest day this person actually has, clamped to the 1st.
     Days before you join are neutral rather than missed, so joining today
     would hide the deliberate gaps below. */
  const dates = p.days.map((_, i) => daysBack(i)).filter(ds => ds >= "2026-09-01");
  const joined = dates.length ? dates[dates.length - 1] : today;
  await c.query(
    `INSERT INTO users (id, name, emoji, age_band, goal, goals, fitness, pin_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [p.id, p.name, p.emoji, p.band, p.goals.split(",")[0], p.goals, p.fitness, hashPin("0000"), joined]);

  for (let i = 0; i < p.days.length; i++) {
    const ds = daysBack(i);
    if (ds < "2026-09-01" || ds > "2026-09-30") continue;
    const { exercise, fun } = p.days[i];

    if (exercise) {
      await c.query(
        `INSERT INTO entries (user_id, date, kind, done, activity, minutes, feeling)
         VALUES ($1,$2,'exercise',true,$3,$4,$5)`,
        [p.id, ds, exercise.act, exercise.min, exercise.feel]);
      entries++;
    }
    if (!fun) continue;

    await c.query(
      `INSERT INTO entries (user_id, date, kind, done, activity)
       VALUES ($1,$2,'fun',true,$3)`,
      [p.id, ds, fun.text]);
    entries++;
    if (!fun.photo) continue;

    const buf = photoFile(fun.photo);
    /* Content hash in the id so re-running with a redrawn image busts the
       immutable cache that /api/photo sets on the bytes. */
    const tag = createHash("sha256").update(buf).digest("hex").slice(0, 8);
    await c.query(
      `INSERT INTO entry_photos (id, user_id, date, kind, mime, width, height, bytes, data)
       VALUES ($1,$2,$3,'fun','image/jpeg',1000,1000,$4, decode($5,'base64'))`,
      [`p_demo_${p.id.slice(7)}_${ds.replace(/-/g, "")}_${tag}`,
       p.id, ds, buf.length, buf.toString("base64")]);
    photos++;
  }
}

const n = await c.query(`SELECT (SELECT count(*) FROM users) u,
                                (SELECT count(*) FROM entries) e,
                                (SELECT count(*) FROM entry_photos) p,
                                (SELECT coalesce(sum(bytes),0) FROM entry_photos) b`);
const r = n.rows[0];
console.log(`demo database seeded: ${r.u} people, ${r.e} entries, ${r.p} photos ` +
            `(${(Number(r.b) / 1024).toFixed(0)} KB)`);
console.log(`  this run wrote ${entries} entries and ${photos} photos up to ${today}`);
await c.end();
