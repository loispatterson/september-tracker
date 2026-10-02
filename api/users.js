import { sql, endpoint, bad } from "./_lib/db.js";
import { hashPin, newToken, validPin } from "./_lib/auth.js";
import { validAgeBand, cleanGoals, cleanNote, FITNESS, GOALS } from "./_lib/profile.js";
import { challengeFromEnv } from "./_lib/challenge.js";
import { cleanFundraisingUrl } from "./_lib/fundraising.js";

/* POST { name, emoji, ageBand, goals[], fitness, note?, pin } → { id, token }
   PATCH { emoji?, ageBand?, goals?, fitness?, note? } → { ok }
   Identity on PATCH comes from the session token, never the body. */
export default endpoint(async (req, res) => {
  if (req.method === "POST") {
    const cfg = challengeFromEnv();
    const { name, emoji, ageBand, fitness, note, pin, cheering } = req.body || {};
    const goals = cleanGoals((req.body || {}).goals);
    const cleanName = String(name || "").trim().slice(0, 40);

    /* Viewers are sponsors and friends who watch. They never log a day, so the
       fitness questionnaire is not theirs to answer: it exists only to tune
       workout suggestions. Anything the challenge does not offer falls back to
       participant. */
    const asked = String((req.body || {}).role || "participant");
    const role = cfg.roles.includes(asked) ? asked : "participant";
    const isViewer = role === "viewer";

    const fundraisingUrl = cfg.fundraising && !isViewer
      ? cleanFundraisingUrl((req.body || {}).fundraisingUrl) : "";

    if (!cleanName) return bad(res, "name required");
    if (!validPin(pin)) return bad(res, "PIN must be 4 digits");
    if (!isViewer) {
      if (!validAgeBand(ageBand)) return bad(res, "bad ageBand");
      if (!goals.length) return bad(res, "pick at least one goal");
      if (!FITNESS.includes(fitness)) return bad(res, "bad fitness level");
    }

    /* age_band and goal are NOT NULL from the original schema, so a viewer
       still needs a value in them. These are never read for a viewer — nothing
       suggests a workout to someone who does not log one. */
    const band = isViewer ? "30-44" : ageBand;
    const goalList = isViewer ? ["general"] : goals;
    const fit = isViewer ? "occasional" : fitness;

    const id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      await sql`INSERT INTO users (id, name, emoji, age_band, goal, goals, fitness, note,
                                   pin_hash, role, fundraising_url, cheering)
                VALUES (${id}, ${cleanName}, ${String(emoji || "💪").slice(0, 8)},
                        ${band}, ${goalList[0]}, ${goalList.join(",")}, ${fit},
                        ${isViewer ? null : cleanNote(note)}, ${hashPin(pin)},
                        ${role}, ${fundraisingUrl || null},
                        ${cheering ? String(cheering).slice(0, 40) : null})`;
    } catch (e) {
      if (String(e).includes("users_name_key")) return res.status(409).json({ error: "name taken" });
      throw e;
    }
    const token = newToken();
    await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${id})`;
    return res.status(200).json({ id, token, role });
  }

  if (req.method === "PATCH") return patch(req, res);
  res.status(405).json({ error: "method" });
});

const patch = endpoint(async (req, res, userId) => {
  const cfg = challengeFromEnv();
  const { emoji, ageBand, fitness, note } = req.body || {};

  /* Your own fundraising page, and whether you want the evening reminder.
     Both are undefined-means-leave-alone, like everything else here. */
  const hasUrl = (req.body || {}).fundraisingUrl !== undefined;
  const url = hasUrl ? cleanFundraisingUrl(req.body.fundraisingUrl) : null;
  if (hasUrl && req.body.fundraisingUrl && !url) {
    return bad(res, "That doesn't look like a Movember or JustGiving page");
  }
  const hasNotify = (req.body || {}).notify !== undefined;
  const notify = hasNotify ? !!req.body.notify : null;
  const name = (req.body || {}).name === undefined
    ? null : String(req.body.name || "").trim().slice(0, 40);
  if (name !== null && !name) return bad(res, "name can't be empty");
  const hasGoals = (req.body || {}).goals !== undefined;
  const goals = hasGoals ? cleanGoals(req.body.goals) : null;

  if (ageBand && !validAgeBand(ageBand)) return bad(res, "bad ageBand");
  if (fitness && !FITNESS.includes(fitness)) return bad(res, "bad fitness level");
  if (hasGoals && !goals.length) return bad(res, "pick at least one goal");

  try {
    await sql`UPDATE users SET
              name     = COALESCE(${name}, name),
              emoji    = COALESCE(${emoji ? String(emoji).slice(0, 8) : null}, emoji),
              age_band = COALESCE(${ageBand || null}, age_band),
              fitness  = COALESCE(${fitness || null}, fitness),
              goals    = COALESCE(${goals ? goals.join(",") : null}, goals),
              goal     = COALESCE(${goals ? goals[0] : null}, goal),
              note     = COALESCE(${note === undefined ? null : cleanNote(note)}, note),
              fundraising_url = CASE WHEN ${hasUrl} THEN ${url || null} ELSE fundraising_url END,
              notify   = COALESCE(${notify}, notify)
            WHERE id = ${userId}`;
  } catch (e) {
    /* Names are how people find themselves on the "Who are you?" list, so two
       accounts must never share one. */
    if (String(e).includes("users_name_key")) {
      return res.status(409).json({ error: "Someone already has that name" });
    }
    throw e;
  }
  res.status(200).json({ ok: true, name: name || undefined });
}, { auth: true });

export { GOALS };
