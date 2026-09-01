import { neon } from "@neondatabase/serverless";

/* Lazy client: creating it at import time crashes the whole function with an
   opaque FUNCTION_INVOCATION_FAILED when DATABASE_URL is missing. */
let client = null;
function connect() {
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

/* Usable as a tagged template — sql`SELECT ...` — like the driver itself.
   Tagged templates only: this driver's neon() has no .query for raw SQL text
   (scripts/init-db.mjs uses Client for that). */
export const sql = (...args) => connect()(...args);

/* Shared-board passcode. Forgiving on case and stray spaces: phone keyboards
   autocapitalise, and this is a "keep strangers out" code shared in a group
   chat, not a password. */
function passcodeOk(req) {
  const expected = process.env.BOARD_PASSCODE;
  if (!expected) return true;
  const got = req.headers["x-passcode"];
  return typeof got === "string" && got.trim().toLowerCase() === expected.trim().toLowerCase();
}

/* Who is this request? Resolved from the session token, never from the body —
   that's what stops one person writing to another's grid. */
async function sessionUser(req) {
  const token = req.headers["x-user-token"];
  if (!token || typeof token !== "string") return null;
  const rows = await sql`SELECT user_id FROM sessions WHERE token = ${token}`;
  return rows.length ? rows[0].user_id : null;
}

/* Wraps a handler with the checks every endpoint needs: configured database,
   valid passcode, and JSON (never a raw crash) if anything throws.
   With { auth: true } the caller must also present a valid session token; the
   resolved user id is passed to the handler. */
export function endpoint(fn, { auth = false } = {}) {
  return async (req, res) => {
    try {
      if (!process.env.DATABASE_URL) {
        return res.status(503).json({ error: "database not configured" });
      }
      if (!passcodeOk(req)) return res.status(401).json({ error: "passcode" });

      let userId = null;
      if (auth) {
        userId = await sessionUser(req);
        if (!userId) return res.status(401).json({ error: "auth" });
      }
      await fn(req, res, userId);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: "server error" });
    }
  };
}

export function bad(res, msg) {
  res.status(400).json({ error: msg });
}
