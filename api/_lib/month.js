/* The month the server will accept writes for.

   Dates are compared as 'YYYY-MM-DD' strings, so the whole check is a prefix
   match. Server time is UTC on Vercel; everyone using this is in Europe, so on
   the 1st there is at most an hour where a phone says October and the server
   still says September. Rather than reject that, the window is the current
   month plus the one before it: backfilling yesterday has always been allowed,
   and on the 1st yesterday is last month. */
export function currentMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}
export function previousMonth(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
export function validEntryDate(date, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const m = date.slice(0, 7);
  return m === currentMonth(now) || m === previousMonth(now);
}
export const ENTRY_DATE_ERROR = "date must be in the current month";
