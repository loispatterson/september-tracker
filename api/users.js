import { sql, endpoint, bad } from "./_lib/db.js";
import { hashPin, newToken, validPin } from "./_lib/auth.js";

const AGE_BANDS = ["under30", "30-44", "45-59", "60plus"];
const GOALS = ["strength", "cardio", "mobility", "general"];

/* POST { name, emoji, ageBand, goal, pin } → { id, token }   (409 if name taken)
   PATCH { emoji?, ageBand?, goal? } → { ok }   (identity comes from the token) */
export default endpoint(async (req, res) => {
  if (req.method === "POST") {
    const { name, emoji, ageBand, goal, pin } = req.body || {};
    const cleanName = String(name || "").trim().slice(0, 40);
    if (!cleanName) return bad(res, "name required");
    if (!AGE_BANDS.includes(ageBand)) return bad(res, "bad ageBand");
    if (!GOALS.includes(goal)) return bad(res, "bad goal");
    if (!validPin(pin)) return bad(res, "PIN must be 4 digits");

    const id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      await sql`INSERT INTO users (id, name, emoji, age_band, goal, pin_hash)
                VALUES (${id}, ${cleanName}, ${String(emoji || "💪").slice(0, 8)},
                        ${ageBand}, ${goal}, ${hashPin(pin)})`;
    } catch (e) {
      if (String(e).includes("users_name_key")) return res.status(409).json({ error: "name taken" });
      throw e;
    }
    const token = newToken();
    await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${id})`;
    return res.status(200).json({ id, token });
  }

  if (req.method === "PATCH") return patch(req, res);
  res.status(405).json({ error: "method" });
});

/* PATCH needs a session; POST (signing up) cannot have one yet, so the auth
   check lives on this branch rather than the whole endpoint. */
const patch = endpoint(async (req, res, userId) => {
  const { emoji, ageBand, goal } = req.body || {};
  if (ageBand && !AGE_BANDS.includes(ageBand)) return bad(res, "bad ageBand");
  if (goal && !GOALS.includes(goal)) return bad(res, "bad goal");
  await sql`UPDATE users SET
              emoji = COALESCE(${emoji ? String(emoji).slice(0, 8) : null}, emoji),
              age_band = COALESCE(${ageBand || null}, age_band),
              goal = COALESCE(${goal || null}, goal)
            WHERE id = ${userId}`;
  res.status(200).json({ ok: true });
}, { auth: true });
