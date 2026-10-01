/* Date helpers — local time, YYYY-MM-DD strings (lexically comparable).
   Ported from habit-tracker. */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June",
                    "July","August","September","October","November","December"];

export function pad2(n) { return String(n).padStart(2, "0"); }
export function fmtDate(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
export function parseDate(ds) { const [y, m, d] = ds.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(ds, n) { const d = parseDate(ds); d.setDate(d.getDate() + n); return fmtDate(d); }
export function dow(ds) { return parseDate(ds).getDay(); }
export function prettyDate(ds) {
  const d = parseDate(ds);
  return DAY_NAMES[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()];
}
/* Override in devtools to time-travel: window.TODAY_OVERRIDE = "2026-10-05" */
window.TODAY_OVERRIDE = window.TODAY_OVERRIDE || null;
export function todayStr() { return window.TODAY_OVERRIDE || fmtDate(new Date()); }

/* ---------- the current month ----------

   The challenge used to be a fixed September window. It now follows the
   calendar, so on the 1st everyone starts a clean grid and the streaks begin
   again from zero — that falls out of the window moving rather than needing
   anything reset, because every streak is counted inside the month.

   Everything derives from todayStr(), so TODAY_OVERRIDE still time-travels the
   whole app, and nothing needs redeploying when the month turns. */
export function monthOf(ds) { return ds.slice(0, 7); }            /* 'YYYY-MM' */
export function monthStart(ds = todayStr()) { return monthOf(ds) + "-01"; }
export function monthEnd(ds = todayStr()) {
  const [y, m] = ds.split("-").map(Number);
  return fmtDate(new Date(y, m, 0));            /* day 0 of next month = last of this */
}
export function monthLength(ds = todayStr()) { return Number(monthEnd(ds).slice(8)); }
export function monthName(ds = todayStr()) { return MONTH_FULL[Number(ds.slice(5, 7)) - 1]; }

/* Step a 'YYYY-MM' back or forward. */
export function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

export function monthDates(ds = todayStr()) {
  const out = [], end = monthEnd(ds);
  for (let d = monthStart(ds); d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
/* 1-based day number within its own month, or null if the date is outside the
   month we are currently showing. */
export function monthDayNum(ds, ref = todayStr()) {
  return monthOf(ds) === monthOf(ref) ? Number(ds.slice(8)) : null;
}
