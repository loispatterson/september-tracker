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
