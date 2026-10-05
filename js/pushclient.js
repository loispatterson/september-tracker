/* The half of push that touches the browser.

   Kept apart from js/push.js so that file stays loadable in node — the sender
   in scripts/send-push.mjs imports the rules from it, and a stray reference to
   navigator at module scope would break the GitHub Action.

   Everything here is best-effort. Push fails for reasons no code can fix: the
   person said no, the browser has no service worker, iOS has not been
   installed to the Home Screen, a corporate profile blocks it. None of that is
   an error worth showing — the app works perfectly without notifications, and
   the row simply stops being offered. */
import { urlBase64ToUint8Array } from "./push.js";

export async function registerWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    /* Scope '/' because sw.js sits at the root. Registering on every load is
       correct and cheap: the browser compares bytes and only installs when the
       file has actually changed. */
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export function pushSupported() {
  return typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export function permission() {
  return (typeof Notification === "undefined") ? "default" : Notification.permission;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/* Ask, then subscribe. Returns the subscription or null — never throws, so the
   caller is a single if.

   requestPermission is a one-shot: a browser that has been told no will resolve
   straight to "denied" without showing anything, forever. That is why the UI
   has a separate 'blocked' state rather than an enable button that does
   nothing when tapped. */
export async function subscribe(vapidPublicKey) {
  if (!pushSupported() || !vapidPublicKey) return null;
  try {
    const granted = await Notification.requestPermission();
    if (granted !== "granted") return null;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    return await reg.pushManager.subscribe({
      /* Required to be true, and only true is allowed: the browser will not
         issue a subscription that might be used for silent background work. */
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  } catch {
    return null;
  }
}

export async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* the row still wants deleting */ }
  return endpoint;
}

/* What the server needs to send to this browser later. The keys come back as
   ArrayBuffers and have to travel as base64url. */
export function serialise(sub) {
  if (!sub) return null;
  const json = sub.toJSON ? sub.toJSON() : sub;
  return {
    endpoint: json.endpoint,
    keys: { p256dh: (json.keys || {}).p256dh, auth: (json.keys || {}).auth },
  };
}
