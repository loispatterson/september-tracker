/* Write the challenge's identity into index.html at build time.
     node scripts/stamp-html.mjs            # wellbeing, the default
     CHALLENGE=movember node scripts/stamp-html.mjs

   Run from `vercel-build`, so each deployment serves HTML that already says
   who it is.

   This exists because of a mistake worth recording. The title, the manifest
   link and the apple-touch-icon were being corrected by app.js once the board
   answered, on the theory that iOS reads them from the live DOM when somebody
   taps Add to Home Screen. It does not. It reads the HTML as served, before
   any script has run, so the install sheet offered "Tracker" as the name and
   the page flashed the wrong title on every load.

   Nothing here can be done from JavaScript after the fact, so it has to
   happen before the file is sent.

   Idempotent: it rewrites whole attributes rather than appending, so running
   it twice, or running it for a different challenge, gives the same result as
   running it once. */
import { readFileSync, writeFileSync } from "node:fs";
import { challengeFromEnv } from "../api/_lib/challenge.js";
import { MOUSTACHES } from "../js/avatars.js";

const cfg = challengeFromEnv();
const file = new URL("../index.html", import.meta.url);
let html = readFileSync(file, "utf8");

/* The first title anyone sees, before app.js has worked out the month. The
   wellbeing board renames itself monthly so it starts generic; Cairn does not,
   so it can be exact. */
const title = cfg.hasExercise ? "Monthly Tracker" : cfg.appName;
const ground = cfg.hasExercise ? "#2a78d6" : "#1b1a18";

/* The tab favicon, as a data URI so it costs no request. Cairn gets its mark;
   the wellbeing board keeps its arm. */
const favicon = cfg.hasExercise
  ? `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💪</text></svg>`
  : `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='16 5.5 16 17'><path d='${MOUSTACHES.cairn.d}' fill='%23f2ede1'/></svg>`;

const swaps = [
  /* The challenge, readable from the first byte. Without it the client has to
     guess until /api/board answers, and a wrong guess means the header and the
     browser tab say the wrong name for a second on every load. */
  [/<html lang="en"[^>]*>/, `<html lang="en" data-challenge="${cfg.id}">`],
  [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
  [/(<meta name="theme-color" content=")[^"]*(")/, `$1${ground}$2`],
  [/(<meta name="apple-mobile-web-app-title" id="ios-title" content=")[^"]*(")/,
   `$1${cfg.appName}$2`],
  [/(<link rel="apple-touch-icon" id="ios-icon" href=")[^"]*(")/,
   `$1/icons/${cfg.id}/apple-touch-icon.png$2`],
  [/(<link rel="manifest" id="manifest" href=")[^"]*(")/,
   `$1/manifest-${cfg.id}.json$2`],
  [/(<link rel="icon" href=")[^"]*(">)/, `$1${favicon}$2`],
];

let missed = 0;
for (const [re, to] of swaps) {
  if (!re.test(html)) { console.error("no match for", re); missed++; continue; }
  html = html.replace(re, to);
}
if (missed) {
  console.error(`${missed} tag(s) not found — index.html has drifted from this script`);
  process.exit(1);
}

writeFileSync(file, html);
console.log(`index.html stamped for "${cfg.id}": ${title}, icon ${cfg.id}/`);
