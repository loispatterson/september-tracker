import { sql, endpoint, bad } from "./_lib/db.js";
import { validFeeling } from "./_lib/profile.js";

/* POST { date, kind, done, activity?, note? } → upsert (last write wins).
   done:null deletes the entry (un-log / backfill clear).
   The user comes from the session token, so nobody can write to someone
   else's grid by passing a different id. */
export default endpoint(async (req, res, userId) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const { date, kind, done, activity, note } = req.body || {};
  /* 30 is the challenge, but a 4-hour hike is still one day's exercise. */
  const mins = Number((req.body || {}).minutes);
  const minutes = Number.isFinite(mins) ? Math.min(600, Math.max(5, Math.round(mins))) : null;
  /* Optional and only meaningful for some activities; stored to 2 decimals. */
  const dist = Number((req.body || {}).distanceKm);
  const distanceKm = Number.isFinite(dist) && dist > 0
    ? Math.min(999, Math.round(dist * 100) / 100) : null;
  const rawFeeling = (req.body || {}).feeling;
  const feeling = validFeeling(rawFeeling) ? rawFeeling : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date < "2026-09-01" || date > "2026-09-30")
    return bad(res, "date must be in September 2026");
  if (kind !== "exercise" && kind !== "fun") return bad(res, "bad kind");

  if (done === null) {
    await sql`DELETE FROM entries WHERE user_id = ${userId} AND date = ${date} AND kind = ${kind}`;
    return res.status(200).json({ ok: true });
  }

  await sql`INSERT INTO entries (user_id, date, kind, done, activity, note, minutes, distance_km, feeling, updated_at)
            VALUES (${userId}, ${date}, ${kind}, ${!!done},
                    ${activity ? String(activity).slice(0, 200) : null},
                    ${note ? String(note).slice(0, 500) : null},
                    ${minutes}, ${distanceKm}, ${feeling}, now())
            ON CONFLICT (user_id, date, kind) DO UPDATE SET
              done = EXCLUDED.done, activity = EXCLUDED.activity, note = EXCLUDED.note,
              minutes = EXCLUDED.minutes, distance_km = EXCLUDED.distance_km,
              feeling = EXCLUDED.feeling, updated_at = now()`;
  res.status(200).json({ ok: true });
}, { auth: true });
