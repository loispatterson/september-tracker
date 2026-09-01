/* Local dev server — no cloud, no database. `npm run dev:local`
   Serves the static app and a file-backed stand-in for the /api routes
   (data lands in scripts/.local-data.json).

   PRODUCTION USES api/*.js + Neon; this mirrors those routes' contract so the
   UI can be exercised offline. If you change an endpoint's shape, change both. */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
/* same PIN/token rules as production, imported rather than reimplemented */
import { hashPin, verifyPin, validPin, newToken, MAX_FAILS, LOCKOUT_MINUTES } from "../api/_lib/auth.js";
import { validatePhoto, newPhotoId, stripDataUrl, b64Bytes } from "../api/_lib/photos.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DATA = join(ROOT, "scripts", ".local-data.json");
const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.BOARD_PASSCODE || "";

const AGE_BANDS = ["under30", "30-44", "45-59", "60plus"];
const GOALS = ["strength", "cardio", "mobility", "general"];
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

async function db() {
  if (!existsSync(DATA)) return { users: [], entries: [], funIdeas: [], nextIdea: 1, sessions: {}, photos: {} };
  return JSON.parse(await readFile(DATA, "utf8"));
}
const put = (d) => writeFile(DATA, JSON.stringify(d, null, 2));
const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const MAX_BODY = 6_000_000;   /* mirrors Vercel's 4.5 MB cap, with headroom */

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return {}; }
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
}

