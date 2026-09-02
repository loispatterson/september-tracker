/* Browser-side photo handling: shrink before upload, then load and cache the
   images the views ask for. The pure maths lives in js/imageutil.js. */
import { readExifOrientation, orientationTransform, fitDimensions } from "./imageutil.js";
import { fetchPhotoBlob } from "./api.js";

/* Sized for looking at on a phone, not for printing. 1000px still fills a
   lightbox on a high-density screen, and roughly a third smaller than 1200
   across a month of photos in a 0.5 GB database. */
const MAX_EDGE = 1000;
const TARGET_BYTES = 150_000;
const START_QUALITY = 0.68;

/* A 2x1 JPEG whose EXIF Orientation is 6. A browser that honours EXIF decodes
   it as 1x2. Browsers have applied orientation automatically since ~2020, so
   applying our own transform on top would rotate every iPhone portrait twice —
   we detect once which world we're in rather than guessing. */
const PROBE = "data:image/jpeg;base64,/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4H8Q/8h/Uv+vmX/0M0UUV/ptkP/Ipwn/XuH/pKPAzr/kZ4r/r5P8A9KZ//9k=";

let exifApplied = null;
export async function browserAppliesExif() {
  if (exifApplied !== null) return exifApplied;
  try {
    const img = new Image();
    img.src = PROBE;
    await (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; }));
    exifApplied = img.naturalWidth === 1 && img.naturalHeight === 2;
  } catch {
    exifApplied = false;
  }
  return exifApplied;
}

function decodeError() {
  return Object.assign(new Error("decode"), { code: "decode" });
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; }));
  } catch {
    URL.revokeObjectURL(url);
    throw decodeError();          /* HEIC on a browser that can't read it, etc. */
  }
  return { img, url };
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(decodeError())), "image/jpeg", quality);
  });
}

/* Shrink a picked file to something worth uploading. Returns a blob plus a
   blob: preview URL — never a data URL, which would be a huge string to carry
   around in re-rendered HTML. */
export async function prepareUpload(file, maxEdge = MAX_EDGE) {
  if (!file) throw decodeError();

  const head = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
  const exif = readExifOrientation(head);
  const { img, url } = await loadImage(file);

  try {
    const o = (await browserAppliesExif()) ? 1 : exif;
    const swap = o >= 5 && o <= 8;
    const srcW = swap ? img.naturalHeight : img.naturalWidth;
    const srcH = swap ? img.naturalWidth : img.naturalHeight;
    if (!srcW || !srcH) throw decodeError();

    let { w, h } = fitDimensions(srcW, srcH, maxEdge);
    let blob = await render(img, o, w, h, START_QUALITY);

    /* Ladder down on quality, then on size, rather than uploading something huge */
    let q = START_QUALITY;
    while (blob.size > TARGET_BYTES && q > 0.45) {
      q -= 0.08;
      blob = await render(img, o, w, h, q);
    }
    if (blob.size > TARGET_BYTES) {
      ({ w, h } = fitDimensions(srcW, srcH, 800));
      blob = await render(img, o, w, h, 0.6);
    }

    return { blob, previewUrl: URL.createObjectURL(blob), w, h, bytes: blob.size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function render(img, o, w, h, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  /* white first: a transparent PNG would otherwise encode to black as a JPEG */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  const { m, drawW, drawH } = orientationTransform(o, w, h);
  ctx.setTransform(...m);
  ctx.drawImage(img, 0, 0, drawW, drawH);
  return toBlob(canvas, quality);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read"));
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

/* ---------- loading and caching photos for display ---------- */

const cache = new Map();      /* photoId -> object URL */
const inflight = new Map();
let observer = null;

export function cachedUrl(id) { return cache.get(id) || null; }

export function forgetPhoto(id) {
  const url = cache.get(id);
  if (url) URL.revokeObjectURL(url);
  cache.delete(id);
  inflight.delete(id);
}

export async function loadPhoto(id) {
  if (cache.has(id)) return cache.get(id);
  if (inflight.has(id)) return inflight.get(id);
  const p = fetchPhotoBlob(id)
    .then(blob => {
      const url = URL.createObjectURL(blob);
      cache.set(id, url);
      inflight.delete(id);
      return url;
    })
    .catch(e => { inflight.delete(id); throw e; });
  inflight.set(id, p);
  return p;
}

/* The views render <img data-photo="id"> placeholders; this fills them in.
   Cached images are assigned synchronously so the 60-second board refresh
   doesn't make every picture flicker. */
export function hydratePhotos(root = document) {
  if (observer) observer.disconnect();      /* its targets were just replaced */
  observer = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(onVisible, { rootMargin: "200px" })
    : null;

  for (const img of root.querySelectorAll("img[data-photo]")) {
    const id = img.dataset.photo;
    if (!id || img.dataset.loaded === id) continue;
    const url = cache.get(id);
    if (url) { apply(img, url, id); continue; }
    if (observer) observer.observe(img); else fill(img);
  }
}

function onVisible(entries) {
  for (const e of entries) {
    if (e.isIntersecting) { observer.unobserve(e.target); fill(e.target); }
  }
}

function apply(img, url, id) {
  img.src = url;
  img.dataset.loaded = id;
  img.classList.add("ready");
}

function fill(img) {
  const id = img.dataset.photo;
  if (!id) return;
  loadPhoto(id)
    .then(url => { if (img.dataset.photo === id) apply(img, url, id); })
    .catch(() => img.closest(".gtile, .photo-wrap")?.classList.add("failed"));
}
