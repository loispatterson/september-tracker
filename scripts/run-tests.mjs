/* Run the browser self-tests plus the node-only auth checks: npm test */
globalThis.window = {};
const { runSelfTests } = await import("../js/selftests.js");
const { hashPin, verifyPin, validPin, newToken } = await import("../api/_lib/auth.js");
const { validatePhoto, newPhotoId, b64Bytes, stripDataUrl, validPhotoDate, MAX_B64 } =
  await import("../api/_lib/photos.js");
const { validEntryDate } = await import("../api/_lib/month.js");
const { challengeFromEnv } = await import("../api/_lib/challenge.js");
const { challengeConfig } = await import("../js/challenge.js");
const { whichDb } = await import("../api/_lib/which-db.mjs");
const { cleanFundraisingUrl, parseAmount } = await import("../api/_lib/fundraising.js");
const { readdirSync, readFileSync } = await import("node:fs");

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

/* ---- fundraising links ----
   The app never touches money, so the only job is making sure a link points
   somewhere a sponsor should actually be sent. */
check("a Movember page", cleanFundraisingUrl("https://uk.movember.com/mospace/14512345"),
  "https://uk.movember.com/mospace/14512345");
check("https is assumed when pasted bare", cleanFundraisingUrl("uk.movember.com/mospace/123"),
  "https://uk.movember.com/mospace/123");
check("tracking is stripped", cleanFundraisingUrl("https://movember.com/m/abc?utm_source=whatsapp"),
  "https://movember.com/m/abc");
check("http is upgraded", cleanFundraisingUrl("http://mobro.co/lois"), "https://mobro.co/lois");
check("JustGiving is allowed too",
  cleanFundraisingUrl("https://www.justgiving.com/fundraising/lois"),
  "https://www.justgiving.com/fundraising/lois");
check("somewhere else is refused", cleanFundraisingUrl("https://evil.com/phish"), "");
/* the one that matters: a lookalike host must not pass */
check("a lookalike host is refused", cleanFundraisingUrl("https://movember.com.evil.com/x"), "");
check("nonsense is refused", cleanFundraisingUrl("not a url"), "");
check("nothing is refused", cleanFundraisingUrl(""), "");

check("a plain amount", parseAmount("412.50"), 412.5);
check("a currency symbol", parseAmount("£412.50"), 412.5);
check("thousands separators", parseAmount("1,240"), 1240);
check("zero is a real total", parseAmount("0"), 0);
check("negative is refused", parseAmount("-5"), null);
check("words are refused", parseAmount("abc"), null);
check("exponent notation is refused", parseAmount("1e9"), null);
check("three decimals are refused", parseAmount("12.345"), null);

/* ---- telling the three databases apart ----
   Two of them are called neondb and the demo shares an endpoint with the live
   board, so neither half identifies them alone. These are the cases that would
   point a seeding or wiping script at the friends' live data. */
{
  const live  = "postgresql://u:p@ep-nameless-silence-abc-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require";
  const demo  = "postgresql://u:p@ep-nameless-silence-abc-pooler.eu-west-2.aws.neon.tech/septdemo?sslmode=require";
  const cairn = "postgresql://u:p@ep-holy-cherry-zao9eayq-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require";
  check("the live board", whichDb(live), "live");
  check("the demo, same endpoint different database", whichDb(demo), "demo");
  check("cairn, same database name different endpoint", whichDb(cairn), "cairn");
  check("anything else is unknown",
    whichDb("postgresql://u:p@ep-somewhere.neon.tech/neondb"), "unknown");
  check("no url is unknown", whichDb(""), "unknown");
}

/* ---- the Vercel Hobby function cap ----
   Every .js file directly in api/ becomes a serverless function, and the free
   plan allows twelve. We are at exactly twelve. A thirteenth makes the deploy
   fail, and it fails quietly: the push errors and the site carries on serving
   the old version. This turns that into a red test instead of a mystery.
   Files starting with _ are excluded by Vercel, which is why api/_lib is free. */
{
  const fns = readdirSync(new URL("../api/", import.meta.url))
    .filter(f => f.endsWith(".js") && !f.startsWith("_"));
  check(`api/ has ${fns.length} functions, Vercel Hobby allows 12`, fns.length <= 12, true);
}

/* ---- consent ----
   The Movember board has no passcode: sponsors have to be able to look without
   an account, so it is a public web page with people's names and faces on it.
   Agreement to that has to be explicit, has to be recorded, and has to be
   enforced by the server rather than by a checkbox anyone can bypass. */
{
  const wellbeing = challengeConfig("wellbeing");
  const movember = challengeConfig("movember");

  check("the friends' board does not ask", wellbeing.consent, null);
  check("Cairn asks participants", typeof movember.consent.participant, "string");
  check("Cairn asks viewers", typeof movember.consent.viewer, "string");

  /* The two lines differ on purpose. A viewer never posts a photo, and telling
     them their photos are public would be a false statement about their own
     data — the opposite of informed. */
  check("the two wordings are not the same",
        movember.consent.participant === movember.consent.viewer, false);
  check("only the participant line mentions photos",
        [/photo/i.test(movember.consent.participant), /photo/i.test(movember.consent.viewer)],
        [true, false]);
  /* Both have to say the thing that matters, which is that it is public. */
  for (const role of ["participant", "viewer"]) {
    check(`the ${role} line says it is public`, /public/i.test(movember.consent[role]), true);
    check(`the ${role} line says anyone with the link`,
          /anyone with the link/i.test(movember.consent[role]), true);
  }
}

