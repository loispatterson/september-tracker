import Anthropic from "@anthropic-ai/sdk";
import { sql, endpoint } from "./_lib/db.js";
import { cleanGoals } from "./_lib/profile.js";

/* POST /api/suggest → three 30-minute workouts written for this person today.
   Returns 503 when no API key is configured; the client falls back to its
   built-in library, so the app works with or without this endpoint. */

const SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    workouts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          goal: { type: "string" },
          intensity: { type: "string", enum: ["low", "med", "high"] },
          desc: { type: "string" },
        },
        required: ["title", "goal", "intensity", "desc"],
        additionalProperties: false,
      },
    },
  },
  required: ["workouts"],
  additionalProperties: false,
};

const SYSTEM = `You suggest 30-minute workouts for a friendly September fitness challenge.

Write for one specific person using the profile you are given. Every suggestion
must fit in 30 minutes including warm-up, need no more equipment than the person
has said they have, and suit their fitness level honestly: someone starting out
should not be given advanced work, and someone very active should not be
patronised.

Give exactly three varied suggestions: do not offer three variations of the same
session. Where the person lists several goals, cover them across the three rather
than cramming every goal into each one. Respect anything they mention about
injuries, equipment or circumstances - if they mention a bad knee, no suggestion
should load that knee.

desc is two or three plain sentences telling them what to actually do, with sets,
reps or times. No preamble, no motivational filler, no markdown.

If they did something long or hard yesterday, make today deliberately easy -
gentle movement, mobility, a walk - and say briefly that it is a recovery day.

Stick to exercise. Do not give diet, weight-loss or medical advice, even if the
person's goal is losing weight - suggest movement that supports it instead.`;

function prettyMinutes(m) {
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h} hours`;
}

function profileLines(p, recent, dayNum, yesterday) {
  const lines = [
    `Age band: ${p.age_band || "unknown"}`,
    `Goals: ${(p.goals || p.goal || "general").split(",").join(", ")}`,
    `Current fitness: ${p.fitness || "unknown"}`,
    `Today is day ${dayNum} of a 30-day everyday-exercise challenge.`,
  ];
  if (p.note) lines.push(`In their own words: ${p.note}`);
  if (yesterday) {
    const bits = [prettyMinutes(yesterday.minutes)];
    if (yesterday.activity) bits.push(yesterday.activity);
    if (yesterday.distance_km) bits.push(`${Number(yesterday.distance_km)} km`);
    lines.push(`Yesterday they did: ${bits.join(", ")}.`);
  }
  lines.push(recent.length
    ? `Already done this month: ${recent.join(", ")}. Suggest something different where sensible.`
    : `Nothing logged yet this month.`);
  return lines.join("\n");
}

export default endpoint(async (req, res, userId) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "ai suggestions not configured" });
  }

  const rows = await sql`SELECT age_band, goal, goals, fitness, note FROM users WHERE id = ${userId}`;
  if (!rows.length) return res.status(404).json({ error: "no such person" });
  const p = rows[0];
  if (p.goals) p.goals = cleanGoals(p.goals).join(",");

  const done = await sql`SELECT activity, minutes, distance_km FROM entries
                         WHERE user_id = ${userId} AND kind = 'exercise' AND done
                         ORDER BY date DESC LIMIT 8`;
  const recent = [...new Set(done.map(r => r.activity).filter(Boolean))];
  const dayNum = Number(String(req.body?.date || "").slice(8)) || 1;

  /* Yesterday specifically: a long session there should make today easy. */
  const date = String(req.body?.date || "");
  const prev = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? (await sql`SELECT activity, minutes, distance_km FROM entries
                 WHERE user_id = ${userId} AND kind = 'exercise' AND done
                   AND date = to_char(${date}::date - 1, 'YYYY-MM-DD')`)[0]
    : null;
  const yesterday = prev ? { ...prev, minutes: Number(prev.minutes) || 30 } : null;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    system: SYSTEM,
    /* Short, scoped generation: low effort keeps it fast and cheap, which
       matters because a person is waiting on the Today screen. */
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SUGGESTION_SCHEMA },
    },
    messages: [{ role: "user", content: profileLines(p, recent, dayNum, yesterday) }],
  });

  /* Safety classifiers can decline; check before reading content. */
  if (message.stop_reason === "refusal") {
    return res.status(422).json({ error: "couldn't generate suggestions" });
  }

  const text = message.content.find(b => b.type === "text")?.text || "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { return res.status(502).json({ error: "bad AI response" }); }

  const workouts = (parsed.workouts || []).slice(0, 3).map((w, i) => ({
    id: `ai-${dayNum}-${i}`,
    title: String(w.title || "").slice(0, 80),
    goal: String(w.goal || "").slice(0, 30),
    intensity: ["low", "med", "high"].includes(w.intensity) ? w.intensity : "med",
    desc: String(w.desc || "").slice(0, 500),
  })).filter(w => w.title && w.desc);

  if (workouts.length < 3) return res.status(502).json({ error: "incomplete AI response" });
  res.status(200).json({ workouts, source: "ai" });
}, { auth: true });
