import { sql, endpoint, bad } from "./_lib/db.js";

/* POST { text } → add a fun idea to the shared pool, credited to the session's
   user (never a caller-supplied id). */
export default endpoint(async (req, res, userId) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const clean = String((req.body || {}).text || "").trim().slice(0, 200);
  if (!clean) return bad(res, "text required");
  await sql`INSERT INTO fun_ideas (text, added_by) VALUES (${clean}, ${userId})`;
  res.status(200).json({ ok: true });
}, { auth: true });