/* ---- notifications: who gets one, and what it says ---- */
{
  const { pushState, needsReminder, needsLateNudge, streakEndingYesterday,
          nudgeText, STREAK_WORTH_SAVING } = await import("../js/push.js");

  /* The order of the checks is the design, so the tests walk it in order. */
  const base = { hasKey: true, supported: true, permission: "default",
                 subscribed: false, standalone: false, platform: "other", iosSafari: true };
  check("no VAPID key hides the row", pushState({ ...base, hasKey: false }), "no-key");
  check("iPhone in Safari, not installed, is told to install",
        pushState({ ...base, platform: "ios" }), "needs-install");
  check("iPhone in Chrome is told the browser is wrong",
        pushState({ ...base, platform: "ios", iosSafari: false }), "wrong-browser");
  check("installed iPhone gets the ordinary offer",
        pushState({ ...base, platform: "ios", standalone: true }), "off");
  check("no push support hides the row",
        pushState({ ...base, supported: false }), "unsupported");
  check("a refusal is permanent, and says so",
        pushState({ ...base, permission: "denied" }), "blocked");
  check("subscribed shows as on", pushState({ ...base, subscribed: true }), "on");
  /* The iOS check must come BEFORE the support check: an iPhone that has not
     been installed reports push support and would otherwise be offered a
     button that silently cannot work. */
  check("iOS install beats a missing-support report",
        pushState({ ...base, platform: "ios", supported: false }), "needs-install");

  const people = [
    { id: "a", name: "Ana",  role: "participant", notify: true },
    { id: "b", name: "Bo",   role: "participant", notify: true },
    { id: "c", name: "Cass", role: "participant", notify: false },
    { id: "v", name: "Vi",   role: "viewer",      notify: true },
  ];
  check("nobody who has posted is nudged",
        needsReminder(people, ["a"]).map(p => p.id), ["b"]);
  check("viewers are never nudged — they have nothing to log",
        needsReminder(people, []).some(p => p.role === "viewer"), false);
  check("opting out is honoured",
        needsReminder(people, []).some(p => p.id === "c"), false);

  /* The late nudge is the narrow one: a streak worth losing, or nothing. */
  check("late nudge only where there is a streak to save",
        needsLateNudge(people, [], { a: 9, b: 1 }).map(p => p.id), ["a"]);
  check("a two-day run is not yet a streak",
        needsLateNudge(people, [], { a: STREAK_WORTH_SAVING - 1 }).length, 0);
  check("someone who already posted gets no late nudge either",
        needsLateNudge(people, ["a"], { a: 30 }).length, 0);

  /* Counting back from yesterday, never including today: this is called to
     decide whether today's gap breaks something. */
  check("streak counts back from yesterday",
        streakEndingYesterday(["2026-11-08", "2026-11-09", "2026-11-10"], "2026-11-11"), 3);
  check("today does not count towards it",
        streakEndingYesterday(["2026-11-11"], "2026-11-11"), 0);
  check("a gap ends the streak",
        streakEndingYesterday(["2026-11-05", "2026-11-09", "2026-11-10"], "2026-11-11"), 2);
  check("no history is no streak", streakEndingYesterday([], "2026-11-11"), 0);
  /* Month and year boundaries are where naive date arithmetic breaks. */
  check("a streak crosses the end of a month",
        streakEndingYesterday(["2026-10-30", "2026-10-31", "2026-11-01"], "2026-11-02"), 3);

  const mo = { photoIsTheLog: true };
  check("the late nudge leads with the number it is about",
        nudgeText("late", mo, { streak: 11 }).title, "11 days — don't stop now");
  check("the reminder names who is already up",
        nudgeText("reminder", mo, { movers: ["Ana", "Bo", "Cass"] }).title,
        "Ana and Bo have posted.");
  check("with nobody up yet it still says something",
        nudgeText("reminder", mo, { movers: [] }).title, "Still time");
  check("the wording follows the challenge",
        nudgeText("reminder", { photoIsTheLog: false }, { movers: [] }).body,
        "Your turn — post today.");
}

/* ---- the service worker must never cache ----
   A fetch handler in sw.js would serve a stale index.html, the new build id in
   board.build would never arrive, and the app's own update check would reload
   into the same old page — a phone stuck on a week-old version that refreshing
   cannot fix. The file says so at the top; this makes it true. */
{
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  check("sw.js has no fetch handler", /addEventListener\(\s*["']fetch["']/.test(sw), false);
  check("sw.js opens no cache", /caches\.open|cache\.put/.test(sw), false);
}

/* ---- schema.sql must survive init-db.mjs splitting it on ';' ----
   init-db.mjs splits the file on semicolons and runs each piece. A semicolon
   inside a `--` comment therefore cuts a statement in half, and the second
   half — now missing its `--` — is parsed as SQL. It fails with a syntax error
   pointing at an English word, which gives no clue what happened.

   This was a real bug, written twice. Three comments in schema.sql used a
   semicolon as punctuation and `npm run db:init` would have died on the first
   of them. Rewriting the prose is the fix; this is the guard. */
{
  const sql = readFileSync(new URL("../scripts/schema.sql", import.meta.url), "utf8");
  const offenders = sql.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /^\s*--/.test(line) && line.includes(";"));
  if (offenders.length) {
    for (const [n, line] of offenders) {
      console.error(`  schema.sql:${n} has a ';' in a comment — ${line.trim().slice(0, 60)}`);
    }
  }
  check("no semicolons inside schema.sql comments", offenders.length, 0);
}

/* The server reads the challenge from the environment; the absence of the
   variable has to mean the friends' board, untouched. */
check("no CHALLENGE env means wellbeing", challengeFromEnv({}).id, "wellbeing");
check("CHALLENGE=movember selects it", challengeFromEnv({ CHALLENGE: "movember" }).id, "movember");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
