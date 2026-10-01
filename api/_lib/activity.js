/* Tidying free-text activity names.

   "Other…" lets people type anything, which is the point — hockey, moved
   stones, walking around tile shops. The cost is near-duplicates: "Body Pump"
   and "Body pump" are the same thing to everyone except a GROUP BY, and once
   the chip list is built from what you have logged, you get both buttons.

   Two rules, both deliberately conservative. Whitespace is collapsed, which
   is always safe. Case is reconciled against what this person has already
   used, so their second "body pump" becomes "Body Pump" rather than a new
   row — reusing their own casing rather than imposing a house style.

   Singular and plural are NOT merged automatically. "Building work" and
   "Building works" are the same activity; "Run" and "Runs" might be, but
   "Press" and "Press-ups" are not, and a rule that guesses will eventually
   merge two things someone meant to keep apart. Those are handled as one-off
   data fixes instead. */

export function cleanActivity(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/* `known` is what this person has logged before, in their own casing. */
export function reconcileActivity(raw, known = []) {
  const name = cleanActivity(raw);
  if (!name) return "";
  const hit = known.find(k => cleanActivity(k).toLowerCase() === name.toLowerCase());
  return hit ? cleanActivity(hit) : name;
}

/* Fold a list of {activity, n} rows so case variants count as one, keeping
   the spelling that was used most. */
export function foldActivityCounts(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const name = cleanActivity(r.activity);
    if (!name) continue;
    const k = name.toLowerCase();
    const n = Number(r.n) || 0;
    const prev = by.get(k);
    /* `top` has to be set on the first one too, or the winner is whichever
       spelling happened to arrive first rather than the one used most. */
    if (!prev) by.set(k, { activity: name, n, top: n });
    else {
      prev.n += n;
      if (n > prev.top) { prev.activity = name; prev.top = n; }
    }
  }
  return [...by.values()]
    .map(({ activity, n }) => ({ activity, n }))
    .sort((a, b) => b.n - a.n || a.activity.localeCompare(b.activity));
}
