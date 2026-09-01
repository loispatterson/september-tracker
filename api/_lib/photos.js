/* Photo rules. No DB, no dependencies — imported by the API handler, the local
   dev server and the tests, so client and server can't disagree about what a
   valid photo is. */

/* ~1.4 MB of base64 ≈ 1.05 MB decoded: far under Vercel's 4.5 MB body cap, and
   a backstop if a client ever skips the browser-side downscale. */
export const MAX_B64 = 1_400_000;
export const MIMES = ["image/jpeg", "image/webp", "image/png"];

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function stripDataUrl(s) {
  const str = String(s || "");
  const comma = str.startsWith("data:") ? str.indexOf(",") : -1;
  return comma === -1 ? str : str.slice(comma + 1);
}

/* Decoded byte count without allocating the buffer. */
export function b64Bytes(b64) {
  const s = String(b64 || "");
  if (!s) return 0;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

export function validPhotoDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && date >= "2026-09-01" && date <= "2026-09-30";
}

export function newPhotoId() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Returns null when the photo is acceptable, else { status, error }. */
export function validatePhoto({ date, mime, b64 }) {
  if (!validPhotoDate(date)) return { status: 400, error: "date must be in September 2026" };
  if (!MIMES.includes(mime)) return { status: 400, error: "unsupported image type" };
  const s = String(b64 || "");
  if (!s) return { status: 400, error: "no image data" };
  if (s.length > MAX_B64) return { status: 413, error: "photo too large" };
  /* Checked before any SQL runs: Postgres decode() throws on junk, which would
     surface as an opaque 500 instead of a useful message. */
  if (!B64.test(s)) return { status: 400, error: "image data is not base64" };
  return null;
}
