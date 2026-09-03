/* Fill the demo database with a couple of example people so a visitor lands on
   a board that looks lived-in rather than empty.
     DATABASE_URL=<demo db> node scripts/seed-demo.mjs
   Safe to re-run: it clears the seeded people first. Never point this at the
   real database — it deletes the accounts it manages by name. */
import { Client } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";

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

const PEOPLE = [
  { id: "u_demo_ada", name: "Ada", emoji: "🦊", band: "30-34", goals: "cardio,general",
    fitness: "regular", pattern: [1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
    acts: ["Run", "Cycle", "Run", "Swim", "", "Run", "Walk", "Class", "Run", "Cycle"] },
  { id: "u_demo_sam", name: "Sam", emoji: "🐙", band: "50-54", goals: "weightloss,mobility",
    fitness: "occasional", pattern: [1, 0, 1, 1, 1, 0, 1, 1, 0, 1],
    acts: ["Walk", "", "Yoga", "Walk", "Gym", "", "Walk", "Yoga", "", "Walk"] },
];
const FUN = ["Baked bread", "Stargazed for 15 minutes", "Called an old friend",
             "Tried a new recipe", "Photo walk round the park", "Board game night"];

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

const today = new Date().toISOString().slice(0, 10);
const dayOf = (n) => `2026-09-${String(n).padStart(2, "0")}`;

for (const p of PEOPLE) {
  /* Joined on the 1st: days before you join are neutral, not missed, so a
     same-day join would hide the deliberate gaps in the pattern below. */
  await c.query(
    `INSERT INTO users (id, name, emoji, age_band, goal, goals, fitness, pin_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-01')`,
    [p.id, p.name, p.emoji, p.band, p.goals.split(",")[0], p.goals, p.fitness, hashPin("0000")]);

  for (let i = 0; i < p.pattern.length; i++) {
    const ds = dayOf(i + 1);
    if (ds > today) break;                 /* never log the future */
    if (!p.pattern[i]) continue;
    await c.query(
      `INSERT INTO entries (user_id, date, kind, done, activity, minutes, feeling)
       VALUES ($1,$2,'exercise',true,$3,$4,$5)
       ON CONFLICT (user_id, date, kind) DO NOTHING`,
      [p.id, ds, p.acts[i], 30 + (i % 3) * 15, ["good", "easy", "hard", "good"][i % 4]]);
    if (i % 2 === 0) {
      await c.query(
        `INSERT INTO entries (user_id, date, kind, done, activity)
         VALUES ($1,$2,'fun',true,$3) ON CONFLICT (user_id, date, kind) DO NOTHING`,
        [p.id, ds, FUN[i % FUN.length]]);
    }
  }
}

const counts = await c.query("SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM entries) e");
console.log(`demo database seeded: ${counts.rows[0].u} people, ${counts.rows[0].e} entries`);
await c.end();
