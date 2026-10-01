/* Streak engine — pure functions over log[date][userId] = {done,...}.
   Ported from habit-tracker, simplified: the current calendar month, daily
   schedule. PENDING = today with no entry yet (streak survives until day's
   end). `since` = the day this person joined; earlier days are NEUTRAL, not
   misses, so joining mid-month doesn't hand you a wall of red and a dead
   streak.

   Streaks are bounded by the month, which is what makes them restart on the
   1st: nothing is reset, the window simply moves. Pass `ref` (any date in the
   month) to score a month other than the one containing today. */
import { addDays, monthStart, monthEnd, todayStr } from "./dates.js";

export const HIT = "hit", MISS = "miss", NEUTRAL = "neutral", PENDING = "pending";

export function dayResult(userId, log, ds, today, since = null, ref = null) {
  const start = monthStart(ref || today || todayStr());
  const end = monthEnd(ref || today || todayStr());
  const joined = since || start;
  if (ds < start || ds > end || ds > today) return NEUTRAL;
  const e = log[ds] && log[ds][userId];
  if (e) return e.done ? HIT : MISS;          /* a backfilled day counts, however early */
  if (ds < joined) return NEUTRAL;            /* hadn't joined yet, and nothing logged */
  return ds === today ? PENDING : MISS;
}

export function currentStreak(userId, log, today, since = null, ref = null) {
  const start = monthStart(ref || today);
  const monthLast = monthEnd(ref || today);
  let n = 0;
  const end = today > monthLast ? monthLast : today;
  for (let ds = end; ds >= start; ds = addDays(ds, -1)) {
    const r = dayResult(userId, log, ds, today, since, ref);
    if (r === HIT) n++;
    else if (r === MISS) break;
    /* NEUTRAL and PENDING pass through without breaking */
  }
  return n;
}

export function bestStreak(userId, log, today, since = null, ref = null) {
  const start = monthStart(ref || today), end = monthEnd(ref || today);
  let best = 0, run = 0;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    const r = dayResult(userId, log, ds, today, since, ref);
    if (r === HIT) { run++; if (run > best) best = run; }
    else if (r === MISS) run = 0;
  }
  return best;
}

export function totalHits(userId, log, today, since = null, ref = null) {
  const start = monthStart(ref || today), end = monthEnd(ref || today);
  let n = 0;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    if (dayResult(userId, log, ds, today, since, ref) === HIT) n++;
  }
  return n;
}
