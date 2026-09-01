/* Pure image maths and selectors — no DOM, no canvas, no network, so all of it
   is testable in node. The parts that touch a canvas live in js/photos.js. */

/* Read the EXIF Orientation tag (1..8) from a JPEG. Anything unexpected — not a
   JPEG, no EXIF, truncated, out of range — returns 1 (upright) rather than
   throwing, because a wrong photo is better than no photo. */
export function readExifOrientation(bytes) {
  const b = bytes;
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;

  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return 1;                    /* lost marker alignment */
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) return 1; /* start of scan / end */
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return 1;

    if (marker === 0xe1) {                          /* APP1 — may hold EXIF */
      const start = i + 4;
      if (start + 6 > b.length) return 1;
      const isExif = b[start] === 0x45 && b[start + 1] === 0x78 &&
                     b[start + 2] === 0x69 && b[start + 3] === 0x66 &&
                     b[start + 4] === 0x00 && b[start + 5] === 0x00;
      if (isExif) return orientationFromTiff(b, start + 6);
    }
    i += 2 + len;
  }
  return 1;
}

function orientationFromTiff(b, tiff) {
  if (tiff + 8 > b.length) return 1;
  const le = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const be = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
  if (!le && !be) return 1;
  const u16 = (o) => (o + 1 >= b.length ? -1 : le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (o + 3 >= b.length ? -1
    : le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
         : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);

  if (u16(tiff + 2) !== 0x2a) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd < 0 || ifd + 2 > b.length) return 1;

  const count = u16(ifd);
  if (count < 0) return 1;
  for (let e = 0; e < count; e++) {
    const entry = ifd + 2 + e * 12;
    if (entry + 12 > b.length) return 1;            /* truncated mid-IFD */
    if (u16(entry) === 0x0112) {
      const v = u16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/* Canvas transform for an EXIF orientation. Returns the matrix to apply and the
   rect to draw into: orientations 5-8 rotate by 90 degrees, which swaps them. */
export function orientationTransform(o, outW, outH) {
  const swap = o >= 5 && o <= 8;
  const drawW = swap ? outH : outW;
  const drawH = swap ? outW : outH;
  const m = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, outW, 0],
    3: [-1, 0, 0, -1, outW, outH],
    4: [1, 0, 0, -1, 0, outH],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, outW, 0],
    7: [0, -1, -1, 0, outW, outH],
    8: [0, -1, 1, 0, 0, outH],
  }[o] || [1, 0, 0, 1, 0, 0];
  return { m, drawW, drawH };
}

/* Fit within maxEdge, preserving aspect. Never upscales. */
export function fitDimensions(w, h, maxEdge) {
  const W = Math.max(0, Math.round(w || 0)), H = Math.max(0, Math.round(h || 0));
  if (!W || !H) return { w: 0, h: 0 };
  const longest = Math.max(W, H);
  if (longest <= maxEdge) return { w: W, h: H };
  const k = maxEdge / longest;
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

/* Everything the Gallery shows, newest day first then by name. Derived from the
   board we already fetch, so the gallery needs no endpoint of its own. */
export function galleryItems(entries, users) {
  const byId = new Map((users || []).map(u => [u.id, u]));
  return (entries || [])
    .filter(e => e.kind === "fun" && e.photo_id && byId.has(e.user_id))
    .map(e => ({
      photoId: e.photo_id,
      userId: e.user_id,
      date: e.date,
      activity: e.activity || "",
      name: byId.get(e.user_id).name,
      emoji: byId.get(e.user_id).emoji,
    }))
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : b.date.localeCompare(a.date)));
}
