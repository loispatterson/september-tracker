/* Avatars.

   The wellbeing board picks an emoji. Cairn picks a moustache, because on a
   board about growing one that is the only avatar that makes any sense — and
   because the styles have names people enjoy arguing about.

   An avatar is stored as a plain string either way: an emoji character, or
   "mo:handlebar". One field, one column, nothing to migrate. avatarHtml()
   decides which it is, so every render site stays a single call.

   The moustaches are drawn rather than emoji because the emoji set has
   essentially one moustache in it (🥸, which is really a disguise) and
   thirty people all picking the same face defeats the point.

   ZERO IMPORTS, like js/challenge.js: imported by the API, the dev server and
   the tests, so it must not touch window or document. */

/* A tapered curve, for the droops on a Fu Manchu or a horseshoe.

   Hand-authoring these as bezier paths gives you straight slivers that read as
   table legs. Sampling a quadratic curve and offsetting it by a width that
   tapers to nothing gives you something that hangs like hair, and it is
   arithmetic rather than guesswork. */
function droop(x0, y0, cx, cy, x1, y1, w0, w1, steps = 14) {
  const pt = t => {
    const u = 1 - t;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1,
            u * u * y0 + 2 * u * t * cy + t * t * y1];
  };
  const left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = pt(t);
    const [nx, ny] = pt(Math.min(1, t + 0.01));
    const dx = nx - x, dy = ny - y;
    const len = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * t) / 2;
    left.push([x - (dy / len) * w, y + (dx / len) * w]);
    right.push([x + (dy / len) * w, y - (dx / len) * w]);
  }
  const r = n => Math.round(n * 10) / 10;
  const path = left.map(([x, y], i) => `${i ? "L" : "M"}${r(x)} ${r(y)}`)
    .concat(right.reverse().map(([x, y]) => `L${r(x)} ${r(y)}`));
  return path.join("") + "Z";
}

/* Each is a path on a 48x24 canvas, drawn as if sitting under a nose.
   Names are the ones barbers and Movember itself actually use. */
