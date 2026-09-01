/* PIN hashing and session tokens. No DB, no dependencies — imported by both the
   real API handlers and the local dev server so the rules can't drift apart. */
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 100000;
const KEYLEN = 32;
export const MAX_FAILS = 5;          /* wrong PINs before a lockout */
export const LOCKOUT_MINUTES = 5;

export function validPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin.trim());
}

export function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pin.trim(), salt, ITERATIONS, KEYLEN, "sha256");
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPin(pin, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  if (typeof pin !== "string") return false;
  const [saltHex, hashHex] = stored.split(":");
  let expected;
  try { expected = Buffer.from(hashHex, "hex"); } catch { return false; }
  const actual = pbkdf2Sync(pin.trim(), Buffer.from(saltHex, "hex"), ITERATIONS, KEYLEN, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken() {
  return randomBytes(24).toString("base64url");
}
