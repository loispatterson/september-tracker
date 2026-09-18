import { sql, endpoint, bad } from "./_lib/db.js";

/* POST /api/like { photoId } → { liked, count }

   Toggles this person's like on one photo. The user is taken from the session
   token, never from the body, so nobody can like on someone else's behalf or
   stuff the count by repeating the call: the primary key on (photo_id,
   user_id) makes a second like a no-op rather than a second row.

   Liking your own photo is allowed. It is a tracker shared by a handful of
   people who know each other, and policing that would cost more than it's
   worth. */
export default endpoint(async (req, res, userId) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const photoId = String((req.body && req.body.photoId) || "").trim();
  if (!photoId) return bad(res, "photoId required");

  /* Checked rather than left to the foreign key, so a photo that has been
     replaced since the page loaded gives a clear 404 instead of a 500. */
  const exists = await sql`SELECT 1 FROM entry_photos WHERE id = ${photoId}`;
  if (!exists.length) return res.status(404).json({ error: "no such photo" });

  const gone = await sql`DELETE FROM photo_likes
                         WHERE photo_id = ${photoId} AND user_id = ${userId}
                         RETURNING photo_id`;
  if (!gone.length) {
    await sql`INSERT INTO photo_likes (photo_id, user_id) VALUES (${photoId}, ${userId})
              ON CONFLICT DO NOTHING`;
  }

  const [{ count }] = await sql`SELECT count(*)::int AS count
                                FROM photo_likes WHERE photo_id = ${photoId}`;
  res.status(200).json({ liked: !gone.length, count });
}, { auth: true });