export const MOUSTACHES = {
  handlebar: { name: "Handlebar",
    d: "M24 7c-5 0-7 3-11 3-3 0-5-2-7-1-3 1-2 6 2 7 5 1 9-3 12-7h8c3 4 7 8 12 7 4-1 5-6 2-7-2-1-4 1-7 1-4 0-6-3-11-3z" },
  walrus: { name: "Walrus",
    d: "M24 6c-7 0-11 2-15 5-3 2-4 6-1 7 4 1 8-3 12-5 1 3 3 3 4 3s3 0 4-3c4 2 8 6 12 5 3-1 2-5-1-7-4-3-8-5-15-5z" },
  chevron: { name: "Chevron",
    d: "M24 7c-6 0-12 2-16 6-1 1 0 3 2 3 4-1 9-4 14-4s10 3 14 4c2 0 3-2 2-3-4-4-10-6-16-6z" },
  pencil: { name: "Pencil",
    d: "M8 11c5-2 10-3 16-3s11 1 16 3c1 0 1 2 0 2-5-1-10-2-16-2s-11 1-16 2c-1 0-1-2 0-2z" },
  horseshoe: { name: "Horseshoe",
    d: "M24 6c-5 0-9 1-11.5 3-1 .8-1 3 .5 2.6C15.5 10.6 19.5 9.6 24 9.6s8.5 1 11 2c1.5.4 1.5-1.8.5-2.6C33 7 29 6 24 6z"
      + droop(13, 10.5, 11.5, 15, 10.5, 21, 3.4, 1.1)
      + droop(35, 10.5, 36.5, 15, 37.5, 21, 3.4, 1.1) },
  toothbrush: { name: "Toothbrush",
    d: "M19.5 7.5h9c1.4 0 2.5 1.1 2.5 2.5v3.5c0 1.4-1.1 2.5-2.5 2.5h-9C18.1 16 17 14.9 17 13.5V10c0-1.4 1.1-2.5 2.5-2.5z" },
  dali: { name: "Dalí",
    d: "M24 10c-4 0-6 2-9 2-2 0-3-1-4-3-1-2-4-1-3 1 1 4 5 6 8 5 3-1 5-3 8-3s5 2 8 3c3 1 7-1 8-5 1-2-2-3-3-1-1 2-2 3-4 3-3 0-5-2-9-2z" },
  imperial: { name: "Imperial",
    d: "M24 8c-3 0-5.5 1.2-8 1.2-3.5 0-6-2.6-9-1.8-2.2.6-1.6 3.4 1 4 3.8.8 7-1.4 10-1.4h12c3 0 6.2 2.2 10 1.4 2.6-.6 3.2-3.4 1-4-3-.8-5.5 1.8-9 1.8-2.5 0-5-1.2-8-1.2z" },
  fuman: { name: "Fu Manchu",
    d: "M14.5 7.8h19c1.4 0 1.4 3 0 3h-19c-1.4 0-1.4-3 0-3z"
      + droop(16.5, 10.3, 13.5, 14.5, 10.5, 21, 3.2, .7)
      + droop(31.5, 10.3, 34.5, 14.5, 37.5, 21, 3.2, .7) },
  bushy: { name: "Bushy",
    d: "M24 6c-6 0-10 2-13 4-2 1-3 4-1 5 2 1 4-1 6-1 2 1 3 3 8 3s6-2 8-3c2 0 4 2 6 1 2-1 1-4-1-5-3-2-7-4-13-4z" },
  english: { name: "English",
    d: "M24 9h-3c-4 0-7-1.5-11-2.5-2.5-.6-3 2.4-.6 3.2C13 11 17 11.6 21 11.6h6c4 0 8-.6 11.6-1.9 2.4-.8 1.9-3.8-.6-3.2C34 7.5 31 9 27 9z" },
  hungarian: { name: "Hungarian",
    d: "M24 5c-8 0-13 2.5-17 6-2.5 2.2-2.5 6.5.6 6.8 3.4.3 6.4-3 9.4-4.3 1.6-.7 3-.5 3.5 1.5.4 1.6 2.6 1.6 3 0 .5-2 1.9-2.2 3.5-1.5 3 1.3 6 4.6 9.4 4.3 3.1-.3 3.1-4.6.6-6.8-4-3.5-9-6-17-6z" },
  zappa: { name: "Zappa",
    d: "M24 7c-5.5 0-9.5 1.5-12.5 3.5-1.6 1-1 3.4.8 3 2.6-.6 5-1.6 7.7-1.9h8c2.7.3 5.1 1.3 7.7 1.9 1.8.4 2.4-2 .8-3C33.5 8.5 29.5 7 24 7zM22 17.5h4c1.2 0 1.2 4 0 4h-4c-1.2 0-1.2-4 0-4z" },
  pancho: { name: "Pancho",
    d: "M24 7c-6 0-10 1.5-13 3.4-1.4.9-.9 3.1.7 2.8 3.2-.7 6-1.8 9.3-2.1h6c3.3.3 6.1 1.4 9.3 2.1 1.6.3 2.1-1.9.7-2.8C34 8.5 30 7 24 7z"
      + droop(20.5, 11.5, 19.5, 16.5, 18.5, 21.5, 3.6, 1)
      + droop(27.5, 11.5, 28.5, 16.5, 29.5, 21.5, 3.6, 1) },
  petit: { name: "Petit",
    d: "M24 9c-3 0-5 1-7 1.6-1.4.4-1.2 2.4.3 2.2 2.2-.3 4.2-.8 6.7-.8s4.5.5 6.7.8c1.5.2 1.7-1.8.3-2.2-2-.6-4-1.6-7-1.6z" },
  babyface: { name: "Just Started",
    d: "M16 11c2-1 5-1 8-1s6 0 8 1c1 0 1 1 0 1-3-1-5-1-8-1s-5 0-8 1c-1 0-1-1 0-1z" },
  cairn: { name: "Cairn",
    /* not a moustache: a little stack of stones, for the people watching */
    d: "M17.5 19h13c1.2 0 1.2 2.4 0 2.4h-13c-1.2 0-1.2-2.4 0-2.4zM19.5 14.8h9c1.2 0 1.2 2.4 0 2.4h-9c-1.2 0-1.2-2.4 0-2.4zM21 10.8h6c1.2 0 1.2 2.4 0 2.4h-6c-1.2 0-1.2-2.4 0-2.4zM22.5 7.2h3c1.1 0 1.1 2.2 0 2.2h-3c-1.1 0-1.1-2.2 0-2.2z" },
};

export const MOUSTACHE_KEYS = Object.keys(MOUSTACHES);

/* Colours.

   Hair colours rather than brand colours, because a moustache that is teal is
   a joke and a moustache that is auburn is a person. The bold three at the end
   are there for the people who want to be a joke.

   Every one has to read on both the light and the dark theme, so true black
   and true white are out: the darkest here is a deep chestnut and the lightest
   a warm silver. */
