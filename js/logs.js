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
