/* What challenge this deployment is running.

   One codebase serves two boards. The friends' wellbeing board is the default,
   so a deployment with no CHALLENGE set behaves exactly as it always has — the
   live board gets no new env var and no new code path. `movember` is the only
   value that changes anything.

   Every challenge-specific string and rule belongs in here. That is the whole
   insurance policy: when this eventually grows into many private boards per
   challenge, the work is threading a board id through a couple of modules
   rather than hunting moustache copy through 1,800 lines of app.js.

   ZERO IMPORTS, deliberately. js/dates.js assigns window.TODAY_OVERRIDE at
   module scope, so anything importing it cannot be loaded inside a serverless
   function. This module is imported by the API, by the dev server and by the
   tests, so it has to stay free of browser globals. */

export const CHALLENGES = {
  /* The original: 30 minutes of exercise and one fun thing, every day. */
  wellbeing: {
    id: "wellbeing",
    appName: "Tracker",            /* app.js prefixes the month at runtime */
    shortName: "Tracker",
    tagline: "30 minutes of exercise and one fun thing, every day",
    /* Which entries.kind the daily photo day uses. See the note in
       scripts/schema.sql: Movember keeps 'fun' too, on purpose. */
    dayKind: "fun",
    hasExercise: true,
    hasFun: true,
    photoIsTheLog: false,          /* you tick the day, the photo is optional */
    dayLabel: "Something fun",
    dayEmoji: "🎉",
    fundraising: false,
    roles: ["participant"],
    promptPool: null,              /* null = the stock fun-prompt deck */
    /* null = do not ask. The friends' board sits behind a passcode and the
       five people on it set it up together, so a consent gate would be
       theatre. Cairn is a public URL and the question is real. */
    consent: null,
    /* Which tabs exist. Progress is built around exercise minutes and
       distance, so it has nothing to say where there is no exercise. */
    tabs: ["today", "board", "gallery", "progress", "profile"],
    other: null,
  },

  /* Thirty days of growing a moustache, for people doing Movember.
     Movember is a trademark and their guidelines forbid using it in a product
     name, so the app is Cairn and the copy says who it is for. */
  movember: {
    id: "movember",
    appName: "Cairn",
    shortName: "Cairn",
    tagline: "Everyone adds a stone",
    dayKind: "fun",
    hasExercise: false,            /* the whole exercise card disappears */
    hasFun: true,
    /* The camera IS the log. api/photo.js already creates the day's entry on
       upload, so no photo means no day, and "days posted out of 30" becomes
       exactly countable rather than a box someone ticked. */
    photoIsTheLog: true,
    dayLabel: "Today's mo",
    dayEmoji: "🥸",
    fundraising: true,
    roles: ["participant", "viewer"],
    promptPool: null,
    /* Shown at signup, and must be ticked before an account can be created.
       Worded for what actually happens rather than in the abstract: the board
       has no passcode, so this is a public web page with people's faces on
       it, and that is the thing being agreed to. */
    consent: {
      participant: "I understand this board is a public web page. My name, my avatar and the photos I post can be seen by anyone with the link.",
      viewer: "I understand this board is a public web page. My name and anything I write can be seen by anyone with the link.",
    },
    tabs: ["today", "board", "gallery", "profile"],
    /* The other challenge this engine runs. Separate origin, so this cannot be
       a link into a working account — it is an interest probe. */
    other: {
      name: "Have fun and stay healthy",
      blurb: "The same board, built around 30 minutes of exercise and one fun thing a day.",
      url: "",                     /* a form link, set before launch */
      showOnDays: [7, 21],
    },
  },
};

export const DEFAULT_CHALLENGE = "wellbeing";

/* Anything unknown, misspelt or absent falls back to the original behaviour.
   That is the safe direction: a typo in an env var must never turn the
   friends' board into something else. */
export function challengeConfig(name) {
  return CHALLENGES[String(name || "").trim().toLowerCase()] || CHALLENGES[DEFAULT_CHALLENGE];
}

/* Whether to show the other-challenge prompt today. Shown once each on the
   days listed in the config, and never again once it has been seen that many
   times. `seenCount` is kept per device in localStorage, which is an
   approximation rather than a promise — a known limit, not an oversight. */
export function shouldShowPromo(dayNum, seenCount, cfg) {
  if (!cfg || !cfg.other || !cfg.other.showOnDays) return false;
  const days = cfg.other.showOnDays;
  if (seenCount >= days.length) return false;
  return days.indexOf(Number(dayNum)) === seenCount;
}
