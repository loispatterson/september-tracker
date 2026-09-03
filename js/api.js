/* Thin fetch client. The board passcode and (once claimed) the personal
   session token ride along as headers. */
const PASS_KEY = "septTracker.passcode";
const TOKEN_KEY = "septTracker.token";

export function getPasscode() { return localStorage.getItem(PASS_KEY) || ""; }
export function setPasscode(p) { localStorage.setItem(PASS_KEY, p); }
export function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

class ApiError extends Error {
  constructor(status, body) {
    super(body.error || "request failed");
    this.status = status;
    this.code = body.error;
    this.body = body;
  }
}

async function request(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      "x-passcode": getPasscode(),
      "x-user-token": getToken(),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  getBoard: () => request("/api/board"),
  getMe: () => request("/api/me"),
  demoLogin: () => post("/api/demo", {}),
  suggest: (date) => post("/api/suggest", { date }),
  createUser: (profile) => post("/api/users", profile),
  updateUser: (patch) => request("/api/users", { method: "PATCH", body: JSON.stringify(patch) }),
  claim: (userId, pin) => post("/api/claim", { userId, pin }),
  changePin: (currentPin, newPin) => post("/api/pin", { currentPin, newPin }),
  saveEntry: (entry) => post("/api/log", entry),
  addFunIdea: (text) => post("/api/fun-ideas", { text }),
  uploadPhoto: (photo) => post("/api/photo", photo),
  deletePhoto: (date) => request(`/api/photo?date=${encodeURIComponent(date)}`, { method: "DELETE" }),
};

/* Photo bytes come back as a blob, not JSON, and the passcode travels in a
   header — so the image can't be a plain <img src> and needs this fetch. */
export async function fetchPhotoBlob(id) {
  const res = await fetch(`/api/photo?id=${encodeURIComponent(id)}`, {
    headers: { "x-passcode": getPasscode(), "x-user-token": getToken() },
  });
  if (!res.ok) throw new ApiError(res.status, {});
  return res.blob();
}

/* 401 means two different things: the board passcode is wrong, or this
   device's session is no longer valid. They need different recoveries. */
export function isPasscodeError(e) { return e instanceof ApiError && e.status === 401 && e.code === "passcode"; }
export function isAuthError(e) { return e instanceof ApiError && e.status === 401 && e.code === "auth"; }
export function isNameTaken(e) { return e instanceof ApiError && e.status === 409; }
export function errorMessage(e) { return e instanceof ApiError ? e.message : "Something went wrong"; }
