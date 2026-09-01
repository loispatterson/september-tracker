import { sql, endpoint } from "./_lib/db.js";

/* GET /api/board → { users, entries, funIdeas } — everything the app renders. */
export default endpoint(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });

  const [users, entries, funIdeas] = await Promise.all([
    /* Name and avatar only. Age band, goals, fitness level and notes are
       private to their owner and come back from /api/me instead — the board
       is shared with everyone who has the passcode. */
    sql`SELECT id, name, emoji,
               to_char(created_at, 'YYYY-MM-DD') AS joined,
               pin_hash IS NOT NULL AS has_pin
        FROM users ORDER BY created_at`,
    /* p.id only — NEVER p.data. This response is refetched every 60 seconds on
       phones; photo bytes belong in /api/photo, fetched once and cached. */
    sql`SELECT e.user_id, e.date, e.kind, e.done, e.activity, e.note,
               e.minutes, e.distance_km, p.id AS photo_id
        FROM entries e
        LEFT JOIN entry_photos p
          ON p.user_id = e.user_id AND p.date = e.date AND p.kind = e.kind
        WHERE e.date >= '2026-09-01' AND e.date <= '2026-09-30'`,
    sql`SELECT id, text, added_by FROM fun_ideas ORDER BY id`,
  ]);
  res.status(200).json({ users, entries, funIdeas });
});
