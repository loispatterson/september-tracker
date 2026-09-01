import { WORKOUTS } from "./data/workouts.js";
import { expandAgeBand } from "./profile.js";
import { api, isAuthError } from "./api.js";

/* Deterministic string hash (FNV-1a + avalanche finalizer) for daily rotation.
   The finalizer matters: a plain multiply-and-add hash keeps structure — with a
   multiplier sharing a factor with the pool size, consecutive dates collide and
   every day would suggest the same three workouts. */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/* How hard a session may be for someone at each fitness level. */
const ALLOWED_INTENSITY = {
  starting: ["low", "med"],
  occasional: ["low", "med"],
  regular: ["low", "med", "high"],
  veryactive: ["med", "high"],
};

/* Pure rule engine, and the fallback whenever the AI endpoint is unavailable.
   Scores by how many of the person's goals a workout serves, filtered to their
   age band and a sensible intensity for their fitness level. */
export function pickWorkouts(profile, dateStr, recentActivities, library = WORKOUTS) {
  const bands = expandAgeBand(profile.ageBand);
  const goals = (profile.goals && profile.goals.length ? profile.goals : ["general"]);
  const intensities = ALLOWED_INTENSITY[profile.fitness] || ["low", "med", "high"];
  const recent = (recentActivities || []).map(a => String(a).toLowerCase());

  const fits = w => w.ageBands.some(b => bands.includes(b));
  const score = w => goals.reduce((n, g) => n + (w.goals.includes(g) ? 1 : 0), 0);

  let pool = library.filter(w => fits(w) && score(w) > 0 && intensities.includes(w.intensity));
  /* Widen rather than return nothing: intensity first, then goals. */
  if (pool.length < 3) pool = library.filter(w => fits(w) && score(w) > 0);
  if (pool.length < 3) pool = library.filter(fits);
  if (pool.length < 3) pool = library.slice();

  /* Weight by goal match rather than sorting by it: a workout serving two of
     your goals gets two tickets, one goal gets one. Rotating this weighted
     list means better matches come up more often while the day still decides
     which you actually see — sorting by score instead pinned the same top
     three to every day, and gave identical lists to different people. */
  const tickets = [];
  for (const w of pool) for (let n = 0; n < Math.max(score(w), 1); n++) tickets.push(w);

  const offset = hashStr(dateStr + "|" + (profile.id || "")) % Math.max(tickets.length, 1);
  const rotated = tickets.slice(offset).concat(tickets.slice(0, offset));

  const fresh = [], stale = [], seen = new Set();
  for (const w of rotated) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    (recent.some(a => w.title.toLowerCase().includes(a)) ? stale : fresh).push(w);
  }
  return fresh.concat(stale).slice(0, 3);
}

/* The only function the UI calls. Asks Claude for something written for this
   person; falls back to the built-in library if that is unavailable, fails, or
   is simply not configured — so suggestions always appear. */
let aiConfigured = true;   /* until the server tells us otherwise */

export async function getSuggestions(profile, dateStr, recentActivities) {
  if (aiConfigured) {
    try {
      const { workouts } = await api.suggest(dateStr);
      if (workouts && workouts.length === 3) return workouts;
    } catch (e) {
      if (isAuthError(e)) throw e;      /* signed out: let the caller handle it */
      /* 503 means no API key is set up: a settled fact for this page load, so
         stop asking rather than failing a request on every render. */
      if (e.status === 503) aiConfigured = false;
      console.info("Using the built-in workout library:", e.message);
    }
  }
  return pickWorkouts(profile, dateStr, recentActivities);
}