async function apiRoute(req, res, path, q) {
  /* set FAIL_API=1 to exercise the app's "can't reach the board" state */
  if (process.env.FAIL_API) return send(res, 503, { error: "database not configured" });
  const given = req.headers["x-passcode"];
  if (PASSCODE && (typeof given !== "string" ||
      given.trim().toLowerCase() !== PASSCODE.trim().toLowerCase())) {
    return send(res, 401, { error: "passcode" });
  }
  const d = await db();
  d.sessions = d.sessions || {};
  d.photos = d.photos || {};

  /* identity from the session token, mirroring api/_lib/db.js */
  const token = req.headers["x-user-token"];
  const userId = typeof token === "string" && token ? d.sessions[token] || null : null;
  const needAuth = () => { send(res, 401, { error: "auth" }); return true; };

  if (path === "/api/board" && req.method === "GET") {
    return send(res, 200, {
      users: d.users.map(({ pin_hash, pin_fails, pin_locked_until, ...u }) =>
        ({ ...u, has_pin: !!pin_hash })),
      /* photo_id only, never the bytes — see api/board.js */
      entries: d.entries
        .filter(e => e.date >= "2026-09-01" && e.date <= "2026-09-30")
        .map(e => ({
          ...e,
          photo_id: e.kind === "fun" ? (d.photos[e.user_id + "|" + e.date] || {}).id || null : null,
        })),
      funIdeas: d.funIdeas,
    });
  }

  if (path === "/api/photo" && req.method === "GET") {
    const id = q.get("id") || "";
    const hit = Object.values(d.photos).find(p => p.id === id);
    if (!hit) return send(res, 404, { error: "not found" });
    const etag = `"${id}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag });
      return res.end();
    }
    const buf = Buffer.from(hit.b64, "base64");
    res.writeHead(200, {
      "content-type": hit.mime,
      "content-length": buf.length,
      "cache-control": "private, max-age=31536000, immutable",
      etag,
    });
    return res.end(buf);
  }

  if (path === "/api/photo" && req.method === "POST") {
    if (!userId) return needAuth();
    const payload = await body(req);
    const { date, mime, w, h, activity } = payload;
    const b64 = stripDataUrl(payload.b64);
    const problem = validatePhoto({ date, mime, b64 });
    if (problem) return send(res, problem.status, { error: problem.error });

    /* the photo needs a fun entry to hang off, but must never overwrite one */
    if (!d.entries.some(e => e.user_id === userId && e.date === date && e.kind === "fun")) {
      d.entries.push({ user_id: userId, date, kind: "fun", done: true,
        activity: activity ? String(activity).slice(0, 200) : "Photo", note: null });
    }
    const id = newPhotoId();
    d.photos[userId + "|" + date] = { id, mime, b64, w: Number(w) || null,
      h: Number(h) || null, bytes: b64Bytes(b64), created_at: new Date().toISOString() };
    await put(d);
    return send(res, 200, { photoId: id, bytes: b64Bytes(b64) });
  }

  if (path === "/api/photo" && req.method === "DELETE") {
    if (!userId) return needAuth();
    const date = q.get("date") || "";
    if (!date) return send(res, 400, { error: "date required" });
    delete d.photos[userId + "|" + date];
    await put(d);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/users" && req.method === "POST") {
    const { name, emoji, ageBand, goal, pin } = await body(req);
    const cleanName = String(name || "").trim().slice(0, 40);
    if (!cleanName) return send(res, 400, { error: "name required" });
    if (!AGE_BANDS.includes(ageBand)) return send(res, 400, { error: "bad ageBand" });
    if (!GOALS.includes(goal)) return send(res, 400, { error: "bad goal" });
    if (!validPin(pin)) return send(res, 400, { error: "PIN must be 4 digits" });
    if (d.users.some(u => u.name === cleanName)) return send(res, 409, { error: "name taken" });
    const id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date();
    const joined = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    d.users.push({ id, name: cleanName, emoji: String(emoji || "💪").slice(0, 8),
                   age_band: ageBand, goal, joined, pin_hash: hashPin(pin), pin_fails: 0, pin_locked_until: null });
    const t = newToken();
    d.sessions[t] = id;
    await put(d);
    return send(res, 200, { id, token: t });
  }

  if (path === "/api/claim" && req.method === "POST") {
    const { userId: who, pin } = await body(req);
    const u = d.users.find(x => x.id === who);
    if (!u) return send(res, 404, { error: "no such person" });
    if (u.pin_locked_until && new Date(u.pin_locked_until) > new Date()) {
      const mins = Math.max(1, Math.ceil((new Date(u.pin_locked_until) - new Date()) / 60000));
      return send(res, 429, { error: `too many tries — wait ${mins} min` });
    }
    if (!u.pin_hash) {
      if (!validPin(pin)) return send(res, 400, { error: "choose a 4-digit PIN" });
      u.pin_hash = hashPin(pin);
      const t0 = newToken();
      d.sessions[t0] = u.id;
      await put(d);
      return send(res, 200, { token: t0, name: u.name, pinCreated: true });
    }
    if (!verifyPin(String(pin || ""), u.pin_hash)) {
      const fails = (u.pin_fails || 0) + 1;
      const lock = fails >= MAX_FAILS;
      u.pin_fails = lock ? 0 : fails;
      u.pin_locked_until = lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : null;
      await put(d);
      return send(res, 401, {
        error: lock ? `too many tries — wait ${LOCKOUT_MINUTES} min` : "wrong PIN",
        triesLeft: lock ? 0 : MAX_FAILS - fails,
      });
    }
    u.pin_fails = 0; u.pin_locked_until = null;
    const t = newToken();
    d.sessions[t] = u.id;
    await put(d);
    return send(res, 200, { token: t, name: u.name });
  }

  if (path === "/api/pin" && req.method === "POST") {
    if (!userId) return needAuth();
    const { currentPin, newPin } = await body(req);
    if (!validPin(newPin)) return send(res, 400, { error: "new PIN must be 4 digits" });
    const u = d.users.find(x => x.id === userId);
    if (u.pin_hash && !verifyPin(String(currentPin || ""), u.pin_hash)) {
      return send(res, 401, { error: "wrong PIN" });
    }
    u.pin_hash = hashPin(newPin); u.pin_fails = 0; u.pin_locked_until = null;
    await put(d);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/users" && req.method === "PATCH") {
    if (!userId) return needAuth();
    const { emoji, ageBand, goal } = await body(req);
    const u = d.users.find(x => x.id === userId);
    if (!u) return send(res, 400, { error: "unknown user" });
    if (emoji) u.emoji = String(emoji).slice(0, 8);
    if (ageBand) { if (!AGE_BANDS.includes(ageBand)) return send(res, 400, { error: "bad ageBand" }); u.age_band = ageBand; }
    if (goal) { if (!GOALS.includes(goal)) return send(res, 400, { error: "bad goal" }); u.goal = goal; }
    await put(d);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/log" && req.method === "POST") {
    if (!userId) return needAuth();
    const { date, kind, done, activity, note } = await body(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date < "2026-09-01" || date > "2026-09-30")
      return send(res, 400, { error: "date must be in September 2026" });
    if (kind !== "exercise" && kind !== "fun") return send(res, 400, { error: "bad kind" });
    d.entries = d.entries.filter(e => !(e.user_id === userId && e.date === date && e.kind === kind));
    /* Production has ON DELETE CASCADE on entry_photos; there are no foreign
       keys here, so the cascade has to be written by hand or un-logging a fun
       day would behave differently locally than in production. */
    if (done === null && kind === "fun") delete d.photos[userId + "|" + date];
    if (done !== null) {
      d.entries.push({ user_id: userId, date, kind, done: !!done,
        activity: activity ? String(activity).slice(0, 200) : null,
        note: note ? String(note).slice(0, 500) : null });
    }
    await put(d);
    return send(res, 200, { ok: true });
  }

  if (path === "/api/fun-ideas" && req.method === "POST") {
    if (!userId) return needAuth();
    const { text } = await body(req);
    const clean = String(text || "").trim().slice(0, 200);
    if (!clean) return send(res, 400, { error: "text required" });
    d.funIdeas.push({ id: d.nextIdea++, text: clean, added_by: userId });
    await put(d);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: "not found" });
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  if (path.startsWith("/api/")) {
    return apiRoute(req, res, path, url.searchParams)
      .catch(e => send(res, 500, { error: String(e) }));
  }

  const rel = path === "/" ? "index.html" : normalize(path).replace(/^(\.\.[/\\])+/, "").slice(1);
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(await readFile(file));
}).listen(PORT, () => console.log(`September Tracker (local, no DB) → http://localhost:${PORT}`));
