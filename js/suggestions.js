import { WORKOUTS } from "./data/workouts.js";

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

/* Pure rule engine: filter by goal + age band, rotate daily, demote yesterday's activity.
   Always returns 3 suggestions (pads from the full library if filters run dry). */
export function pickWorkouts(profile, dateStr, recentActivities, library = WORKOUTS) {
  const recent = (recentActivities || []).map(a => String(a).toLowerCase());
  let pool = library.filter(w =>
    (w.goal === profile.goal || w.goal === "general") &&
    w.ageBands.includes(profile.ageBand)
  );
  if (pool.length < 3) {
    const extras = library.filter(w => w.ageBands.includes(profile.ageBand) && !pool.includes(w));
    pool = pool.concat(extras);
  }
  const offset = hashStr(dateStr + "|" + (profile.id || "")) % Math.max(pool.length, 1);
  const rotated = pool.slice(offset).concat(pool.slice(0, offset));
  /* stable partition: anything resembling yesterday's activity goes to the back */
  const fresh = [], stale = [];
  for (const w of rotated) {
    (recent.some(a => w.title.toLowerCase().includes(a)) ? stale : fresh).push(w);
  }
  return fresh.concat(stale).slice(0, 3);
}

/* ---- PHASE-2 SEAM ----
   The UI only ever calls this. To upgrade to AI suggestions, change the body to
   fetch('/api/suggest', ...) (serverless fn calling the Anthropic API) with the
   same return shape, keeping pickWorkouts() as the offline/error fallback. */
export async function getSuggestions(profile, dateStr, recentActivities) {
  return pickWorkouts(profile, dateStr, recentActivities);
}
