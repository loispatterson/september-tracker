import { FUN_PROMPTS } from "./data/fun-prompts.js";
import { hashStr } from "./suggestions.js";
import { septDayNum } from "./dates.js";

/* Pool = curated prompts + user-added ideas from the DB. */
export function funPool(dbIdeas) {
  return FUN_PROMPTS.concat((dbIdeas || []).map(i => i.text));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Each person gets their own shuffled deck of the pool, dealt one per day.
   A deck (rather than hashing each date independently) guarantees no repeat
   until the pool is exhausted — no "same fun idea two days running". */
export function funDeck(userId, dbIdeas) {
  const pool = funPool(dbIdeas);
  const rand = mulberry32(hashStr("deck|" + userId));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/* Today's idea = the day's card from your deck. swapOffset (ephemeral UI state)
   deals the next card. The chosen text is stored in the entry, so later pool
   changes never rewrite history. */
export function funPromptFor(userId, dateStr, dbIdeas, swapOffset = 0) {
  const deck = funDeck(userId, dbIdeas);
  if (!deck.length) return "";
  const day = (septDayNum(dateStr) || 1) - 1;
  return deck[(day + swapOffset) % deck.length];
}
