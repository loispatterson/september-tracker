import { sql, endpoint } from "./_lib/db.js";

/* GET /api/me → your own fitness profile.
   Separate from /api/board because this is the private half: age band, goals,
   fitness level and free-text note are only ever returned to their owner. */
export default endpoint(async (req, res, userId) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });

  const rows = await sql`SELECT id, name, emoji, age_band, goal, goals, fitness, note
                         FROM users WHERE id = ${userId}`;
  if (!rows.length) return res.status(404).json({ error: "no such person" });

  const u = rows[0];
  res.status(200).json({
    id: u.id,
    name: u.name,
    emoji: u.emoji,
    ageBand: u.age_band,
    /* goals is stored comma-separated; fall back to the old single goal so
       accounts created before multi-goal still get sensible suggestions. */
    goals: u.goals ? u.goals.split(",").filter(Boolean) : (u.goal ? [u.goal] : []),
    fitness: u.fitness || "",
    note: u.note || "",
  });
}, { auth: true });
