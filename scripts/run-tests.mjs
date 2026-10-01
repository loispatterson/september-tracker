/* Run the browser self-tests plus the node-only auth checks: npm test */
globalThis.window = {};
const { runSelfTests } = await import("../js/selftests.js");
const { hashPin, verifyPin, validPin, newToken } = await import("../api/_lib/auth.js");
const { validatePhoto, newPhotoId, b64Bytes, stripDataUrl, validPhotoDate, MAX_B64 } =
  await import("../api/_lib/photos.js");
const { validEntryDate } = await import("../api/_lib/month.js");

let { pass, fail } = runSelfTests();
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error("FAIL:", label, "— got", got, "want", want); }
};

check("validPin accepts 4 digits", validPin("0420"), true);
check("validPin trims", validPin(" 1234 "), true);
check("validPin rejects 3 digits", validPin("123"), false);
check("validPin rejects letters", validPin("12a4"), false);
check("validPin rejects non-strings", validPin(1234), false);

const stored = hashPin("1234");
check("hash is salted, not the PIN", stored.includes("1234"), false);
check("correct PIN verifies", verifyPin("1234", stored), true);
check("wrong PIN rejected", verifyPin("1235", stored), false);
check("empty PIN rejected", verifyPin("", stored), false);
check("same PIN hashes differently each time", hashPin("1234") === stored, false);
check("garbage hash rejected", verifyPin("1234", "nonsense"), false);
check("null hash rejected", verifyPin("1234", null), false);

const t1 = newToken(), t2 = newToken();
check("tokens are unique", t1 === t2, false);
check("tokens are long enough", t1.length >= 32, true);

/* ---- photo validation: the server's rules, which the client assumes ---- */
/* The accepted window follows the calendar now, so build the valid date
   from today rather than naming September. */
const thisMonth = new Date().toISOString().slice(0, 7);
const ok = { date: `${thisMonth}-05`, mime: "image/jpeg", b64: "AAAA" };
check("valid photo passes", validatePhoto(ok), null);
check("date outside the window rejected", validatePhoto({ ...ok, date: "2020-01-05" }).status, 400);
check("malformed date rejected", validatePhoto({ ...ok, date: "5th Sept" }).status, 400);
check("unsupported mime rejected", validatePhoto({ ...ok, mime: "image/heic" }).status, 400);
check("missing data rejected", validatePhoto({ ...ok, b64: "" }).status, 400);
check("oversized photo gets 413", validatePhoto({ ...ok, b64: "A".repeat(MAX_B64 + 4) }).status, 413);
/* guards the opaque-500 case: Postgres decode() throws on junk */
check("non-base64 rejected before SQL", validatePhoto({ ...ok, b64: "not base64!!" }).status, 400);
check("padded base64 accepted", validatePhoto({ ...ok, b64: "QUJD=" }), null);

{
  /* a fixed clock, so these assert the rule rather than today's date */
  const now = new Date("2026-10-15T12:00:00Z");
  check("accepts this month", validEntryDate("2026-10-01", now), true);
  check("accepts last month", validEntryDate("2026-09-30", now), true);
  check("rejects older", validEntryDate("2026-08-31", now), false);
  check("rejects next month", validEntryDate("2026-11-01", now), false);
  check("rejects malformed", validEntryDate("5th Oct", now), false);
  /* on the 1st, yesterday is last month — the reason the window is two wide */
  check("backfilling yesterday works on the 1st",
    validEntryDate("2026-10-31", new Date("2026-11-01T00:30:00Z")), true);
}
check("photo ids are prefixed", newPhotoId().startsWith("p_"), true);
check("photo ids are unique", newPhotoId() === newPhotoId(), false);
check("stripDataUrl removes the prefix", stripDataUrl("data:image/jpeg;base64,QUJD"), "QUJD");
check("stripDataUrl passes bare base64 through", stripDataUrl("QUJD"), "QUJD");
for (const s of ["QQ==", "QUI=", "QUJD", "QUJDRA=="]) {
  check(`b64Bytes matches Buffer for ${s}`, b64Bytes(s), Buffer.from(s, "base64").length);
}

/* ---- likes ride along on the board payload ---- */
const { galleryItems } = await import("../js/imageutil.js");
{
  const users = [{ id: "u1", name: "Ada", emoji: "💪" }];
  const rows = [
    { kind: "fun", user_id: "u1", date: "2026-09-02", photo_id: "p1", likes: 3, liked_by_me: true },
    { kind: "fun", user_id: "u1", date: "2026-09-01", photo_id: "p2" },
  ];
  const [a, b] = galleryItems(rows, users);
  check("gallery carries the like count", a.likes, 3);
  check("gallery carries whether I liked it", a.likedByMe, true);
  /* A photo nobody has liked comes back with the columns absent rather than
     zero, and the UI must not render "NaN" or "undefined" over the picture. */
  check("no likes means zero, not undefined", b.likes, 0);
  check("no likes means not liked by me", b.likedByMe, false);
}

/* ---- board ranking ---- */
{
  /* Mirrors boardOrder() in js/app.js: most days first, then current streak,
     then best streak, then name, so the order cannot flip between refreshes
     when two people are level. */
  const order = (rows) => rows.slice().sort((a, b) =>
    b.total - a.total || b.cur - a.cur || b.best - a.best || a.name.localeCompare(b.name))
    .map(r => r.name);

  check("most logged days comes first",
    order([{ name: "Ada", total: 4, cur: 1, best: 2 },
           { name: "Bo",  total: 9, cur: 1, best: 2 }]), ["Bo", "Ada"]);
  check("a tie on days breaks on the current streak",
    order([{ name: "Ada", total: 9, cur: 1, best: 9 },
           { name: "Bo",  total: 9, cur: 5, best: 5 }]), ["Bo", "Ada"]);
  check("a tie on days and streak breaks on the best streak",
    order([{ name: "Ada", total: 9, cur: 2, best: 3 },
           { name: "Bo",  total: 9, cur: 2, best: 7 }]), ["Bo", "Ada"]);
  check("fully level people sort by name, so the order never flips",
    order([{ name: "Zoe", total: 5, cur: 2, best: 3 },
           { name: "Ada", total: 5, cur: 2, best: 3 }]), ["Ada", "Zoe"]);
  check("nobody logged yet still gives a stable order",
    order([{ name: "Bo", total: 0, cur: 0, best: 0 },
           { name: "Ada", total: 0, cur: 0, best: 0 }]), ["Ada", "Bo"]);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
