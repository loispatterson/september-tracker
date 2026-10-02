/* A participant's own fundraising page.

   The app never touches money. All it stores is a link out, so the only job
   here is making sure the link is somewhere a sponsor should be sent.

   Pure: no DB, no network, imported by the API, the dev server and the tests,
   the same three-consumer rule as _lib/photos.js. */

/* Hosts a participant may link to. Movember runs localised sites
   (uk.movember.com, ca.movember.com) and the short mobro.co domain, so the
   check is on the registrable domain rather than an exact host.

   JustGiving is here too: a few people raise for Movember through a JustGiving
   page instead, and refusing those would send them away for no good reason. */
export const ALLOWED_HOSTS = [
  "movember.com",
  "mobro.co",
  "justgiving.com",
];

const MAX = 300;

function registrable(host) {
  const bits = String(host || "").toLowerCase().replace(/\.$/, "").split(".");
  return bits.slice(-2).join(".");
}

/* Returns a tidied https URL, or "" if it is not somewhere we should send a
   sponsor. Query strings and fragments are stripped: they carry tracking and
   occasionally a session, and neither belongs in a link shown to everyone. */
export function cleanFundraisingUrl(raw) {
  const text = String(raw || "").trim();
  if (!text || text.length > MAX) return "";

  let u;
  try {
    /* Bare "uk.movember.com/mospace/123" is what people paste when they copy
       from a phone, so assume https rather than rejecting it. */
    u = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text);
  } catch {
    return "";
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  if (!ALLOWED_HOSTS.includes(registrable(u.hostname))) return "";

  /* Always https on the way out, whatever was pasted in. */
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${u.hostname.toLowerCase()}${path}`;
}

/* A self-reported fundraising total, in whatever shape someone typed it:
   "412.50", "£412.50", "1,240", "412". Returns a number to two decimals, or
   null if it is not a number we should record. Negative and absurd values are
   rejected rather than clamped, because a wrong total silently stored is worse
   than one refused. */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/[£$€\s]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}
