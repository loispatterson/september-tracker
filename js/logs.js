/* Who still counts as part of the board.

   Someone who logged twice in the first week and never came back makes the
   board read as a graveyard, so they drop out after three weeks of silence.
   Nothing is deleted — their entries and grid are intact, and `hidden` is
   returned so the view can offer them back rather than quietly losing people.

   Two people are never hidden: yourself, however long you have been away,
   because a board that has dropped you is confusing rather than tidy; and
   anyone who joined inside the window, who has not been away at all. */
export const STALE_AFTER_DAYS = 21;

export function activeUsers(users, today, meId, showAll = false, days = STALE_AFTER_DAYS) {
  const cut = new Date(today + "T00:00:00");
  cut.setDate(cut.getDate() - days);
  const cutoff = cut.toISOString().slice(0, 10);
  const all = users || [];
  if (showAll) return { shown: all, hidden: [] };
  const shown = [], hidden = [];
  for (const u of all) {
    const seen = u.last_active || u.joined || "";
    (u.id === meId || seen >= cutoff ? shown : hidden).push(u);
  }
  return { shown, hidden };
}

export const DEFAULT_ACTIVITIES =
  ["Run", "Walk", "Gym", "Cycle", "Swim", "Yoga", "Class", "Other"];

/* The chip row, ordered by what this person actually does.

   Counts come from the server across every month, not just the one on screen,
   so on the 1st your habits carry over instead of the list resetting to the
   stock order. Anything logged through "Other…" earns its own chip once it has
   been used, which is the point: someone who does bouldering should not have
   to retype it every time.

   Defaults never disappear — they fall in behind what you use, so the list
   stays a menu rather than a history. "Other" is pinned last. */
export function orderedActivities(counts, defaults = DEFAULT_ACTIVITIES, limit = 10) {
  const used = (counts || [])
    .map(c => ({ name: String(c.activity).trim(), n: Number(c.n) || 0 }))
    .filter(c => c.name && c.name.toLowerCase() !== "other");
  const seen = new Map();
  for (const c of used) {                       /* fold case-variant duplicates */
    const k = c.name.toLowerCase();
    const prev = seen.get(k);
    if (!prev || c.n > prev.n) seen.set(k, c);
    else prev.n += c.n;
  }
  const mine = [...seen.values()].sort((a, b) => b.n - a.n).map(c => c.name);
  const rest = defaults.filter(a =>
    a !== "Other" && !seen.has(a.toLowerCase()));
  return [...mine, ...rest].slice(0, limit).concat("Other");
}

/* Turn the board's flat entries array into the per-date lookups the views and
   the streak engine use. Pure, so it can be tested without a browser. */

export function buildLogs(entries) {
  const exLog = {}, funLog = {}, photoLog = {};
  for (const e of entries || []) {
    const log = e.kind === "fun" ? funLog : exLog;
    (log[e.date] || (log[e.date] = {}))[e.user_id] = e;

    /* A day with no photo must have NO row here, not a {done:false} one:
       streaks.js treats an explicit false as a real miss, which would turn
       "today, photo not taken yet" from PENDING into MISS and reset everyone's
       photo streak every morning. */
    if (e.kind === "fun" && e.photo_id) {
      (photoLog[e.date] || (photoLog[e.date] = {}))[e.user_id] = { done: true };
    }
  }
  return { exLog, funLog, photoLog };
}

export const DEFAULT_MINUTES = 30;

/* Entries logged before durations existed are the challenge's 30 minutes. */
export function minutesOf(entry) {
  const m = Number(entry && entry.minutes);
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_MINUTES;
}

export function prettyMinutes(mins) {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/* "45 min · Run · 6.2 km" — whatever of that we actually know. */
export function describeEntry(entry) {
  const bits = [prettyMinutes(minutesOf(entry))];
  if (entry.activity) bits.push(entry.activity);
  if (entry.distance_km != null && Number(entry.distance_km) > 0) {
    bits.push(`${Number(entry.distance_km)} km`);
  }
  return bits.join(" · ");
}

const FEELING_LABEL = { easy: "easy", good: "just right", hard: "tough" };
export const feelingLabel = (f) => FEELING_LABEL[f] || "";

/* Total exercise time someone has logged, in minutes. */
export function totalMinutes(entries, userId) {
  return (entries || []).reduce((n, e) =>
    e.user_id === userId && e.kind === "exercise" && e.done ? n + minutesOf(e) : n, 0);
}
