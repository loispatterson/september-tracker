import { sql, endpoint, sessionUser } from "./_lib/db.js";
import { challengeFromEnv } from "./_lib/challenge.js";

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

  /* Which month to send. Defaults to the current one; the client asks for an
     earlier 'YYYY-MM' when someone pages back. Only ever one month at a time,
     because this payload is refetched every 60 seconds by every phone. */
  const asked = String(req.query.month || "");
  const month = /^\d{4}-\d{2}$/.test(asked)
    ? asked
    : new Date().toISOString().slice(0, 7);

  const [users, entries, funIdeas, myActivities, raised] = await Promise.all([
    /* Name and avatar only. Age band, goals, fitness level and notes are
       private to their owner and come back from /api/me instead — the board
       is shared with everyone who has the passcode. */
    /* last_active drives hiding people who have drifted away. It looks across
       every month, not just the one on screen, because on the 1st nobody has
       logged anything yet and everyone would read as stale. */
    /* EVERY user, viewers included, each carrying its role.
       render() decides whether someone is signed in by looking themselves up
       in this list. Filter viewers out here and every sponsor is bounced to
       the onboarding screen for ever, with a symptom that points nowhere near
       the cause. The client filters per view instead. */
    sql`SELECT u.id, u.name, u.emoji, u.role, u.fundraising_url,
               to_char(u.created_at, 'YYYY-MM-DD') AS joined,
               u.pin_hash IS NOT NULL AS has_pin,
               greatest(coalesce(max(e.date), ''),
                        to_char(u.created_at, 'YYYY-MM-DD')) AS last_active
          FROM users u
          LEFT JOIN entries e ON e.user_id = u.id AND e.done
      GROUP BY u.id, u.name, u.emoji, u.role, u.fundraising_url,
               u.created_at, u.pin_hash
      ORDER BY u.created_at`,
    /* p.id only — NEVER p.data. This response is refetched every 60 seconds on
       phones; photo bytes belong in /api/photo, fetched once and cached. */
    /* Like counts ride along here rather than in their own endpoint: the
       board is already refetched every 60 seconds, and a round trip per photo
       would be far more traffic than one integer per row. */
    sql`SELECT e.user_id, e.date, e.kind, e.done, e.activity, e.note,
               e.minutes, e.distance_km, e.feeling, p.id AS photo_id,
               coalesce(l.n, 0) AS likes,
               (mine.user_id IS NOT NULL) AS liked_by_me,
               coalesce(c.n, 0) AS comments
        FROM entries e
        LEFT JOIN entry_photos p
          ON p.user_id = e.user_id AND p.date = e.date AND p.kind = e.kind
        LEFT JOIN (SELECT photo_id, count(*)::int AS n
                     FROM photo_likes GROUP BY photo_id) l ON l.photo_id = p.id
        LEFT JOIN photo_likes mine
          ON mine.photo_id = p.id AND mine.user_id = ${viewer}
        /* Just the count. Bodies are fetched per thread when someone opens
           one — this payload is refetched every 60 seconds by every phone. */
        LEFT JOIN (SELECT owner_id, date, kind, count(*)::int AS n
                     FROM entry_comments GROUP BY owner_id, date, kind) c
          ON c.owner_id = e.user_id AND c.date = e.date AND c.kind = e.kind
        /* One month per request. The client renders a single grid and
           computes streaks inside it, so shipping every month would be bytes
           nobody draws — on a payload refetched every 60 seconds. */
        WHERE e.date LIKE ${month + '%'}`,
    sql`SELECT id, text, added_by FROM fun_ideas ORDER BY id`,
    /* What this person actually does, across every month rather than the one
       on screen. The chip list is reordered from it, so on the 1st your habits
       carry over instead of the app forgetting you. Viewer-only and tiny: one
       row per distinct activity they have ever logged.

       `last` breaks ties towards what you did recently, so two activities on
       the same count don't swap places at random between refreshes. */
    viewer
      ? sql`SELECT activity, count(*)::int AS n, max(date) AS last
              FROM entries
             WHERE user_id = ${viewer} AND kind = 'exercise'
               AND done AND activity IS NOT NULL AND activity <> ''
          GROUP BY activity
          ORDER BY n DESC, last DESC
             LIMIT 12`
      : Promise.resolve([]),
    /* Latest recorded total per person, for the "together we've raised" line
       and the sponsor buttons. DISTINCT ON takes one row each, the most recent.
       Only asked for where the challenge actually fundraises. */
    challengeFromEnv().fundraising
      ? sql`SELECT DISTINCT ON (user_id) user_id, amount, currency, date
              FROM fundraising_snapshots
          ORDER BY user_id, date DESC`
      : Promise.resolve([]),
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
    const cfg = challengeFromEnv();

  /* One row per person per day they opened the app. "Days posted" says whether
     someone kept the habit; this says whether they kept opening the thing,
     which is the separate question and the one that says whether the app is
     doing any work at all.

     ON CONFLICT DO NOTHING, so the 60-second poll costs one insert a day
     rather than 1440. Not awaited: a failed analytics write must never fail
     the board, and the board is what people actually came for. */
  if (viewer) {
    sql`INSERT INTO user_days (user_id, date)
        VALUES (${viewer}, to_char(now(), 'YYYY-MM-DD'))
        ON CONFLICT DO NOTHING`.catch(() => {});
  }

  res.status(200).json({ users: shownUsers, entries: shownEntries, funIdeas,
                        myActivities, raised, month, build, demo,
                        challenge: cfg.id,
                        vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
                        open: !process.env.BOARD_PASSCODE });
});
