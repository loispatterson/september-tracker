/* Date helpers — local time, YYYY-MM-DD strings (lexically comparable).
   Ported from habit-tracker. */
export const SEPT_START = "2026-09-01";
export const SEPT_END = "2026-09-30";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function pad2(n) { return String(n).padStart(2, "0"); }
export function fmtDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
export function parseDate(ds) { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(ds, n) { const d = parseDate(ds); d.setDate(d.getDate() + n); return fmtDate(d); }
export function dow(ds) { return parseDate(ds).getDay(); }
export function prettyDate(ds) {
  const d = parseDate(ds);
  return DAY_NAMES[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()];
}
/* Override in devtools to time-travel: window.TODAY_OVERRIDE = "2026-09-05" */
window.TODAY_OVERRIDE = window.TODAY_OVERRIDE || null;
export function todayStr() { return window.TODAY_OVERRIDE || fmtDate(new Date()); }

export function septDates() {
  const out = [];
  for (let ds = SEPT_START; ds <= SEPT_END; ds = addDays(ds, 1)) out.push(ds);
  return out;
}
/* 1-based day number within September, or null outside it */
export function septDayNum(ds) {
  return ds >= SEPT_START && ds <= SEPT_END ? Number(ds.slice(8)) : null;
}
