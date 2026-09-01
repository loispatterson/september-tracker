import { sql, endpoint, bad } from "./_lib/db.js";
import { hashPin, verifyPin, validPin } from "./_lib/auth.js";

/* POST { currentPin, newPin } → { ok }
   Changing your PIN needs the current one, so a borrowed unlocked phone can't
   quietly lock you out of your own name. */
export default endpoint(async (req, res, userId) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const { currentPin, newPin } = req.body || {};
  if (!validPin(newPin)) return bad(res, "new PIN must be 4 digits");

  const rows = await sql`SELECT pin_hash FROM users WHERE id = ${userId}`;
  if (!rows.length) return res.status(404).json({ error: "no such person" });
  const stored = rows[0].pin_hash;
  if (stored && !verifyPin(String(currentPin || ""), stored)) {
    return res.status(401).json({ error: "wrong PIN" });
  }

  await sql`UPDATE users SET pin_hash = ${hashPin(newPin)},
              pin_fails = 0, pin_locked_until = NULL WHERE id = ${userId}`;
  res.status(200).json({ ok: true });
}, { auth: true });
