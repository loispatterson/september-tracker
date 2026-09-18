import { sql, endpoint, sessionUser } from "./_lib/db.js";

/* On the public demo every visitor is issued their own throwaway account, so
   without this the board would grow a row per person who ever clicked the
   link. Each visitor sees the example people plus themselves. */
const isGuest = (name) => /^Guest \d+$/.test(name);
function hideOtherGuests(viewer, users, entries) {
  const keep = users.filter((u) => !isGuest(u.name) || u.id === viewer);
  const ids = new Set(keep.map((u) => u.id));
  return [keep, entries.filter((e) => ids.has(e.user_id))];
}

/* GET /api/board → { users, entries, funIdeas } — everything the app renders. */
export default endpoint(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });

  /* Resolved before the query, because "did I like this" is per viewer.
     Null for a signed-out visitor, which just makes liked_by_me false. */
  const viewer = await sessionUser(req);

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
    /* Like counts ride along here rather than in their own endpoint: the
       board is already refetched every 60 seconds, and a round trip per photo
       would be far more traffic than one integer per row. */
    sql`SELECT e.user_id, e.date, e.kind, e.done, e.activity, e.note,
               e.minutes, e.distance_km, e.feeling, p.id AS photo_id,
               coalesce(l.n, 0) AS likes,
               (mine.user_id IS NOT NULL) AS liked_by_me
        FROM entries e
        LEFT JOIN entry_photos p
          ON p.user_id = e.user_id AND p.date = e.date AND p.kind = e.kind
        LEFT JOIN (SELECT photo_id, count(*)::int AS n
                     FROM photo_likes GROUP BY photo_id) l ON l.photo_id = p.id
        LEFT JOIN photo_likes mine
          ON mine.photo_id = p.id AND mine.user_id = ${viewer}
        WHERE e.date >= '2026-09-01' AND e.date <= '2026-09-30'`,
    sql`SELECT id, text, added_by FROM fun_ideas ORDER BY id`,
  ]);
  /* Lets an open tab notice it is running superseded code. */
  /* CLI deploys have no commit SHA, so fall back to the per-deployment id. */
  const build = process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_URL
    || "dev";
  const demo = process.env.DEMO_MODE === "1";
  const [shownUsers, shownEntries] = demo
    ? hideOtherGuests(viewer, users, entries)
    : [users, entries];
  res.status(200).json({ users: shownUsers, entries: shownEntries, funIdeas, build, demo });
});
