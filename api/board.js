import { sql, endpoint } from "./_lib/db.js";

/* GET /api/board → { users, entries, funIdeas } — everything the app renders. */
export default endpoint(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });

  const [users, entries, funIdeas] = await Promise.all([
    sql`SELECT id, name, emoji, age_band, goal,
               to_char(created_at, 'YYYY-MM-DD') AS joined,
               pin_hash IS NOT NULL AS has_pin
        FROM users ORDER BY created_at`,
    sql`SELECT user_id, date, kind, done, activity, note FROM entries
        WHERE date >= '2026-09-01' AND date <= '2026-09-30'`,
    sql`SELECT id, text, added_by FROM fun_ideas ORDER BY id`,
  ]);
  res.status(200).json({ users, entries, funIdeas });
});
