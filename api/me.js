import { sql, endpoint } from "./_lib/db.js";

/* Your own history, a row per month.

   The board deliberately carries only the current month — it is refetched
   every 60 seconds by every phone — so looking back needs its own query. It
   lives here rather than in its own file because both halves answer the same
   question, "what is true about me", and the Hobby plan caps a deployment at
   twelve functions.

   Private to the viewer. The board is shared, but how often someone managed a
   fun day in August is nobody else's business unless they say so. */
async function summaryFor(userId) {
  const months = await sql`
    SELECT substr(date, 1, 7) AS month,
           count(*) FILTER (WHERE kind = 'exercise' AND done)::int AS exercise_days,
           count(*) FILTER (WHERE kind = 'fun' AND done)::int      AS fun_days,
           coalesce(sum(minutes) FILTER (WHERE kind = 'exercise' AND done), 0)::int AS minutes,
           coalesce(sum(distance_km) FILTER (WHERE kind = 'exercise' AND done), 0)::numeric AS km
      FROM entries
     WHERE user_id = ${userId}
  GROUP BY substr(date, 1, 7)
  ORDER BY month`;

  /* Photos and the activity breakdown are separate rather than joined in:
     entry_photos is one row per fun day, and joining it to the entries
     aggregate above would multiply the exercise rows. */
  const photos = await sql`
    SELECT substr(date, 1, 7) AS month, count(*)::int AS photos
      FROM entry_photos WHERE user_id = ${userId}
  GROUP BY substr(date, 1, 7)`;
  const byPhoto = new Map(photos.map(p => [p.month, p.photos]));

  /* What they did most, all time. Three is enough to say something true
     without turning the page into a table. */
  const top = await sql`
    SELECT activity, count(*)::int AS n
      FROM entries
     WHERE user_id = ${userId} AND kind = 'exercise' AND done
       AND activity IS NOT NULL AND activity <> ''
  GROUP BY activity ORDER BY n DESC, activity LIMIT 3`;

  /* Comments and likes received: the sociable half of the board, and the part
     people are most pleased to see counted. */
  const [social] = await sql`
    SELECT (SELECT count(*)::int FROM entry_comments WHERE owner_id = ${userId}) AS comments_received,
           (SELECT count(*)::int FROM photo_likes l
              JOIN entry_photos p ON p.id = l.photo_id
             WHERE p.user_id = ${userId}) AS likes_received`;

  const rows = months.map(m => ({
    month: m.month,
    exerciseDays: m.exercise_days,
    funDays: m.fun_days,
    minutes: m.minutes,
    km: Number(m.km) || 0,
    photos: byPhoto.get(m.month) || 0,
  }));

  const totals = rows.reduce((t, m) => ({
    exerciseDays: t.exerciseDays + m.exerciseDays,
    funDays: t.funDays + m.funDays,
    minutes: t.minutes + m.minutes,
    km: t.km + m.km,
    photos: t.photos + m.photos,
  }), { exerciseDays: 0, funDays: 0, minutes: 0, km: 0, photos: 0 });

  return { months: rows, totals: { ...totals, ...social, topActivities: top } };
}

/* GET /api/me            → your own fitness profile.
   GET /api/me?view=summary → your month-by-month history.

   Separate from /api/board because this is the private half: age band, goals,
   fitness level and free-text note are only ever returned to their owner. */
export default endpoint(async (req, res, userId) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method" });

  /* Four queries, so it is only run when the Progress tab is opened — never
     on boot, which is what the bare /api/me call is for. */
  if (req.query.view === "summary") {
    return res.status(200).json(await summaryFor(userId));
  }

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