export const COLOURS = [
  { id: "chestnut", name: "Chestnut", hex: "#6b4423" },
  { id: "auburn",   name: "Auburn",   hex: "#8c3b1b" },
  { id: "ginger",   name: "Ginger",   hex: "#c25e1a" },
  { id: "sandy",    name: "Sandy",    hex: "#b08445" },
  { id: "blonde",   name: "Blonde",   hex: "#c8a24a" },
  { id: "ash",      name: "Ash",      hex: "#8a8378" },
  { id: "silver",   name: "Silver",   hex: "#aab0b4" },
  { id: "jet",      name: "Jet",      hex: "#4a4440" },
  { id: "teal",     name: "Teal",     hex: "#2a7f78" },
  { id: "plum",     name: "Plum",     hex: "#7d3a63" },
  { id: "moss",     name: "Moss",     hex: "#5b7a35" },
];

const BY_COLOUR = new Map(COLOURS.map(c => [c.id, c]));

/* An avatar is "mo:<style>" or "mo:<style>.<colour>". The colour is optional
   so every row written before colours existed still works: without one, the
   style picks a colour from the palette by position, which at least makes the
   picker look like seventeen different things rather than seventeen identical
   cream shapes. */
export function splitAvatar(avatar) {
  const body = String(avatar || "").slice(3);
  const dot = body.indexOf(".");
  const style = dot === -1 ? body : body.slice(0, dot);
  const colour = dot === -1 ? "" : body.slice(dot + 1);
  return { style, colour };
}

export function colourFor(avatar) {
  const { style, colour } = splitAvatar(avatar);
  if (BY_COLOUR.has(colour)) return BY_COLOUR.get(colour).hex;
  const i = MOUSTACHE_KEYS.indexOf(style);
  return COLOURS[(i < 0 ? 0 : i) % COLOURS.length].hex;
}

export function colourName(avatar) {
  const { colour } = splitAvatar(avatar);
  return BY_COLOUR.has(colour) ? BY_COLOUR.get(colour).name : "";
}

export function withColour(avatar, colourId) {
  const { style } = splitAvatar(avatar);
  return BY_COLOUR.has(colourId) ? `mo:${style}.${colourId}` : `mo:${style}`;
}

export function isMoustache(avatar) {
  return typeof avatar === "string" && avatar.startsWith("mo:");
}

export function moustacheKey(avatar) {
  if (!isMoustache(avatar)) return null;
  const { style } = splitAvatar(avatar);
  return MOUSTACHES[style] ? style : null;
}

/* A readable name for the avatar, used in alt text and titles. */
export function avatarName(avatar) {
  const k = moustacheKey(avatar);
  if (!k) return String(avatar || "");
  const c = colourName(avatar);
  return c ? `${c} ${MOUSTACHES[k].name}` : MOUSTACHES[k].name;
}

/* Inline SVG rather than an <img>: no request, scales cleanly, and takes its
   colour from the surrounding text so it works in both themes without a
   second asset. */
export function moustacheSvg(key, size = 22, colour = "") {
  const m = MOUSTACHES[key];
  if (!m) return "";
  /* A real colour rather than currentColor: the whole point is telling people
     apart on a board, and inheriting the text colour makes everyone identical. */
  const fill = colour || colourFor("mo:" + key);
  return `<svg class="mo-svg" viewBox="0 0 48 24" width="${size}" height="${Math.round(size / 2)}"
    aria-hidden="true" focusable="false"><path d="${m.d}" fill="${fill}"/></svg>`;
}

/* The one call every render site makes. Returns HTML.
   `avatar` is whatever is stored on the user: an emoji, or "mo:handlebar". */
export function avatarHtml(avatar, size = 22) {
  const k = moustacheKey(avatar);
  if (k) return moustacheSvg(k, size, colourFor(avatar));
  /* A "mo:" avatar whose style we no longer have — a renamed key, or a row
     written by a newer version — draws the starter moustache rather than the
     literal string "mo:whatever" appearing in the middle of the board. */
  if (isMoustache(avatar)) return moustacheSvg("babyface", size);
  /* Emoji are already safe to interpolate: the only values that reach here
     are the fixed EMOJI_CHOICES list, capped at 8 characters by the API. */
  return `<span class="avatar-emoji">${avatar || ""}</span>`;
}

/* What a new account gets offered. Moustaches on a growth challenge, the
   stock emoji otherwise. */
export const EMOJI_CHOICES =
  ["💪", "🏃", "🚴", "🧘", "🏊", "⚡", "🔥", "🌟", "🐝", "🦊", "🐙", "🦕"];

export function avatarChoices(cfg) {
  return cfg && cfg.photoIsTheLog
    ? MOUSTACHE_KEYS.map(k => "mo:" + k)
    : EMOJI_CHOICES;
}

export function defaultAvatar(cfg) {
  return cfg && cfg.photoIsTheLog ? "mo:babyface" : "💪";
}
