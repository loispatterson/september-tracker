/* Draw the app icons.
     node scripts/icons.mjs            # the challenge in CHALLENGE, or wellbeing
     CHALLENGE=movember node scripts/icons.mjs

   Rendered through a real browser, the same trick scripts/demo-photos.mjs
   already uses, so the mark lives in source rather than in a design file on
   somebody's laptop and can be regenerated per challenge.

   Four sizes, because each has a different job:
     192  the minimum Android will accept for an installable app
     512  what Android uses for the splash screen
     512 maskable  Android crops icons to whatever shape the launcher wants,
          so this one keeps everything inside the middle 80% and fills the
          corners with the background rather than transparency
     180  apple-touch-icon, which iOS requires before it will install anything
          to the Home Screen — and no Home Screen means no web push */
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { challengeFromEnv } from "../api/_lib/challenge.js";
import { MOUSTACHES, COLOURS } from "../js/avatars.js";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cfg = challengeFromEnv();
/* One folder per challenge, because the filenames are the same in each and a
   second run would otherwise overwrite the first challenge's icons. */
const OUT = new URL(`../icons/${cfg.id}/`, import.meta.url);
mkdirSync(OUT, { recursive: true });

/* Cairn's mark is a stack of stones, not a moustache: the moustaches are how
   people tell each other apart, so the app itself should not be wearing one.
   The wellbeing board keeps its arm. */
const INK = "#f2ede1";
const GROUND = "#1b1a18";

function art(px, { maskable = false } = {}) {
  /* A maskable icon can be cropped to a circle, a squircle or a rounded
     square depending on the launcher, so the artwork has to survive losing
     the corners. Everything therefore sits inside the middle 80%. */
  const pad = maskable ? 0.2 : 0.12;
  const inner = px * (1 - pad * 2);
  /* The avatar viewBox is 48x24, twice as wide as tall, because it is drawn
     for moustaches. The cairn stack only occupies a square in the middle of
     that, so the icon crops to the artwork instead of inheriting all the empty
     space either side. */
  const mark = cfg.photoIsTheLog
    ? `<svg viewBox="16 5.5 16 17" width="${inner * 0.94}" height="${inner}">
         <path d="${MOUSTACHES.cairn.d}" fill="${INK}"/></svg>`
    : `<div style="font-size:${inner * 0.72}px;line-height:1">💪</div>`;
  return `<!doctype html><meta charset="utf-8">
  <body style="margin:0;width:${px}px;height:${px}px;background:${GROUND};
               display:flex;align-items:center;justify-content:center;
               font-family:-apple-system,sans-serif;color:${INK}">
    ${mark}
  </body>`;
}

function render(html, px, file) {
  const tmp = `/tmp/cairn-icon-${px}-${Math.random().toString(36).slice(2)}.html`;
  writeFileSync(tmp, html);
  const out = new URL(file, OUT).pathname;
  execSync(`"${CHROME}" --headless --disable-gpu --hide-scrollbars ` +
           `--default-background-color=00000000 --virtual-time-budget=2500 ` +
           `--window-size=${px},${px} --screenshot="${out}" "file://${tmp}"`,
           { stdio: "ignore" });
  unlinkSync(tmp);
  return readFileSync(out).length;
}

const jobs = [
  [192, "icon-192.png", {}],
  [512, "icon-512.png", {}],
  [512, "icon-512-maskable.png", { maskable: true }],
  [180, "apple-touch-icon.png", {}],
];

for (const [px, file, opts] of jobs) {
  const bytes = render(art(px, opts), px, file);
  console.log(`${file.padEnd(24)} ${px}x${px}  ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`\nicons for "${cfg.id}" written to icons/${cfg.id}/`);
