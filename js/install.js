/* Getting the app onto a home screen.

   This matters more than it looks: iOS will only deliver web push to a site
   that has been added to the Home Screen and opened from that icon. There is
   no prompt we can trigger and no API to ask — the person has to tap Share,
   then Add to Home Screen, themselves. So the only thing we can do is explain
   it clearly, to the right people, at a moment they care.

   Android is the opposite: Chrome fires beforeinstallprompt and will show a
   real install dialog on request, and push works in a plain tab anyway.

   The pure half lives here so it can be tested; the half that touches
   navigator is marked and kept thin. */

export const PLATFORM = { IOS: "ios", ANDROID: "android", OTHER: "other" };

/* iPadOS reports itself as a Mac, and the only reliable tell is that it has a
   touchscreen. Checking maxTouchPoints is the usual workaround. */
export function platformOf(ua = "", maxTouchPoints = 0) {
  const s = String(ua);
  if (/iPhone|iPod/.test(s)) return PLATFORM.IOS;
  if (/iPad/.test(s)) return PLATFORM.IOS;
  if (/Macintosh/.test(s) && maxTouchPoints > 1) return PLATFORM.IOS;
  if (/Android/.test(s)) return PLATFORM.ANDROID;
  return PLATFORM.OTHER;
}

/* Safari on iOS is the only browser that can install to the Home Screen.
   Chrome and Firefox on iOS are Safari underneath but cannot do it, and
   telling a Chrome-on-iPhone user to tap Share sends them on a wild goose
   chase, so they get told to open it in Safari instead. */
export function isIosSafari(ua = "") {
  const s = String(ua);
  return /Safari/.test(s) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(s);
}

/* What to show someone, given where they are. */
export function installState({ platform, standalone, canPrompt, iosSafari }) {
  if (standalone) return "installed";
  if (platform === PLATFORM.IOS) return iosSafari ? "ios-steps" : "ios-wrong-browser";
  if (canPrompt) return "can-prompt";
  return "other";
}

/* Already running from a home-screen icon? Two checks, because iOS uses its
   own non-standard flag and everyone else uses the media query. */
export function isStandalone(win = typeof window === "undefined" ? null : window) {
  if (!win) return false;
  if (win.navigator && win.navigator.standalone) return true;
  return !!(win.matchMedia && win.matchMedia("(display-mode: standalone)").matches);
}

export function detect(win = typeof window === "undefined" ? null : window) {
  const nav = (win && win.navigator) || {};
  const ua = nav.userAgent || "";
  return {
    platform: platformOf(ua, nav.maxTouchPoints || 0),
    standalone: isStandalone(win),
    iosSafari: isIosSafari(ua),
  };
}
