/* Run the browser self-tests plus the node-only auth checks: npm test */
globalThis.window = {};
const { runSelfTests } = await import("../js/selftests.js");
const { hashPin, verifyPin, validPin, newToken } = await import("../api/_lib/auth.js");

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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
