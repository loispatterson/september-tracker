/* Shared profile vocabulary. Imported by the API, the dev server and the
   tests so client and server can't disagree about what a valid profile is. */

/* Five-year bands: specific enough to tune a workout, without anyone's exact
   age being stored. The four wider bands are what the app shipped with and
   stay valid so existing accounts keep working. */
export const AGE_BANDS = [
  "under25", "25-29", "30-34", "35-39", "40-44",
  "45-49", "50-54", "55-59", "60-64", "65plus",
];
export const LEGACY_AGE_BANDS = ["under30", "30-44", "45-59", "60plus"];

export const GOALS = ["weightloss", "strength", "cardio", "mobility", "general"];
export const FITNESS = ["starting", "occasional", "regular", "veryactive"];
export const MAX_NOTE = 400;

export function validAgeBand(b) {
  return AGE_BANDS.includes(b) || LEGACY_AGE_BANDS.includes(b);
}

/* Goals arrive as an array and are stored comma-separated. Deduped and
   order-normalised so the same set is always the same string. */
export function cleanGoals(goals) {
  const list = Array.isArray(goals) ? goals : (goals ? String(goals).split(",") : []);
  const kept = [...new Set(list.map(g => String(g).trim()).filter(g => GOALS.includes(g)))];
  return kept.sort((a, b) => GOALS.indexOf(a) - GOALS.indexOf(b));
}

export function cleanNote(note) {
  return String(note || "").trim().slice(0, MAX_NOTE);
}

/* Widen a legacy band to the new bands it covers, so old accounts still get
   age-appropriate suggestions before their owner re-picks. */
export function expandAgeBand(band) {
  switch (band) {
    case "under30": return ["under25", "25-29"];
    case "30-44": return ["30-34", "35-39", "40-44"];
    case "45-59": return ["45-49", "50-54", "55-59"];
    case "60plus": return ["60-64", "65plus"];
    default: return AGE_BANDS.includes(band) ? [band] : [];
  }
}

/* How a session felt. Three levels is enough to steer the next day without
   turning logging into a questionnaire. */
export const FEELINGS = ["easy", "good", "hard"];
export const validFeeling = (f) => FEELINGS.includes(f);
