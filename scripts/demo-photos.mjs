/* Draws the demo gallery images and writes them to scripts/demo-photos/.
     node scripts/demo-photos.mjs
   These are illustrations, not photographs. The demo is public, so it can't
   use anyone's real pictures, and drawn scenes are honest about being made up
   while still giving the gallery and the photo streak something to show.
   Rendered through a real browser so the output is a genuine JPEG at the same
   size the client-side downscaler would produce (1000px, ~150 KB). */
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* playwright-core is a dev-only dependency of this one script, not of the app,
   so it isn't in package.json. Point PLAYWRIGHT_CORE at an install if the
   bare import can't be resolved. */
const pw = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
const chromium = pw.chromium || pw.default?.chromium;   /* CJS build lands under .default */

const EXE = process.env.CHROME_PATH
  || "/Users/lois/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const OUT = new URL("./demo-photos/", import.meta.url);
const SIZE = 1000;

/* Each scene is plain CSS: layered gradients for depth, simple shapes on top.
   Keys match the file names referenced by scripts/seed-demo.mjs. */
export const SCENES = {
  bread: {
    caption: "Baked bread",
    css: `
      .sky { background: linear-gradient(160deg, #3a2418, #17100b); }
      .glow { position:absolute; inset:-20% -10% 30%; background:
        radial-gradient(60% 50% at 50% 40%, rgba(255,176,74,.55), transparent 70%); }
      .board { position:absolute; left:8%; right:8%; top:52%; height:34%;
        background: linear-gradient(#6b4322, #4a2d16); border-radius:24px;
        box-shadow: 0 30px 60px rgba(0,0,0,.5); }
      .loaf { position:absolute; left:20%; right:20%; top:38%; height:32%;
        background: radial-gradient(70% 90% at 50% 25%, #e8a95a, #c07a33 60%, #8f5220);
        border-radius: 50% 50% 46% 46% / 62% 62% 38% 38%;
        box-shadow: inset 0 -18px 40px rgba(0,0,0,.35), 0 24px 40px rgba(0,0,0,.45); }
      .slash { position:absolute; width:20%; height:5%; background:#f7d9a6;
        border-radius:999px; transform: rotate(-24deg); opacity:.85;
        box-shadow: 0 3px 6px rgba(0,0,0,.3); }
      .s1 { left:30%; top:47%; } .s2 { left:41%; top:52%; } .s3 { left:52%; top:57%; }
      .crumb { position:absolute; background:#d9a463; border-radius:50%; opacity:.8; }
      .steam { position:absolute; width:8px; border-radius:999px;
        background: linear-gradient(#fff, transparent); opacity:.28; }`,
    html: `<div class="glow"></div><div class="board"></div>
      <div class="steam" style="left:38%;top:14%;height:22%"></div>
      <div class="steam" style="left:50%;top:9%;height:28%"></div>
      <div class="steam" style="left:61%;top:16%;height:20%"></div>
      <div class="loaf"></div>
      <div class="slash s1"></div><div class="slash s2"></div><div class="slash s3"></div>
      <div class="crumb" style="left:16%;top:82%;width:14px;height:14px"></div>
      <div class="crumb" style="left:76%;top:86%;width:10px;height:10px"></div>
      <div class="crumb" style="left:63%;top:79%;width:8px;height:8px"></div>`,
  },

  sunset: {
    caption: "Sunset from the balcony",
    css: `
      .sky { background: linear-gradient(#2b1b4d 0%, #7b3b6b 32%, #d9633f 62%, #f2a259 78%, #f7c877 100%); }
      .sun { position:absolute; left:50%; top:58%; width:26%; aspect-ratio:1;
        transform:translate(-50%,-50%); border-radius:50%;
        background: radial-gradient(circle, #fff2c4, #ffcf6b 55%, #ff9d47);
        box-shadow: 0 0 120px 40px rgba(255,180,90,.45); }
      .ridge { position:absolute; left:-5%; right:-5%; bottom:0; height:44%;
        clip-path: polygon(0 62%, 12% 40%, 22% 55%, 34% 26%, 45% 48%, 56% 22%,
                           68% 46%, 80% 32%, 92% 52%, 100% 38%, 100% 100%, 0 100%); }
      .r1 { background:#5b3358; opacity:.85; bottom:22%; height:34%; }
      .r2 { background:#2f1c3d; bottom:14%; }
      .rail { position:absolute; left:0; right:0; bottom:0; height:30%; }
      .bar { position:absolute; bottom:0; width:12px; height:100%; background:#17101f; border-radius:3px; }
      .top { position:absolute; left:0; right:0; bottom:28%; height:18px;
        background:#17101f; border-radius:6px; }
      .cloud { position:absolute; height:34px; border-radius:999px;
        background: rgba(255,206,164,.38); filter: blur(22px); }`,
    html: `<div class="sun"></div>
      <div class="cloud" style="left:8%;top:23%;width:34%;height:30px"></div>
      <div class="cloud" style="left:46%;top:16%;width:40%;height:26px;opacity:.8"></div>
      <div class="cloud" style="left:28%;top:34%;width:48%;height:20px;opacity:.55"></div>
      <div class="ridge r1"></div><div class="ridge r2"></div>
      <div class="rail">
        <div class="top"></div>
        ${Array.from({ length: 9 }, (_, i) => `<div class="bar" style="left:${5 + i * 11.5}%"></div>`).join("")}
      </div>`,
  },

  recipe: {
    caption: "Tried a new recipe",
    css: `
      .sky { background: radial-gradient(70% 70% at 50% 40%, #f6efe2, #e2d6c2); }
      .shadow { position:absolute; left:16%; top:20%; width:70%; aspect-ratio:1;
        border-radius:50%; background: rgba(90,70,45,.18); filter: blur(28px); }
      .plate { position:absolute; left:14%; top:14%; width:72%; aspect-ratio:1;
        border-radius:50%; background: radial-gradient(circle at 38% 32%, #fff, #ece3d4);
        box-shadow: inset 0 0 0 14px #f7f2e9, 0 20px 40px rgba(90,70,45,.2); }
      .bowl { position:absolute; left:26%; top:26%; width:48%; aspect-ratio:1;
        border-radius:50%; background: radial-gradient(circle at 40% 34%, #4e6b3a, #33502a 70%, #24391e); }
      .bit { position:absolute; border-radius:50%; }
      .herb { position:absolute; width:26px; height:12px; background:#7fae54;
        border-radius:999px 0 999px 0; }`,
    html: `<div class="shadow"></div><div class="plate"></div><div class="bowl"></div>
      ${[["#e06b4a", 38, 36, 46], ["#f0a541", 55, 42, 34], ["#e8d24a", 44, 55, 30],
         ["#d8553f", 60, 58, 40], ["#f2b95c", 34, 52, 26], ["#c94a36", 52, 32, 24],
         ["#efc75a", 63, 48, 22], ["#e2734c", 41, 45, 28]]
        .map(([c, l, t, s]) => `<div class="bit" style="left:${l}%;top:${t}%;width:${s}px;height:${s}px;background:${c}"></div>`).join("")}
      ${[[47, 30, -20], [58, 52, 35], [36, 46, 12], [50, 62, -8]]
        .map(([l, t, r]) => `<div class="herb" style="left:${l}%;top:${t}%;transform:rotate(${r}deg)"></div>`).join("")}`,
  },

  boardgame: {
    caption: "Board game night",
    css: `
      .sky { background: radial-gradient(60% 55% at 50% 42%, #2c5541, #14261f 70%, #0c1713); }
      .lamp { position:absolute; inset:0; background:
        radial-gradient(45% 40% at 50% 38%, rgba(255,214,140,.35), transparent 70%); }
      /* One conic gradient rather than 64 divs: nth-child striping on an
         even-width grid gives vertical bars, not a chequerboard. */
      .board { position:absolute; left:18%; top:24%; width:64%; aspect-ratio:1;
        transform: rotate(-9deg); border-radius:10px; overflow:hidden;
        box-shadow: 0 30px 60px rgba(0,0,0,.55);
        background: repeating-conic-gradient(#e8dcc2 0 25%, #5a3a26 0 50%) 0 0 / 25% 25%;
        border: 10px solid #47301f; }
      /* padding and gap in px, not %: percentage padding resolves against the
         containing block's width, so 14% here meant 140px on a 150px die and
         the pips were squeezed to zero. */
      .die { position:absolute; width:15%; aspect-ratio:1; border-radius:18px;
        background: linear-gradient(150deg, #fdfbf5, #ddd5c4);
        box-shadow: 0 14px 26px rgba(0,0,0,.5); display:grid; padding:20px; gap:10px;
        grid-template-columns: repeat(3,1fr); grid-template-rows: repeat(3,1fr); }
      .die i { border-radius:50%; }
      .die i.on { background:#2a2320; }
      .piece { position:absolute; width:7%; aspect-ratio:1; border-radius:50%;
        box-shadow: 0 8px 16px rgba(0,0,0,.5); }`,
    html: `<div class="lamp"></div>
      <div class="board"></div>
      ${[["8%", "66%", 12, [0, 4, 8]], ["74%", "72%", -16, [0, 2, 4, 6, 8]]]
        .map(([l, t, r, pips]) => `<div class="die" style="left:${l};top:${t};transform:rotate(${r}deg)">${
          Array.from({ length: 9 }, (_, i) => `<i class="${pips.includes(i) ? "on" : ""}"></i>`).join("")
        }</div>`).join("")}
      <div class="piece" style="left:30%;top:38%;background:#d94f3d"></div>
      <div class="piece" style="left:52%;top:30%;background:#e8b23c"></div>
      <div class="piece" style="left:44%;top:56%;background:#3d7fd9"></div>`,
  },

  park: {
    caption: "Photo walk round the park",
    css: `
      .sky { background: linear-gradient(#8ec9ee 0%, #bfe0f2 42%, #dceec9 58%, #93c268 100%); }
      .sun { position:absolute; left:72%; top:10%; width:14%; aspect-ratio:1;
        border-radius:50%; background: radial-gradient(circle, #fff6cf, #ffe07a);
        box-shadow: 0 0 90px 30px rgba(255,231,150,.5); }
      .hill { position:absolute; border-radius:50% 50% 0 0; }
      .path { position:absolute; left:34%; bottom:0; width:32%; height:46%;
        background: linear-gradient(#cdbb93, #b9a37a);
        clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%); }
      .trunk { position:absolute; width:3.2%; background:#6b4a2c; border-radius:4px; }
      .leaf { position:absolute; border-radius:50%; }
      .cloud { position:absolute; height:34px; border-radius:999px; background:#fff; opacity:.9; }`,
    html: `<div class="sun"></div>
      <div class="cloud" style="left:8%;top:14%;width:150px"></div>
      <div class="cloud" style="left:16%;top:9%;width:90px;height:52px"></div>
      <div class="cloud" style="left:44%;top:22%;width:120px;opacity:.75"></div>
      <div class="hill" style="left:-10%;bottom:34%;width:70%;height:26%;background:#7fb45c"></div>
      <div class="hill" style="left:44%;bottom:36%;width:66%;height:22%;background:#8cc067"></div>
      <div class="path"></div>
      <div class="trunk" style="left:14%;bottom:16%;height:26%"></div>
      <div class="leaf" style="left:5%;bottom:34%;width:22%;aspect-ratio:1;background:#3f7d3a"></div>
      <div class="leaf" style="left:11%;bottom:44%;width:16%;aspect-ratio:1;background:#4d9243"></div>
      <div class="trunk" style="left:79%;bottom:20%;height:22%"></div>
      <div class="leaf" style="left:71%;bottom:35%;width:19%;aspect-ratio:1;background:#3a743a"></div>
      <div class="leaf" style="left:76%;bottom:43%;width:14%;aspect-ratio:1;background:#4d9243"></div>
`,
  },

  stars: {
    caption: "Stargazed for a bit",
    css: `
      .sky { background: linear-gradient(#05060f 0%, #0d1430 45%, #1b2450 72%, #2b2f52 100%); }
      .milky { position:absolute; inset:0; background:
        radial-gradient(40% 60% at 62% 32%, rgba(150,170,255,.22), transparent 70%),
        radial-gradient(30% 45% at 30% 20%, rgba(200,160,255,.16), transparent 70%); }
      .star { position:absolute; background:#fff; border-radius:50%; }
      .ridge { position:absolute; left:-5%; right:-5%; bottom:0; height:30%;
        background:#05060c;
        clip-path: polygon(0 58%, 14% 30%, 26% 50%, 40% 18%, 52% 44%, 66% 24%,
                           78% 46%, 90% 30%, 100% 48%, 100% 100%, 0 100%); }
      .moon { position:absolute; left:16%; top:14%; width:11%; aspect-ratio:1;
        border-radius:50%; background: radial-gradient(circle at 36% 34%, #fff, #cfd6f0);
        box-shadow: 0 0 70px 18px rgba(190,205,255,.35); }`,
    /* Fixed positions, not random: the image has to come out the same on every
       run so re-seeding doesn't silently change the gallery. */
    html: `<div class="milky"></div><div class="moon"></div>
      ${[[7,12,3],[19,31,2],[28,8,4],[35,22,2],[41,41,3],[48,13,2],[55,29,5],[61,7,2],
         [67,37,3],[73,19,2],[80,44,4],[86,11,2],[92,28,3],[12,47,2],[24,52,3],[33,60,2],
         [44,55,4],[52,63,2],[59,50,3],[70,58,2],[77,64,4],[88,54,2],[95,40,3],[3,35,2],
         [16,21,4],[30,38,2],[46,26,3],[64,45,2],[83,33,3],[97,17,2]]
        .map(([l, t, s]) => `<div class="star" style="left:${l}%;top:${t}%;width:${s * 2}px;height:${s * 2}px;opacity:${0.55 + (s % 3) * 0.15};box-shadow:0 0 ${s * 3}px ${s}px rgba(255,255,255,.35)"></div>`).join("")}
      <div class="ridge"></div>`,
  },
};

