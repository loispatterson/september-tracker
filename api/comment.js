import { sql, endpoint, bad } from "./_lib/db.js";

const MAX = 500;

/* /api/comment — comments on someone's fun day.

   GET  ?owner=<id>&date=<YYYY-MM-DD>  → { comments: [...] }
   POST { owner, date, body }          → { comment }
   POST { id, delete: true }           → { deleted: true }

   The author is always taken from the session token, never the body, so
   nobody can post as someone else. Only the author can delete their own
   comment; the owner of the day cannot delete comments on it, because a
   shared board between friends doesn't need moderation tools and adding them
   invites using them. */
export default endpoint(async (req, res, userId) => {
  if (req.method === "GET") {
    const owner = String(req.query.owner || "").trim();
    const date = String(req.query.date || "").trim();
    if (!owner || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, "owner and date required");
    const comments = await sql`
      SELECT c.id, c.user_id, u.name, u.emoji, c.body,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
        FROM entry_comments c JOIN users u ON u.id = c.user_id
       WHERE c.owner_id = ${owner} AND c.date = ${date} AND c.kind = 'fun'
    ORDER BY c.id`;
    return res.status(200).json({ comments });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  if (req.body && req.body.delete) {
    const id = Number(req.body.id);
    if (!Number.isInteger(id)) return bad(res, "id required");
    const gone = await sql`DELETE FROM entry_comments
                            WHERE id = ${id} AND user_id = ${userId}
                        RETURNING id`;
    if (!gone.length) return res.status(404).json({ error: "not yours, or already gone" });
    return res.status(200).json({ deleted: true });
  }

  const owner = String((req.body && req.body.owner) || "").trim();
  const date = String((req.body && req.body.date) || "").trim();
  const body = String((req.body && req.body.body) || "").trim().slice(0, MAX);
  if (!owner || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, "owner and date required");
  if (!body) return bad(res, "say something");

  /* Checked rather than left to the foreign key, so commenting on a day that
     has since been undone gives a clear 404 instead of a 500. */
  const target = await sql`SELECT 1 FROM entries
                            WHERE user_id = ${owner} AND date = ${date} AND kind = 'fun'`;
  if (!target.length) return res.status(404).json({ error: "no such day" });

  const [row] = await sql`
    INSERT INTO entry_comments (user_id, owner_id, date, kind, body)
    VALUES (${userId}, ${owner}, ${date}, 'fun', ${body})
    RETURNING id, user_id, body,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at`;
  const [who] = await sql`SELECT name, emoji FROM users WHERE id = ${userId}`;
  res.status(200).json({ comment: { ...row, name: who.name, emoji: who.emoji } });
}, { auth: true });
