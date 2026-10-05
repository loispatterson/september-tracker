/* Notifications: deciding what to offer, and what to say.

   The browser half of push is three objects deep and untestable without a real
   device, so everything that can be a decision about strings and booleans
   lives here instead, where it can be checked.

   ZERO IMPORTS, like js/challenge.js — scripts/send-push.mjs runs this in node
   from a GitHub Action, so it must not touch window. */

/* What to show on the notifications row, given everything we know. The order
   of these checks is the whole design: each one rules out the ones below it,
   and the first that matches is the only honest thing to say.

     no-key         the deployment has no VAPID key, so nothing can work
     unsupported    an old browser, or one with no push at all
     needs-install  iOS Safari, not yet on the Home Screen. The only route is
                    three manual taps the page cannot trigger
     wrong-browser  Chrome or Firefox on iOS: Safari underneath, but unable to
                    install. Telling these people to tap Share sends them
                    hunting for a menu item that is not there
     blocked        they said no once. The browser will never ask again, so an
                    enable button is a lie — only Settings can undo it
     on / off       the ordinary case

   The button is hidden, not disabled, in every case that cannot work. A
   disabled control reads as the app being broken; absence reads as "not for
   this device", which is the truth. */
export function pushState({
  hasKey = false, supported = false, permission = "default",
  subscribed = false, standalone = false, platform = "other", iosSafari = true,
} = {}) {
  if (!hasKey) return "no-key";
  if (platform === "ios" && !standalone) return iosSafari ? "needs-install" : "wrong-browser";
  if (!supported) return "unsupported";
  if (permission === "denied") return "blocked";
  return subscribed ? "on" : "off";
}

/* The VAPID public key arrives as base64url in JSON and has to reach
   pushManager.subscribe as bytes. Browsers will not do this conversion. */
export function urlBase64ToUint8Array(base64) {
  const s = String(base64 || "");
  const padded = (s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ---- who gets a nudge, and when ----

   Two sends a day at most, and only when there is something to say. A
   notification that arrives on a day someone has already posted teaches them
   to swipe the next one away unread, which costs more than it ever gained.

   Both of these take the day's state and return a list, so the sender does no
   thinking of its own and both rules can be tested against a table. */

/* The evening reminder: everyone who has not posted yet. */
export function needsReminder(people, postedToday) {
  const done = new Set(postedToday);
  return people.filter(p => p.role !== "viewer" && p.notify && !done.has(p.id));
}

/* The late nudge, much narrower: only someone with a run going. Waking a
   person at half nine to tell them they missed a day they were never going to
   post is nagging. Waking someone about to lose eleven days is a favour, and
   they are the only ones who get it.

   Three is the floor because one or two days is not yet a thing worth saving,
   and someone who has posted twice does not think of themselves as on a
   streak. */
export const STREAK_WORTH_SAVING = 3;

export function needsLateNudge(people, postedToday, streaks) {
  return needsReminder(people, postedToday)
    .filter(p => (streaks[p.id] || 0) >= STREAK_WORTH_SAVING);
}

/* How many days in a row, counting back from yesterday. Today is excluded on
   purpose — this is called to decide whether today's gap breaks something, so
   counting today would always return zero and the question would answer
   itself. Dates are 'YYYY-MM-DD', which sort lexically. */
export function streakEndingYesterday(dates, today) {
  const have = new Set(dates);
  let n = 0;
  const d = new Date(`${today}T12:00:00Z`);   /* midday: no DST edge */
  for (;;) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    if (!have.has(key)) return n;
    n++;
    if (n > 400) return n;                    /* a guard, not a real limit */
  }
}

/* What the notification says.

   Written as if a person sent it, because a person did — these go out to
   fifteen people who know each other. "Lola has posted" is a system talking;
   "Lola's up" is someone telling you something.

   No streak numbers in the reminder: being told you are on day 14 the moment
   before you break it is a strange thing to read. The late nudge is the one
   place a number earns its place, because there the number IS the reason. */
export function nudgeText(kind, cfg, { streak = 0, movers = [] } = {}) {
  const thing = cfg && cfg.photoIsTheLog ? "a photo of today's mo" : "today";
  if (kind === "late") {
    return {
      title: `${streak} days — don't stop now`,
      body: `There's still time to post ${thing}.`,
    };
  }
  if (kind === "reminder") {
    const others = movers.filter(Boolean).slice(0, 2);
    const who = others.length === 0 ? ""
      : others.length === 1 ? `${others[0]} has posted. `
      : `${others[0]} and ${others[1]} have posted. `;
    return { title: who ? who.trim() : "Still time", body: `Your turn — post ${thing}.` };
  }
  /* Someone else posted. Only ever sent to people who asked for it, and only
     once an evening however many friends post. */
  return { title: `${movers[0] || "Someone"} is up`, body: "Go and have a look." };
}
