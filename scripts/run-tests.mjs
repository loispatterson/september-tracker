/* Run the browser self-tests plus the node-only auth checks: npm test */
globalThis.window = {};
const { runSelfTests } = await import("../js/selftests.js");
const { hashPin, verifyPin, validPin, newToken } = await import("../api/_lib/auth.js");
const { validatePhoto, newPhotoId, b64Bytes, stripDataUrl, validPhotoDate, MAX_B64 } =
  await import("../api/_lib/photos.js");

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
const ok = { date: "2026-09-05", mime: "image/jpeg", b64: "AAAA" };
check("valid photo passes", validatePhoto(ok), null);
check("date outside September rejected", validatePhoto({ ...ok, date: "2026-10-01" }).status, 400);
check("malformed date rejected", validatePhoto({ ...ok, date: "5th Sept" }).status, 400);
check("unsupported mime rejected", validatePhoto({ ...ok, mime: "image/heic" }).status, 400);
check("missing data rejected", validatePhoto({ ...ok, b64: "" }).status, 400);
check("oversized photo gets 413", validatePhoto({ ...ok, b64: "A".repeat(MAX_B64 + 4) }).status, 413);
/* guards the opaque-500 case: Postgres decode() throws on junk */
check("non-base64 rejected before SQL", validatePhoto({ ...ok, b64: "not base64!!" }).status, 400);
check("padded base64 accepted", validatePhoto({ ...ok, b64: "QUJD=" }), null);

check("validPhotoDate boundaries", [validPhotoDate("2026-09-01"), validPhotoDate("2026-09-30"),
  validPhotoDate("2026-08-31"), validPhotoDate("2026-10-01")], [true, true, false, false]);
check("photo ids are prefixed", newPhotoId().startsWith("p_"), true);
check("photo ids are unique", newPhotoId() === newPhotoId(), false);
check("stripDataUrl removes the prefix", stripDataUrl("data:image/jpeg;base64,QUJD"), "QUJD");
check("stripDataUrl passes bare base64 through", stripDataUrl("QUJD"), "QUJD");
for (const s of ["QQ==", "QUI=", "QUJD", "QUJDRA=="]) {
  check(`b64Bytes matches Buffer for ${s}`, b64Bytes(s), Buffer.from(s, "base64").length);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
