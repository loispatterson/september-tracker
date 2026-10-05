import { sql, endpoint } from "./_lib/db.js";
import { foldActivityCounts } from "./_lib/activity.js";

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
  GROUP BY activity ORDER BY n DESC, activity LIMIT 12`;   /* folded below */

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

  return { months: rows, totals: { ...totals, ...social, topActivities: foldActivityCounts(top).slice(0, 3) } };
}

/* One browser's agreement to be notified.

   Stored by endpoint rather than by user, because the endpoint is what the
   push service issues and what identifies the subscription — the same person
   on a phone and a laptop is two rows, and both should ring.

   An endpoint can also move between accounts: a shared tablet, or someone who
   switched user on the same browser. ON CONFLICT therefore reassigns it rather
   than failing, so the notification follows the person actually logged in. */
async function savePush(req, res, userId) {
  const sub = (req.body || {}).subscription;
  const endpointUrl = sub && typeof sub.endpoint === "string" ? sub.endpoint : "";
  const keys = (sub && sub.keys) || {};

  /* Unsubscribing sends the endpoint with no keys. Deleting the row is the
     whole of it — there is no "muted" state, because a subscription we keep
     but never send to is a thing that silently comes back to life later. */
  if (req.body && req.body.remove) {
    if (endpointUrl) await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpointUrl}`;
    await sql`UPDATE users SET notify = false WHERE id = ${userId}`;
    return res.status(200).json({ ok: true, subscribed: false });
  }

  if (!endpointUrl || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: "bad subscription" });
  }
  /* A push endpoint is a URL on the browser vendor's own service. Length is
     the only thing worth checking: the value is never rendered, only posted
     back to the service that issued it. */
  if (endpointUrl.length > 1000) return res.status(400).json({ error: "bad subscription" });

  await sql`
    INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
    VALUES (${endpointUrl}, ${userId}, ${String(keys.p256dh)}, ${String(keys.auth)})
    ON CONFLICT (endpoint) DO UPDATE
      SET user_id = excluded.user_id, p256dh = excluded.p256dh,
          auth = excluded.auth, failures = 0, last_ok_at = NULL`;
  await sql`UPDATE users SET notify = true WHERE id = ${userId}`;
  return res.status(200).json({ ok: true, subscribed: true });
}

/* GET  /api/me             → your own fitness profile.
   GET  /api/me?view=summary → your month-by-month history.
   POST /api/me?view=push    → add or remove this browser's subscription.

   Separate from /api/board because this is the private half: age band, goals,
   fitness level and free-text note are only ever returned to their owner.

   The POST is multiplexed onto this file rather than given api/push.js for the
   same reason the summary is here — Vercel Hobby allows twelve functions and
   api/ holds exactly twelve. */
export default endpoint(async (req, res, userId) => {
  if (req.method === "POST" && req.query.view === "push") {
    return savePush(req, res, userId);
  }
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