function page(scene) {
  return `<!doctype html><meta charset="utf-8"><style>
    * { margin:0; box-sizing:border-box; }
    body { width:${SIZE}px; height:${SIZE}px; overflow:hidden; }
    .sky { position:relative; width:${SIZE}px; height:${SIZE}px; overflow:hidden;
      font: 16px system-ui; }
    .grain { position:absolute; inset:0; opacity:.05; background-image:
      repeating-linear-gradient(0deg, #000 0 1px, transparent 1px 3px); }
    .vignette { position:absolute; inset:0;
      background: radial-gradient(75% 75% at 50% 45%, transparent 55%, rgba(0,0,0,.35)); }
    ${scene.css}
  </style><div class="sky">${scene.html}<div class="grain"></div><div class="vignette"></div></div>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: EXE });
  const p = await b.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const [name, scene] of Object.entries(SCENES)) {
    await p.setContent(page(scene));
    await p.waitForTimeout(120);
    const file = fileURLToPath(new URL(`${name}.jpg`, OUT));
    /* quality 72 lands each scene near the ~150 KB the client aims for */
    await p.screenshot({ path: file, type: "jpeg", quality: 72 });
    console.log(`${name}.jpg  ${(statSync(file).size / 1024).toFixed(0)} KB  "${scene.caption}"`);
  }
  await b.close();
}
