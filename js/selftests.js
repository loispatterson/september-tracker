/* Self-tests — run in devtools:
     import("/js/selftests.js").then(m => m.runSelfTests())
   Pure logic only; no network, no DOM. */
import { addDays, prettyDate, septDates, septDayNum, SEPT_START, SEPT_END } from "./dates.js";
import { currentStreak, bestStreak, totalHits, dayResult, HIT, MISS, PENDING, NEUTRAL } from "./streaks.js";
import { pickWorkouts, hashStr } from "./suggestions.js";
import { WORKOUTS } from "./data/workouts.js";
import { funPromptFor, funPool } from "./fun.js";

export function runSelfTests() {
  let pass = 0, fail = 0;
  const check = (label, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.error("FAIL:", label, "— got", got, "want", want); }
  };

  /* ---- dates ---- */
  check("addDays forward", addDays("2026-09-01", 5), "2026-09-06");
  check("addDays back over month edge", addDays("2026-09-01", -1), "2026-08-31");
  check("addDays month end", addDays("2026-09-30", 1), "2026-10-01");
  check("prettyDate", prettyDate("2026-09-01"), "Tue 1 Sep");
  check("septDates length", septDates().length, 30);
  check("septDates first/last", [septDates()[0], septDates()[29]], [SEPT_START, SEPT_END]);
  check("septDayNum inside", septDayNum("2026-09-14"), 14);
  check("septDayNum outside", septDayNum("2026-08-31"), null);

  /* ---- streaks: log[date][userId] ---- */
  const U = "u_1", V = "u_2";
  const log = {
    "2026-09-01": { [U]: { done: true }, [V]: { done: true } },
    "2026-09-02": { [U]: { done: true } },                       /* V missed */
    "2026-09-03": { [U]: { done: false }, [V]: { done: true } }, /* U logged a miss */
    "2026-09-04": { [U]: { done: true }, [V]: { done: true } },
    "2026-09-05": { [V]: { done: true } },                       /* U unlogged = today */
  };
  const today = "2026-09-05";
  check("dayResult hit", dayResult(U, log, "2026-09-01", today), HIT);
  check("dayResult explicit not-done is miss", dayResult(U, log, "2026-09-03", today), MISS);
  check("dayResult unlogged past day is miss", dayResult(V, log, "2026-09-02", today), MISS);
  check("dayResult today unlogged is pending", dayResult(U, log, today, today), PENDING);
  check("dayResult future is neutral", dayResult(U, log, "2026-09-10", today), NEUTRAL);
  check("dayResult outside September", dayResult(U, log, "2026-08-31", today), NEUTRAL);
  check("currentStreak survives pending today", currentStreak(U, log, today), 1);
  check("currentStreak unbroken run", currentStreak(V, log, today), 3);
  check("bestStreak U", bestStreak(U, log, today), 2);
  check("totalHits U", totalHits(U, log, today), 3);
  check("totalHits V", totalHits(V, log, today), 4);
  check("empty log → zero streak", currentStreak("nobody", log, today), 0);

  /* ---- joining mid-month: earlier days are neutral, not misses ---- */
  const W = "u_3";
  const lateLog = { "2026-09-05": { [W]: { done: true } } };
  const joined = "2026-09-04";
  check("pre-join day is neutral", dayResult(W, lateLog, "2026-09-01", today, joined), NEUTRAL);
  check("pre-join day is a miss without the join date", dayResult(W, lateLog, "2026-09-01", today), MISS);
  check("post-join unlogged day is still a miss",
    dayResult(W, lateLog, "2026-09-04", today, joined), MISS);
  check("backfilled pre-join day still counts",
    dayResult(W, { "2026-09-02": { [W]: { done: true } } }, "2026-09-02", today, joined), HIT);
  check("joiner's streak isn't killed by days before them",
    currentStreak(W, lateLog, today, joined), 1);
  check("joiner's total ignores pre-join days", totalHits(W, lateLog, today, joined), 1);

  /* ---- suggestions ---- */
  const prof = { id: U, ageBand: "60plus", goal: "strength" };
  const picks = pickWorkouts(prof, "2026-09-01", [], WORKOUTS);
  check("always 3 suggestions", picks.length, 3);
  check("respects age band", picks.every(w => w.ageBands.includes("60plus")), true);
  check("respects goal (or general)", picks.every(w => w.goal === "strength" || w.goal === "general"), true);
  check("deterministic for same date",
    pickWorkouts(prof, "2026-09-01", [], WORKOUTS).map(w => w.id), picks.map(w => w.id));
  /* Offsets are hash-derived, so adjacent days may occasionally coincide;
     what matters is plenty of variety across the month. */
  const sets = new Set(septDates().map(ds => pickWorkouts(prof, ds, [], WORKOUTS).map(w => w.id).join(",")));
  check("varies across the month (smallest pool)", sets.size >= 5, true);
  const young = { id: U, ageBand: "under30", goal: "cardio" };
  check("high intensity available to under30",
    WORKOUTS.some(w => w.intensity === "high" && w.ageBands.includes("under30")), true);
  check("no high intensity for 60plus",
    WORKOUTS.filter(w => w.ageBands.includes("60plus")).every(w => w.intensity !== "high"), true);
  const demoted = pickWorkouts(young, "2026-09-03", ["steady 30-min run"], WORKOUTS);
  check("demotes yesterday's activity",
    demoted[0].title.toLowerCase() !== "steady 30-min run", true);
  check("every goal has picks", ["strength", "cardio", "mobility", "general"].every(g =>
    pickWorkouts({ id: U, ageBand: "30-44", goal: g }, "2026-09-07", [], WORKOUTS).length === 3), true);

  /* ---- fun prompts ---- */
  check("pool includes curated + db", funPool([{ text: "x" }]).length, 31);
  const f1 = funPromptFor(U, "2026-09-01", []);
  check("fun prompt deterministic", funPromptFor(U, "2026-09-01", []), f1);
  check("fun prompt differs per user", funPromptFor(V, "2026-09-01", []) !== f1, true);
  check("swap changes the idea", funPromptFor(U, "2026-09-01", [], 1) !== f1, true);
  check("swap wraps around", funPromptFor(U, "2026-09-01", [], 30), f1);
  /* the deck is the point: 30 days, 30 different ideas, none repeated */
  const month = septDates().map(ds => funPromptFor(U, ds, []));
  check("30 distinct ideas across September", new Set(month).size, 30);
  check("deck is a permutation of the pool",
    month.slice().sort().join("|"), funPool([]).slice().sort().join("|"));
  check("user-added ideas join the deck",
    funPromptFor(U, "2026-09-01", [{ text: "z" }]) !== undefined, true);
  check("decks differ between users",
    septDates().map(ds => funPromptFor(V, ds, [])).join("|") !== month.join("|"), true);

  console.log(`${pass} passed, ${fail} failed`);
  return { pass, fail };
}
