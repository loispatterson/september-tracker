/* Self-tests — run in devtools:
     import("/js/selftests.js").then(m => m.runSelfTests())
   Pure logic only; no network, no DOM. */
import { addDays, prettyDate, septDates, septDayNum, SEPT_START, SEPT_END } from "./dates.js";
import { currentStreak, bestStreak, totalHits, dayResult, HIT, MISS, PENDING, NEUTRAL } from "./streaks.js";
import { pickWorkouts, hashStr, needsEasyDay } from "./suggestions.js";
import { expandAgeBand } from "./profile.js";
import { WORKOUTS } from "./data/workouts.js";
import { funPromptFor, funPool } from "./fun.js";
import { buildLogs, minutesOf, prettyMinutes, describeEntry, totalMinutes, feelingLabel } from "./logs.js";
import { readExifOrientation, orientationTransform, fitDimensions, galleryItems } from "./imageutil.js";

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
  const prof = { id: U, ageBand: "45-49", goals: ["weightloss", "strength"], fitness: "occasional" };
  const picks = pickWorkouts(prof, "2026-09-01", [], WORKOUTS);
  check("always 3 suggestions", picks.length, 3);
  check("respects age band", picks.every(w => w.ageBands.includes("45-49")), true);
  check("serves at least one stated goal",
    picks.every(w => w.goals.some(g => prof.goals.includes(g))), true);
  check("respects fitness level (no high intensity for occasional)",
    picks.every(w => w.intensity !== "high"), true);
  check("deterministic for same date",
    pickWorkouts(prof, "2026-09-01", [], WORKOUTS).map(w => w.id), picks.map(w => w.id));
  const sets = new Set(septDates().map(ds => pickWorkouts(prof, ds, [], WORKOUTS).map(w => w.id).join(",")));
  check("varies across the month", sets.size >= 10, true);
  /* Ranking strictly by goal match pinned the same top three to every day and
     handed identical lists to different people; weighting instead fixed it. */
  check("consecutive days usually differ",
    septDates().slice(0, 10).filter((ds, i, a) =>
      i > 0 && pickWorkouts(prof, ds, [], WORKOUTS).map(w => w.id).join() ===
               pickWorkouts(prof, a[i - 1], [], WORKOUTS).map(w => w.id).join()).length <= 3, true);
  check("two people with the same profile get different picks",
    pickWorkouts({ ...prof, id: "u_twin" }, "2026-09-03", [], WORKOUTS).map(w => w.id).join() !==
    pickWorkouts(prof, "2026-09-03", [], WORKOUTS).map(w => w.id).join(), true);
  check("every pick all month still serves a stated goal",
    septDates().every(ds => pickWorkouts(prof, ds, [], WORKOUTS)
      .every(w => w.goals.some(g => prof.goals.includes(g)))), true);

  /* multi-goal: a workout serving both goals should outrank one serving either */
  const both = pickWorkouts({ ...prof, fitness: "regular" }, "2026-09-02", [], WORKOUTS);
  const scoreOf = w => w.goals.filter(g => prof.goals.includes(g)).length;
  check("best goal match comes first", scoreOf(both[0]) >= scoreOf(both[2]), true);

  check("weight-loss goal has real options",
    WORKOUTS.filter(w => w.goals.includes("weightloss")).length >= 8, true);
  check("very active people are not offered only gentle work",
    pickWorkouts({ id: U, ageBand: "30-34", goals: ["cardio"], fitness: "veryactive" },
      "2026-09-03", [], WORKOUTS).every(w => w.intensity !== "low"), true);
  check("beginners are never given high intensity",
    pickWorkouts({ id: U, ageBand: "30-34", goals: ["strength"], fitness: "starting" },
      "2026-09-03", [], WORKOUTS).every(w => w.intensity !== "high"), true);
  check("older bands never get high intensity in the library",
    WORKOUTS.filter(w => w.ageBands.includes("65plus")).every(w => w.intensity !== "high"), true);
  check("every goal yields 3 picks", ["weightloss", "strength", "cardio", "mobility", "general"].every(g =>
    pickWorkouts({ id: U, ageBand: "40-44", goals: [g], fitness: "regular" }, "2026-09-07", [], WORKOUTS).length === 3), true);
  const demoted = pickWorkouts({ id: U, ageBand: "30-34", goals: ["cardio"], fitness: "regular" },
    "2026-09-03", ["steady 30-min run"], WORKOUTS);
  check("demotes what you just did", demoted[0].title.toLowerCase() !== "steady 30-min run", true);

  /* legacy accounts keep working until their owner re-picks a finer band */
  check("legacy band widens", expandAgeBand("45-59"), ["45-49", "50-54", "55-59"]);
  check("new band passes through", expandAgeBand("50-54"), ["50-54"]);
  check("unknown band is empty", expandAgeBand("nope"), []);
  check("legacy profile still gets suggestions",
    pickWorkouts({ id: U, ageBand: "45-59", goals: ["strength"], fitness: "regular" },
      "2026-09-04", [], WORKOUTS).length, 3);
  check("a profile with no goals still gets suggestions",
    pickWorkouts({ id: U, ageBand: "40-44", goals: [], fitness: "regular" },
      "2026-09-05", [], WORKOUTS).length, 3);

  /* ---- duration and distance ---- */
  check("missing duration means the challenge's 30", minutesOf({ done: true }), 30);
  check("zero is not a duration", minutesOf({ minutes: 0 }), 30);
  check("a real duration is kept", minutesOf({ minutes: 240 }), 240);
  check("minutes under an hour", prettyMinutes(45), "45 min");
  check("exactly an hour", prettyMinutes(60), "1h");
  check("hours and minutes", prettyMinutes(255), "4h 15m");
  check("describes time, activity and distance",
    describeEntry({ minutes: 45, activity: "Run", distance_km: 6.2 }), "45 min · Run · 6.2 km");
  check("describes what it has", describeEntry({ activity: "Gym" }), "30 min · Gym");
  check("free-text activity survives",
    describeEntry({ minutes: 240, activity: "Hike up Le Brévent" }), "4h · Hike up Le Brévent");
  check("no distance, no km", describeEntry({ minutes: 30, activity: "Yoga", distance_km: 0 }), "30 min · Yoga");
  const timeEntries = [
    { user_id: "u_1", kind: "exercise", done: true, minutes: 240 },
    { user_id: "u_1", kind: "exercise", done: true },              /* legacy: 30 */
    { user_id: "u_1", kind: "fun", done: true, minutes: 999 },     /* not exercise */
    { user_id: "u_2", kind: "exercise", done: true, minutes: 60 },
  ];
  check("monthly total counts only your own exercise", totalMinutes(timeEntries, "u_1"), 270);
  check("total for someone with nothing", totalMinutes(timeEntries, "u_9"), 0);

  /* ---- how it felt ---- */
  check("feeling labels", [feelingLabel("easy"), feelingLabel("good"), feelingLabel("hard")],
    ["easy", "just right", "tough"]);
  check("no feeling, no label", feelingLabel(null), "");
  check("unknown feeling, no label", feelingLabel("terrible"), "");

  /* ---- an easy day after a long or tough one ---- */
  check("90 minutes triggers an easy day", [needsEasyDay(89), needsEasyDay(90), needsEasyDay(240)],
    [false, true, true]);
  check("no session yesterday is not an easy day", needsEasyDay(0), false);
  check("a short but tough session also earns an easy day", needsEasyDay(30, "hard"), true);
  check("a short session that felt fine does not", needsEasyDay(30, "good"), false);
  check("an easy short session does not", needsEasyDay(30, "easy"), false);
  check("tough yesterday keeps today gentle",
    pickWorkouts({ id: U, ageBand: "30-34", goals: ["cardio"], fitness: "veryactive" },
      "2026-09-11", [], WORKOUTS, { yesterdayMinutes: 30, yesterdayFeeling: "hard" })
      .every(w => w.intensity !== "high"), true);
  const active = { id: U, ageBand: "30-34", goals: ["cardio"], fitness: "veryactive" };
  check("a 4-hour hike makes today gentle",
    pickWorkouts(active, "2026-09-10", [], WORKOUTS, { yesterdayMinutes: 240 })
      .every(w => w.intensity !== "high"), true);
  check("a normal day is not forced gentle",
    pickWorkouts(active, "2026-09-10", [], WORKOUTS, { yesterdayMinutes: 45 })
      .some(w => w.intensity === "high"), true);
  check("an easy day still returns 3",
    pickWorkouts({ id: U, ageBand: "65plus", goals: ["strength"], fitness: "starting" },
      "2026-09-10", [], WORKOUTS, { yesterdayMinutes: 300 }).length, 3);

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

  /* ---- buildLogs + the photo streak ---- */
  const P = "u_p";
  const photoEntries = [
    { user_id: P, date: "2026-09-01", kind: "fun", done: true, photo_id: "p1" },
    { user_id: P, date: "2026-09-02", kind: "fun", done: true, photo_id: "p2" },
    { user_id: P, date: "2026-09-03", kind: "fun", done: true, photo_id: null },  /* fun, no photo */
    { user_id: P, date: "2026-09-04", kind: "fun", done: true, photo_id: "p4" },
    { user_id: P, date: "2026-09-05", kind: "fun", done: true, photo_id: null },  /* today, not yet */
    { user_id: P, date: "2026-09-02", kind: "exercise", done: true, photo_id: "ignored" },
  ];
  const L = buildLogs(photoEntries);
  const pToday = "2026-09-05";
  check("buildLogs splits exercise from fun", Object.keys(L.exLog), ["2026-09-02"]);
  check("buildLogs keeps all fun days", Object.keys(L.funLog).length, 5);
  check("photoLog only has days with a photo", Object.keys(L.photoLog), ["2026-09-01", "2026-09-02", "2026-09-04"]);
  check("photoLog rows are {done:true}", L.photoLog["2026-09-01"][P], { done: true });
  check("a photo_id on an exercise entry is ignored", L.photoLog["2026-09-02"] && Object.keys(L.photoLog["2026-09-02"]), [P]);
  check("fun-without-photo produces no row", L.photoLog["2026-09-03"], undefined);
  check("photo day is a hit", dayResult(P, L.photoLog, "2026-09-01", pToday), HIT);
  check("fun without a photo breaks the photo streak", dayResult(P, L.photoLog, "2026-09-03", pToday), MISS);
  /* the invariant that would otherwise zero everyone's streak each morning */
  check("today without a photo is pending, not a miss", dayResult(P, L.photoLog, pToday, pToday), PENDING);
  check("photo streak survives an unphotographed today", currentStreak(P, L.photoLog, pToday), 1);
  check("photo best streak", bestStreak(P, L.photoLog, pToday), 2);
  check("photo total", totalHits(P, L.photoLog, pToday), 3);
  check("join clamp applies to photos too",
    dayResult(P, L.photoLog, "2026-09-03", pToday, "2026-09-04"), NEUTRAL);
  check("buildLogs handles no entries", buildLogs([]), { exLog: {}, funLog: {}, photoLog: {} });

  /* ---- EXIF orientation ---- */
  const jpegWithOrientation = (o, little) => {
    const head = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const bo = little ? [0x49, 0x49] : [0x4d, 0x4d];
    const u16 = (n) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
    const u32 = (n) => (little ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
                               : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
    return new Uint8Array([
      ...head, ...bo, ...u16(0x2a), ...u32(8),
      ...u16(1),                                    /* one IFD entry */
      ...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0,
    ]);
  };
  for (const o of [1, 3, 6, 8]) {
    check(`exif orientation ${o} little-endian`, readExifOrientation(jpegWithOrientation(o, true)), o);
    check(`exif orientation ${o} big-endian`, readExifOrientation(jpegWithOrientation(o, false)), o);
  }
  check("orientation 0 is out of range", readExifOrientation(jpegWithOrientation(0, true)), 1);
  check("orientation 9 is out of range", readExifOrientation(jpegWithOrientation(9, true)), 1);
  check("not a jpeg", readExifOrientation(new Uint8Array([1, 2, 3, 4])), 1);
  check("empty input", readExifOrientation(new Uint8Array([])), 1);
  check("null input", readExifOrientation(null), 1);
  check("truncated mid-IFD doesn't throw", readExifOrientation(jpegWithOrientation(6, true).slice(0, 26)), 1);
  check("jpeg with no exif", readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1);

  /* ---- orientationTransform: the matrix must map the drawn rect onto the output box ---- */
  for (let o = 1; o <= 8; o++) {
    const { m, drawW, drawH } = orientationTransform(o, 100, 60);
    const [a, b2, c, d, e, f] = m;
    const corners = [[0, 0], [drawW, 0], [drawW, drawH], [0, drawH]]
      .map(([x, y]) => [Math.round(a * x + c * y + e), Math.round(b2 * x + d * y + f)]);
    const got = corners.map(p => p.join(",")).sort().join(" ");
    const want = [[0, 0], [100, 0], [100, 60], [0, 60]].map(p => p.join(",")).sort().join(" ");
    check(`orientation ${o} maps onto the output box`, got, want);
  }
  check("orientations 5-8 swap the draw rect", orientationTransform(6, 100, 60).drawW, 60);
  check("orientations 1-4 don't swap", orientationTransform(3, 100, 60).drawW, 100);

  /* ---- fitDimensions ---- */
  check("landscape downscale", fitDimensions(4032, 3024, 1200), { w: 1200, h: 900 });
  check("portrait downscale", fitDimensions(3024, 4032, 1200), { w: 900, h: 1200 });
  check("never upscales", fitDimensions(800, 600, 1200), { w: 800, h: 600 });
  check("square", fitDimensions(2000, 2000, 1200), { w: 1200, h: 1200 });
  check("zero guard", fitDimensions(0, 500, 1200), { w: 0, h: 0 });

  /* ---- galleryItems ---- */
  const gUsers = [{ id: "u1", name: "Ana", emoji: "🐙" }, { id: "u2", name: "Bo", emoji: "🦊" }];
  const gEntries = [
    { user_id: "u1", date: "2026-09-01", kind: "fun", done: true, photo_id: "a", activity: "Baked" },
    { user_id: "u2", date: "2026-09-02", kind: "fun", done: true, photo_id: "b", activity: "" },
    { user_id: "u1", date: "2026-09-02", kind: "fun", done: true, photo_id: "c", activity: "" },
    { user_id: "u1", date: "2026-09-03", kind: "fun", done: true, photo_id: null },
    { user_id: "u1", date: "2026-09-03", kind: "exercise", done: true, photo_id: "x" },
    { user_id: "ghost", date: "2026-09-04", kind: "fun", done: true, photo_id: "d" },
  ];
  const gi = galleryItems(gEntries, gUsers);
  check("gallery keeps only fun entries with photos", gi.map(i => i.photoId), ["c", "b", "a"]);
  check("gallery sorts newest day first, then by name", gi.map(i => `${i.date} ${i.name}`),
    ["2026-09-02 Ana", "2026-09-02 Bo", "2026-09-01 Ana"]);
  check("gallery joins the user", gi[2].emoji, "🐙");
  check("gallery drops entries whose user is missing", gi.some(i => i.userId === "ghost"), false);
  check("gallery handles empty input", galleryItems([], []), []);
  check("gallery filters to one person", galleryItems(gEntries, gUsers, "u1").map(i => i.photoId), ["c", "a"]);
  check("filtered gallery keeps the sort", galleryItems(gEntries, gUsers, "u1").map(i => i.date),
    ["2026-09-02", "2026-09-01"]);
  check("filtering by someone with no photos gives nothing", galleryItems(gEntries, gUsers, "ghost"), []);
  check("null filter means everyone", galleryItems(gEntries, gUsers, null).length, 3);

  console.log(`${pass} passed, ${fail} failed`);
  return { pass, fail };
}
