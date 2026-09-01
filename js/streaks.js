/* Streak engine — pure functions over log[date][userId] = {done,...}.
   Ported from habit-tracker, simplified: fixed September window, daily schedule.
   PENDING = today with no entry yet (streak survives until day's end).
   `since` = the day this person joined; earlier days are NEUTRAL, not misses,
   so joining mid-month doesn't hand you a wall of red and a dead streak. */
import { addDays, SEPT_START, SEPT_END } from "./dates.js";

export const HIT = "hit", MISS = "miss", NEUTRAL = "neutral", PENDING = "pending";

export function dayResult(userId, log, ds, today, since = SEPT_START) {
  if (ds < SEPT_START || ds > SEPT_END || ds > today) return NEUTRAL;
  const e = log[ds] && log[ds][userId];
  if (e) return e.done ? HIT : MISS;          /* a backfilled day counts, however early */
  if (ds < since) return NEUTRAL;             /* hadn't joined yet, and nothing logged */
  return ds === today ? PENDING : MISS;
}

export function currentStreak(userId, log, today, since = SEPT_START) {
  let n = 0;
  const end = today > SEPT_END ? SEPT_END : today;
  for (let ds = end; ds >= SEPT_START; ds = addDays(ds, -1)) {
    const r = dayResult(userId, log, ds, today, since);
    if (r === HIT) n++;
    else if (r === MISS) break;
    /* NEUTRAL and PENDING pass through without breaking */
  }
  return n;
}

export function bestStreak(userId, log, today, since = SEPT_START) {
  let best = 0, run = 0;
  for (let ds = SEPT_START; ds <= SEPT_END; ds = addDays(ds, 1)) {
    const r = dayResult(userId, log, ds, today, since);
    if (r === HIT) { run++; if (run > best) best = run; }
    else if (r === MISS) run = 0;
  }
  return best;
}

export function totalHits(userId, log, today, since = SEPT_START) {
  let n = 0;
  for (let ds = SEPT_START; ds <= SEPT_END; ds = addDays(ds, 1)) {
    if (dayResult(userId, log, ds, today, since) === HIT) n++;
  }
  return n;
}
