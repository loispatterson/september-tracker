import { sql, endpoint, bad } from "./_lib/db.js";
import { verifyPin, hashPin, validPin, newToken, MAX_FAILS, LOCKOUT_MINUTES } from "./_lib/auth.js";

/* POST { userId, pin } → { token, name }
   Proves you're you when claiming your name on a new device. Wrong PINs are
   counted and lock the account briefly, so a 4-digit PIN can't be brute-forced. */
export default endpoint(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const { userId, pin } = req.body || {};
  if (!userId) return bad(res, "userId required");

  const rows = await sql`SELECT id, name, pin_hash, pin_fails, pin_locked_until
                         FROM users WHERE id = ${userId}`;
  if (!rows.length) return res.status(404).json({ error: "no such person" });
  const u = rows[0];

  if (u.pin_locked_until && new Date(u.pin_locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(u.pin_locked_until) - new Date()) / 60000));
    return res.status(429).json({ error: `too many tries — wait ${mins} min` });
  }

  /* Accounts created before PINs existed set one on first login, rather than
     staying open for anyone to claim. */
  if (!u.pin_hash) {
    if (!validPin(pin)) return bad(res, "choose a 4-digit PIN");
    await sql`UPDATE users SET pin_hash = ${hashPin(pin)} WHERE id = ${userId}`;
    const t = newToken();
    await sql`INSERT INTO sessions (token, user_id) VALUES (${t}, ${userId})`;
    return res.status(200).json({ token: t, name: u.name, pinCreated: true });
  }

  if (!verifyPin(String(pin || ""), u.pin_hash)) {
    const fails = u.pin_fails + 1;
    const lock = fails >= MAX_FAILS;
    await sql`UPDATE users SET
                pin_fails = ${lock ? 0 : fails},
                pin_locked_until = ${lock
                  ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
                  : null}
              WHERE id = ${userId}`;
    return res.status(401).json({
      error: lock ? `too many tries — wait ${LOCKOUT_MINUTES} min` : "wrong PIN",
      triesLeft: lock ? 0 : MAX_FAILS - fails,
    });
  }

  await sql`UPDATE users SET pin_fails = 0, pin_locked_until = NULL WHERE id = ${userId}`;
  const token = newToken();
  await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userId})`;
  res.status(200).json({ token, name: u.name, needsPin: !u.pin_hash });
});
