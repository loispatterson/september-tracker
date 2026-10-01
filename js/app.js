import { api, setPasscode, setToken, clearToken, isPasscodeError, isAuthError,
         isNameTaken, errorMessage } from "./api.js";
import { todayStr, prettyDate, monthDates, monthDayNum, monthStart, monthEnd,
         monthName, monthLength, addDays } from "./dates.js";
import { currentStreak, bestStreak, totalHits, dayResult, HIT, MISS, PENDING } from "./streaks.js";
import { getSuggestions, getAiSuggestions, aiAvailable } from "./suggestions.js";
import { funPromptFor } from "./fun.js";
import { AGE_BANDS, GOALS, FITNESS, FEELINGS, isLegacyBand } from "./profile.js";
import { orderedActivities, buildLogs, minutesOf, prettyMinutes, describeEntry, totalMinutes,
         feelingLabel, DEFAULT_MINUTES } from "./logs.js";
import { galleryItems } from "./imageutil.js";
import { prepareUpload, blobToBase64, hydratePhotos, forgetPhoto, cachedUrl } from "./photos.js";

const ME_KEY = "septTracker.me";

const EMOJIS = ["💪", "🏃", "🚴", "🧘", "🏊", "⚡", "🔥", "🌟", "🐝", "🦊", "🐙", "🦕"];

/* ---------- state ---------- */
let board = { users: [], entries: [], funIdeas: [] };
let me = null;                    /* { id, name } from localStorage */
let exLog = {}, funLog = {}, photoLog = {};   /* log[date][userId] = entry */
let suggestions = [];
let aiSuggestions = null;   /* Claude's, once they arrive */
let aiAsked = false, aiBusy = false;

/* ephemeral UI state — never persisted */
const ui = {
  tab: "today",
  viewDate: null,                 /* the day the Today tab is showing; null = today */
  needPasscode: false,
  offline: false,                 /* board unreachable — show a real message */
  splashDone: false,              /* demo: visitor has chosen from the splash */
  demoBusy: false,
  onboardStep: "who",             /* who | new | pin */
  claiming: null,                 /* user being claimed, awaiting their PIN */
  draft: { name: "", emoji: "💪", ageBand: "", goals: [], fitness: "", note: "", pin: "" },
  changingPin: false,
  showSuggestions: false,
  funSwap: 0,
  funOwn: false,
  thread: null,                   /* { owner, date, comments, loading, busy, error } */
  summary: null,                  /* { months, totals } once the Progress tab is opened */
  exOther: false,                 /* "Other…" free-text entry is open */
  customMinutes: false,           /* typing a duration the chips don't cover */
  cell: null,                     /* { userId, date } open popover */
  loading: true,
  photoTarget: null,              /* date the picker was opened for */
  photoDraft: null,               /* { date, blob, previewUrl, w, h, bytes } */
  photoBusy: false,
  photoError: "",
  lightbox: null,                 /* { photoId, name, emoji, date, activity } */
  galleryUser: null,              /* gallery filter, null = everyone */
  confirmFunClear: null,          /* date awaiting "this deletes your photo" */
};

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}
function getUser(id) { return board.users.find(u => u.id === id); }
/* True on the public demo deployment, where there is no passcode and anyone
   can take a look. Assumed false until the board says otherwise. */
function isDemo() { return board.demo === true || window.DEMO_SPLASH === true; }
/* The private half of your own profile, from /api/me — the board deliberately
   doesn't carry age, goals, fitness level or notes for anyone. */
let myPrivate = null;
function myProfile() {
  const u = me && getUser(me.id);
  if (!u) return null;
  return {
    id: u.id, name: u.name, emoji: u.emoji,
    ageBand: myPrivate ? myPrivate.ageBand : "",
    goals: myPrivate ? myPrivate.goals : [],
    fitness: myPrivate ? myPrivate.fitness : "",
    note: myPrivate ? myPrivate.note : "",
  };
}

async function loadMyProfile() {
  if (!me) { myPrivate = null; return; }
  try { myPrivate = await api.getMe(); }
  catch (e) { if (isAuthError(e)) return signedOut(); myPrivate = null; }
}
function entryFor(log, ds, userId) { return (log[ds] && log[ds][userId]) || null; }

/* The day the Today tab is showing. Clamped into this month and never ahead of
   today, so you can catch up on a day you missed but not log the future. */
function viewDate() {
  const t = todayStr();
  const d = ui.viewDate || t;
  if (d < monthStart()) return monthStart();
  if (d > t || d > monthEnd()) return t <= monthEnd() ? t : monthEnd();
  return d;
}

const MINUTE_OPTIONS = [30, 45, 60, 90];

function rebuildLogs() {
  ({ exLog, funLog, photoLog } = buildLogs(board.entries));
}

/* ---------- data ---------- */
/* The build this tab loaded. If the board starts reporting a different one,
   a new version has been deployed and this tab is running stale code. */
let loadedBuild = null;

async function refresh() {
  try {
    board = await api.getBoard();
    if (loadedBuild === null) loadedBuild = board.build || null;
    else if (board.build && board.build !== loadedBuild) return updateAvailable();
    ui.needPasscode = false;
    ui.offline = false;
    rebuildLogs();
  } catch (e) {
    if (isPasscodeError(e)) { ui.needPasscode = true; ui.offline = false; }
    else { console.error(e); ui.offline = true; }
  } finally {
    ui.loading = false;
  }
}

/* Optimistic write: update local state, render, then persist and reconcile. */
async function saveEntry({ date, kind, done, activity, note, minutes, distanceKm, feeling }) {
  const local = { user_id: me.id, date, kind, done,
    activity: activity || null, note: note || null,
    minutes: minutes == null ? null : minutes,
    distance_km: distanceKm == null ? null : distanceKm,
    feeling: feeling || null };
  board.entries = board.entries.filter(e => !(e.user_id === me.id && e.date === date && e.kind === kind));
  if (done !== null) board.entries.push(local);
  rebuildLogs();
  render();
  try {
    await api.saveEntry({ date, kind, done, activity, note, minutes, distanceKm, feeling });
    await refresh();
    render();
  } catch (e) {
    console.error(e);
    if (isAuthError(e)) return signedOut();
    toast("Couldn't save that — put back as it was");
    await refresh();   /* drop the optimistic edit rather than showing a lie */
    render();
  }
}

/* A newer version is deployed. Don't yank the page out from under someone
   mid-upload; otherwise reload so nobody is quietly using an old app. */
let updatePending = false;
function updateAvailable() {
  if (updatePending) return;
  updatePending = true;
  if (ui.photoBusy || ui.photoDraft || ui.exOther || ui.funOwn) {
    toast("An update is ready — finish this and it'll refresh");
    return;
  }
  toast("Updating to the newest version…");
  setTimeout(() => location.reload(), 1200);
}

/* This device's session is no longer valid — back to the name list. */
function signedOut() {
  clearToken();
  localStorage.removeItem(ME_KEY);
  me = null;
  ui.onboardStep = "who";
  ui.claiming = null;
  toast("Signed out — pick your name and enter your PIN");
  render();
}

/* ---------- onboarding ---------- */

/* The demo deployment opens on this: say what the thing is before asking
   anyone to do anything. Rendered from the first paint, so it is on screen
   while the board is still loading. */
function renderSplash() {
  return `<div class="onboard splash">
    <h2>${monthName()} Tracker</h2>
    <p>30 minutes of exercise and one fun thing, every day of ${monthName()},
       tracked with your friends on a shared board.</p>
    <ul class="splash-list">
      <li>💪 Log what you did, how long it took and how it felt</li>
      <li>🎉 A different fun idea every day, or bring your own</li>
      <li>📸 Add a photo, and a gallery builds up over the month</li>
      <li>🔥 Streaks for exercise, fun and photos</li>
      <li>🤖 Workout suggestions tuned to your age, goals and fitness</li>
    </ul>
    <button class="btn primary big" data-action="demo-login" ${ui.demoBusy ? "disabled" : ""}>
      ${ui.demoBusy ? "Setting up…" : "Have a look around"}</button>
    <p class="small muted">Opens a throwaway account with a few days already
      filled in. Nothing you do here affects anyone else.</p>
    <button class="btn big" data-action="splash-signup">Create an account</button>
    <p class="small muted">This is a public demo, so please don't put anything
      private in it. The real thing lives on a private board.</p>
  </div>`;
}

function renderOnboard() {
  if (ui.offline) {
    return `<div class="onboard">
      <h2>Can't reach the board</h2>
      <p class="muted small">The tracker is up but the board isn't answering.
        Nothing you've logged is lost — try again in a moment.</p>
      <button class="btn primary big" data-action="retry">Try again</button>
    </div>`;
  }

  if (ui.needPasscode) {
    return `<div class="onboard">
      <h2>This board is private</h2>
      <p class="muted small">Enter the passcode Loïs shared with you.</p>
      <div class="field"><input type="text" id="passcode-input" placeholder="passcode" autocomplete="off"></div>
      <button class="btn primary big" data-action="submit-passcode">Enter</button>
    </div>`;
  }

  if (ui.onboardStep === "new") {
    const d = ui.draft;
    return `<div class="onboard">
      <h2>Set up your profile</h2>
      <div class="field">
        <label>Your name</label>
        <input type="text" id="name-input" value="${esc(d.name)}" placeholder="e.g. Loïs" autocomplete="off">
      </div>
      <div class="field">
        <label>Pick an avatar</label>
        <div class="chips">${EMOJIS.map(e =>
          `<button class="chip ${d.emoji === e ? "on" : ""}" data-action="draft" data-key="emoji" data-val="${e}">${e}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Age band <span class="muted">(tunes workout intensity)</span></label>
        <div class="chips">${AGE_BANDS.map(([v, l]) =>
          `<button class="chip ${d.ageBand === v ? "on" : ""}" data-action="draft" data-key="ageBand" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Current fitness <span class="muted">(be honest, it only tunes suggestions)</span></label>
        <div class="chips">${FITNESS.map(([v, l]) =>
          `<button class="chip ${d.fitness === v ? "on" : ""}" data-action="draft" data-key="fitness" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Goals <span class="muted">(pick as many as you like)</span></label>
        <div class="chips">${GOALS.map(([v, l]) =>
          `<button class="chip ${(d.goals || []).includes(v) ? "on" : ""}" data-action="draft-goal" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Anything else? <span class="muted">(optional)</span></label>
        <input type="text" id="note-input" value="${esc(d.note || "")}"
               placeholder="e.g. dodgy knee, no gym, back after time off" autocomplete="off">
        <p class="small muted">Only you can see this. It's used to tailor your workout suggestions.</p>
      </div>
      <div class="field">
        <label>Choose a 4-digit PIN <span class="muted">(so only you can log as you)</span></label>
        <input type="text" id="pin-input" inputmode="numeric" maxlength="4"
               value="${esc(d.pin || "")}" placeholder="••••" autocomplete="off">
      </div>
      <button class="btn primary big" data-action="create-user">Start ${monthName()}</button>
      <p><button class="btn ghost small" data-action="onboard-step" data-val="who">← back</button></p>
    </div>`;
  }

  if (ui.onboardStep === "pin" && ui.claiming) {
    const u = ui.claiming;
    const fresh = u.has_pin === false;   /* joined before PINs existed */
    return `<div class="onboard">
      <h2>${u.emoji} ${esc(u.name)}</h2>
      <p class="muted small">${fresh
        ? "Choose a 4-digit PIN now — you'll use it to log in on any other device."
        : "Enter your 4-digit PIN to log in on this device."}</p>
      <div class="field">
        <input type="text" id="claim-pin-input" inputmode="numeric" maxlength="4"
               placeholder="••••" autocomplete="off">
      </div>
      <button class="btn primary big" data-action="submit-claim">Continue</button>
      <p><button class="btn ghost small" data-action="onboard-step" data-val="who">← not me</button></p>
    </div>`;
  }

  return `<div class="onboard">
    <h2>Who are you?</h2>
    <p class="muted small">30 minutes of exercise + one fun thing, every day of ${monthName()}.</p>
    <div class="members">
      ${board.users.map(u =>
        `<button class="btn" data-action="claim" data-id="${u.id}">${u.emoji} ${esc(u.name)}</button>`).join("")}
    </div>
    <button class="btn primary big" data-action="onboard-step" data-val="new">I'm new — set me up</button>
  </div>`;
}

/* ---------- today ---------- */
function renderToday() {
  const today = viewDate();
  const realToday = todayStr();
  const p = myProfile();
  if (!p) return "";
  const ex = entryFor(exLog, today, me.id);
  const fun = entryFor(funLog, today, me.id);

  /* --- exercise card --- */
  let exHtml;
  if (ex && ex.done) {
    exHtml = `<div class="done-banner">
        <span>✅ ${esc(describeEntry(ex))}${ex.feeling ? ` · felt ${esc(feelingLabel(ex.feeling))}` : ""}</span>
        <button class="btn small" data-action="undo-ex">Undo</button>
      </div>
      ${ex.note ? `<p class="small muted">${esc(ex.note)}</p>` : ""}
      <div class="field">
        <label>How was it?</label>
        <div class="chips">${FEELINGS.map(([v, l]) =>
          `<button class="chip ${ex.feeling === v ? "on" : ""}" data-action="set-feeling" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>How long?</label>
        <div class="chips">${MINUTE_OPTIONS.map(m =>
          `<button class="chip ${minutesOf(ex) === m ? "on" : ""}" data-action="set-minutes" data-val="${m}">${prettyMinutes(m)}</button>`).join("")}
          <button class="chip ${ui.customMinutes ? "on" : ""}" data-action="toggle-custom-minutes">More…</button>
        </div>
        ${ui.customMinutes ? `<div class="actions">
          <input type="text" id="minutes-input" inputmode="numeric" style="max-width:7em"
                 value="${minutesOf(ex)}" placeholder="minutes" autocomplete="off">
          <button class="btn small" data-action="save-minutes">Set</button>
        </div>` : ""}
      </div>
      <div class="field">
        <label>Distance <span class="muted">(optional, km)</span></label>
        <div class="actions">
          <input type="text" id="distance-input" inputmode="decimal" style="max-width:7em"
                 value="${ex.distance_km == null ? "" : Number(ex.distance_km)}" placeholder="e.g. 6.2" autocomplete="off">
          <button class="btn small" data-action="save-distance">Save</button>
        </div>
      </div>`;
  } else if (ui.exOther) {
    exHtml = `<div class="field">
        <label>What did you do?</label>
        <input type="text" id="ex-other-input" placeholder="e.g. Bouldering, horse riding, 4h hike" autocomplete="off">
      </div>
      <div class="actions">
        <button class="btn primary" data-action="log-ex-other">Log it</button>
        <button class="btn ghost" data-action="toggle-ex-other">Cancel</button>
      </div>`;
  } else {
    exHtml = `<div class="chips">
        ${orderedActivities(board.myActivities).map(a => a === "Other"
          ? `<button class="chip" data-action="toggle-ex-other">Other…</button>`
          : `<button class="chip" data-action="log-ex" data-activity="${esc(a)}">${esc(a)}</button>`).join("")}
      </div>
      <p class="small muted">Tap what you did — that logs 30 minutes, and you can
        change the time or add a distance afterwards.</p>
      <button class="btn ghost small" data-action="toggle-suggestions">${ui.showSuggestions ? "Hide ideas" : "Need an idea?"}</button>
      ${ui.showSuggestions && aiBusy ? `<p class="small muted">Tailoring these to you…</p>` : ""}
      ${ui.showSuggestions && aiSuggestions ? `<p class="small muted">Written for you today.</p>` : ""}
      ${ui.showSuggestions ? suggestions.map(w => `
        <div class="suggestion">
          <div>
            <b>${esc(w.title)}</b>
            <span class="meta">${esc(w.goal)} · ${esc(w.intensity)} intensity</span>
            <div class="small">${esc(w.desc)}</div>
          </div>
          <button class="btn small" data-action="log-ex" data-activity="${esc(w.title)}">Log this</button>
        </div>`).join("") : ""}`;
  }

  /* --- fun card --- */
  const prompt = funPromptFor(me.id, today, board.funIdeas, ui.funSwap);
  let funHtml;
  if (fun && fun.done) {
    const clearing = ui.confirmFunClear === today;
    funHtml = `<div class="done-banner fun">
        <span>🎉 ${esc(fun.activity || "Something fun")}</span>
        ${clearing ? "" : `<button class="btn small" data-action="undo-fun">Undo</button>`}
      </div>
      ${clearing ? `<div class="photo-error">
          ⚠️ Undoing this also deletes today's photo.
          <div class="actions">
            <button class="btn small" data-action="undo-fun-confirm">Undo and delete photo</button>
            <button class="btn small ghost" data-action="undo-fun-cancel">Keep it</button>
          </div>
        </div>` : ""}
      ${fun.note ? `<p class="small muted">${esc(fun.note)}</p>` : ""}
      ${photoSection(today, fun)}`;
  } else if (ui.funOwn) {
    funHtml = `<div class="field">
        <label>What did you do (or plan to do)?</label>
        <input type="text" id="fun-own-input" placeholder="Your own fun thing" autocomplete="off">
      </div>
      <label class="small"><input type="checkbox" id="fun-share"> Add it to the shared idea pool</label>
      <div class="actions">
        <button class="btn primary" data-action="log-fun-own">Log it</button>
        <button class="btn ghost" data-action="toggle-fun-own">Cancel</button>
      </div>`;
  } else {
    funHtml = `<p style="font-size:17px;margin:4px 0 12px">${esc(prompt)}</p>
      <div class="actions">
        <button class="btn good" data-action="log-fun" data-text="${esc(prompt)}">Did it 🎉</button>
        <button class="btn ghost" data-action="swap-fun">Swap idea</button>
        <button class="btn ghost" data-action="toggle-fun-own">My own idea</button>
      </div>
      ${photoSection(today, null)}`;
  }

  /* --- friends strip --- */
  const friends = board.users.map(u => {
    const e = entryFor(exLog, today, u.id), f = entryFor(funLog, today, u.id);
    return `<div class="friend-row">
      <span>${u.emoji}</span>
      <span class="name">${esc(u.name)}${u.id === me.id ? " <span class='muted small'>(you)</span>" : ""}</span>
      ${e && e.done ? `<span class="small muted">${esc(prettyMinutes(minutesOf(e)))}</span>` : ""}
      <span class="marks">${e && e.done ? "✅" : "⬜"}${f && f.done ? "🎉" : "⬜"}</span>
    </div>`;
  }).join("");

  const canGoBack = today > monthStart();
  const canGoForward = today < realToday;
  const dayNav = `<div class="daynav">
      <button class="btn small ghost" data-action="day-back" ${canGoBack ? "" : "disabled"}>←</button>
      <span>${today === realToday ? "Today" : esc(prettyDate(today))}</span>
      <button class="btn small ghost" data-action="day-forward" ${canGoForward ? "" : "disabled"}>→</button>
    </div>
    ${today !== realToday ? `<p class="small muted">Catching up on ${esc(prettyDate(today))}.
      <button class="btn ghost small" data-action="day-today">Back to today</button></p>` : ""}`;

  return `
    ${dayNav}
    <div class="card">
      <h2>💪 30 minutes of exercise</h2>
      ${exHtml}
    </div>
    <div class="card">
      <h2>🎉 Something fun</h2>
      ${funHtml}
    </div>
    <div class="card">
      <h2>Everyone today</h2>
      <div class="friends">${friends}</div>
      <p class="small muted" style="margin-bottom:0">✅ exercise · 🎉 fun</p>
    </div>`;
}

/* ---------- photos ---------- */

/* The photo control under the fun card: add, preview-before-upload,
   uploading, or the photo you already have. */
function photoSection(ds, fun, opts = {}) {
  const draft = ui.photoDraft && ui.photoDraft.date === ds ? ui.photoDraft : null;
  const photoId = fun && fun.photo_id;
  const err = ui.photoError ? `<div class="photo-error">${esc(ui.photoError)}</div>` : "";

  if (ui.photoBusy && ui.photoTarget === ds) {
    return `${err}<div class="photo-wrap">
      ${draft ? `<img class="photo-thumb uploading" src="${draft.previewUrl}" alt="">` : ""}
      <p class="photo-meta">Uploading…</p>
    </div>`;
  }

  if (draft) {
    return `${err}<div class="photo-wrap">
      <img class="photo-thumb" src="${draft.previewUrl}" alt="">
      <p class="photo-meta">${Math.round(draft.bytes / 1024)} KB, ${draft.w}×${draft.h}</p>
      <div class="actions">
        <button class="btn primary" data-action="photo-confirm" data-date="${ds}">Use this photo</button>
        <button class="btn ghost" data-action="pick-photo" data-date="${ds}">Choose another</button>
        <button class="btn ghost" data-action="photo-cancel">Cancel</button>
      </div>
    </div>`;
  }

  if (photoId) {
    return `${err}<div class="photo-wrap">
      <img class="photo-thumb" data-photo="${esc(photoId)}" data-action="photo-open"
           data-photo-id="${esc(photoId)}" data-id="${me.id}" data-date="${ds}" alt="Your photo">
      <div class="actions">
        <button class="btn ghost small" data-action="pick-photo" data-date="${ds}">Replace</button>
        <button class="btn ghost small" data-action="photo-remove" data-date="${ds}">Remove</button>
      </div>
    </div>`;
  }

  return `${err}<div class="actions">
    <button class="btn ghost ${opts.compact ? "small" : ""}" data-action="pick-photo" data-date="${ds}">📷 Add a photo</button>
  </div>${opts.compact ? "" : photoStreakLine(ds)}`;
}

/* The nudge: only worth showing when there's a streak to lose. */
function photoStreakLine(ds) {
  const since = joinedOf(getUser(me.id) || {});
  const n = currentStreak(me.id, photoLog, ds, since);
  const hasToday = !!(photoLog[ds] && photoLog[ds][me.id]);
  if (hasToday && n >= 2) return `<p class="photo-meta">📸 ${n}-day photo streak</p>`;
  if (!hasToday && n >= 1) {
    return `<p class="photo-meta">📸 ${n}-day photo streak, add today's photo to keep it</p>`;
  }
  return "";
}

/* One like control, used by the gallery tiles and the lightbox.

   It is its own <button>, never nested inside the tile button, because a
   button inside a button is invalid HTML and browsers recover from it by
   dropping the inner one. That is why the tile below is a <div> wrapping two
   buttons rather than one big button. */
function likeButton(item, { big = false } = {}) {
  if (!item || !item.photoId) return "";
  const n = item.likes || 0;
  const on = item.likedByMe;
  const label = on ? "Remove your like" : "Like this photo";
  return `<button class="like${on ? " on" : ""}${big ? " big" : ""}"
    data-action="like" data-photo-id="${esc(item.photoId)}"
    aria-pressed="${on}" aria-label="${label}" title="${label}"
    ${me ? "" : "disabled"}>
    <span class="heart">${on ? "❤️" : "🤍"}</span>${n ? `<span class="n">${n}</span>` : ""}
  </button>`;
}

function renderGallery() {
  const all = galleryItems(board.entries, board.users);
  const photographers = board.users.filter(u => all.some(i => i.userId === u.id));
  /* If the filtered person has no photos left (removed, or un-logged), fall
     back to everyone rather than showing a confusing empty grid. */
  const filter = photographers.some(u => u.id === ui.galleryUser) ? ui.galleryUser : null;
  const items = filter ? all.filter(i => i.userId === filter) : all;

  const mine = me ? currentStreak(me.id, photoLog, todayStr(), joinedOf(getUser(me.id) || {})) : 0;
  const myTotal = me ? totalHits(me.id, photoLog, todayStr(), joinedOf(getUser(me.id) || {})) : 0;

  const header = `<div class="card">
    <h2>📸 Photos</h2>
    <p class="small">You: 📸 ${mine} in a row, ${myTotal} photo${myTotal === 1 ? "" : "s"}.
      ${all.length} in all from ${photographers.length} ${photographers.length === 1 ? "person" : "people"}.</p>
    <p class="small muted">A photo streak counts days in a row with a photo, so a fun day
      without one breaks it.</p>
    ${photographers.length > 1 ? `<div class="chips">
      <button class="chip ${filter ? "" : "on"}" data-action="gallery-filter" data-id="">Everyone</button>
      ${photographers.map(u => `<button class="chip ${filter === u.id ? "on" : ""}"
        data-action="gallery-filter" data-id="${u.id}">${u.emoji} ${esc(u.name)}</button>`).join("")}
    </div>` : ""}
  </div>`;

  if (!items.length) {
    return header + `<div class="card"><p class="muted">No photos yet. Add one from Today.</p></div>`;
  }

  return header + `<div class="gallery">${items.map(i => `
    <div class="gtile">
      <button class="gopen" data-action="photo-open" data-photo-id="${esc(i.photoId)}"
              data-id="${esc(i.userId)}" data-date="${i.date}">
        <img data-photo="${esc(i.photoId)}" alt="${esc(i.name)}, ${esc(prettyDate(i.date))}">
        <span class="gcap">${i.emoji} ${monthDayNum(i.date)}</span>
      </button>
      ${likeButton(i)}
    </div>`).join("")}</div>`;
}

/* Comments on the open fun day. Loaded on demand rather than ridden along on
   the board, which every phone refetches each minute — a thread is read by one
   person at a time and is the wrong thing to broadcast. */
function renderComments() {
  const t = ui.thread;
  if (!t) return "";
  if (t.loading) return `<div class="thread" data-action="thread-bg"><p class="muted small">Loading…</p></div>`;
  const rows = (t.comments || []).map(c => `
    <div class="cmt">
      <span class="who">${esc(c.emoji || "")} ${esc(c.name)}</span>
      <span class="body">${esc(c.body)}</span>
      ${c.user_id === (me && me.id)
        ? `<button class="cmt-x" data-action="comment-delete" data-id="${c.id}"
                   aria-label="Delete your comment" title="Delete">×</button>` : ""}
    </div>`).join("");
  return `<div class="thread" data-action="thread-bg">
    ${rows || `<p class="muted small">No comments yet.</p>`}
    <form class="cmt-add" data-action="comment-add">
      <input type="text" id="comment-input" maxlength="500" autocomplete="off"
             placeholder="Say something nice" ${t.busy ? "disabled" : ""}>
      <button class="btn small primary" type="submit" ${t.busy ? "disabled" : ""}>Post</button>
    </form>
    ${t.error ? `<p class="small err">${esc(t.error)}</p>` : ""}
  </div>`;
}

function renderLightbox() {
  const lb = ui.lightbox;
  if (!lb) return "";
  /* Read the counts off the board rather than off the stored lightbox state,
     so a like registered here or by someone else on the next refresh shows
     without having to reopen the photo. */
  const live = galleryItems(board.entries, board.users)
    .find(i => i.photoId === lb.photoId) || lb;
  const n = Number(live.comments || 0);
  return `<div class="lightbox" data-action="photo-close">
    <img data-photo="${esc(lb.photoId)}" alt="">
    <div class="cap">${lb.emoji} ${esc(lb.name)} · ${esc(prettyDate(lb.date))}${
      lb.activity ? " · " + esc(lb.activity) : ""}</div>
    <div class="lb-actions">
      ${likeButton(live, { big: true })}
      <button class="btn" data-action="comment-toggle"
              data-id="${esc(lb.userId)}" data-date="${esc(lb.date)}">
        💬${n ? " " + n : ""}
      </button>
      <button class="btn" data-action="photo-close">Close</button>
    </div>
    ${ui.thread && ui.thread.owner === lb.userId && ui.thread.date === lb.date
      ? renderComments() : ""}
  </div>`;
}

/* ---------- board ---------- */
/* When someone joined: clamps to Sept 1, so days before they joined read as
   "not their problem" rather than misses. */
function joinedOf(u) {
  const j = u.joined || monthStart();
  return j < monthStart() ? monthStart() : j;
}

function cellClass(userId, ds, today, since) {
  if (ds > today) return "future";
  const r = dayResult(userId, exLog, ds, today, since);
  if (r === HIT) return "hit";
  if (r === MISS) return "miss";
  if (r === PENDING) return "pending";
  return "";
}

/* Most logged days first, so the board reads as a summary rather than a
   join-order list. Ties break on the current streak, then the best streak,
   then name, which keeps the order stable between refreshes instead of
   letting two people on the same count swap places every 60 seconds.

   Note this ranks on days logged, not on rate: someone who joined on the 20th
   sits below someone who joined on the 1st with the same habit. That is the
   honest reading of "most logged days" and the grid underneath shows the join
   date, so nobody is being misrepresented. */
function boardOrder(today) {
  return board.users
    .map(u => {
      const since = joinedOf(u);
      return {
        u, since,
        total: totalHits(u.id, exLog, today, since),
        cur: currentStreak(u.id, exLog, today, since),
        best: bestStreak(u.id, exLog, today, since),
      };
    })
    .sort((a, b) =>
      b.total - a.total ||
      b.cur - a.cur ||
      b.best - a.best ||
      a.u.name.localeCompare(b.u.name));
}

function renderBoard() {
  const today = todayStr();
  const dates = monthDates();
  if (!board.users.length) return `<div class="card"><p class="muted">Nobody's joined yet.</p></div>`;

  const ranked = boardOrder(today);
  return ranked.map(({ u, since, total: tot, cur, best }, i) => {
    const cells = dates.map(ds => {
      const fun = entryFor(funLog, ds, u.id);
      const hasPhoto = !!(photoLog[ds] && photoLog[ds][u.id]);
      return `<button class="cell ${cellClass(u.id, ds, today, since)}" data-action="cell" data-id="${u.id}" data-date="${ds}">
        ${monthDayNum(ds)}${fun && fun.done
          ? `<span class="fun-dot${hasPhoto ? " photo" : ""}"></span>` : ""}
      </button>`;
    }).join("");
    const funStreak = currentStreak(u.id, funLog, today, since);
    const photoStreak = currentStreak(u.id, photoLog, today, since);
    const panel = ui.cell && ui.cell.userId === u.id ? cellPanel(u, ui.cell.date, today) : "";
    /* Only worth a medal if there is somebody to be ahead of, and only when
       days have actually been logged. A 🥇 for nought out of thirty on the
       first of the month would be a joke at the winner's expense. */
    const medal = tot > 0 && ranked.length > 1 ? ["🥇", "🥈", "🥉"][i] || "" : "";
    return `<div class="card board-user${i === 0 && medal ? " leader" : ""}">
      <div class="board-head">
        <span>${u.emoji}</span>
        <b>${esc(u.name)}</b>
        ${medal ? `<span class="medal" title="${tot} day${tot === 1 ? "" : "s"} logged">${medal}</span>` : ""}
      </div>
      <div class="streaks">
        <span class="stats">🔥 ${cur} · best ${best} · ${tot}/${monthLength()}</span>
        <span class="stats time">⏱ ${prettyMinutes(totalMinutes(board.entries, u.id))}</span>
        <span class="stats fun">🎉 ${funStreak}</span>
        <span class="stats photo">📸 ${photoStreak}</span>
      </div>
      <div class="grid30">${cells}</div>
      ${panel}
    </div>`;
  }).join("");
}

function cellPanel(u, ds, today) {
  const ex = entryFor(exLog, ds, u.id), fun = entryFor(funLog, ds, u.id);
  const editable = u.id === me.id && ds <= today;
  const preJoin = ds < joinedOf(u) && !ex;
  const blank = ds > today ? "⬜ Not yet" : preJoin ? "· Before they joined" : null;
  const lines = [
    ex && ex.done ? `✅ ${esc(describeEntry(ex))}${ex.note ? " — " + esc(ex.note) : ""}` :
      (blank || "❌ No exercise logged"),
    fun && fun.done ? `🎉 Fun: ${esc(fun.activity || "done")}${fun.note ? " — " + esc(fun.note) : ""}` :
      (ds > today || preJoin ? "" : "⬜ No fun logged"),
  ].filter(Boolean);

  return `<div class="panel">
    <b>${esc(prettyDate(ds))}</b>
    ${lines.map(l => `<div class="small">${l}</div>`).join("")}
    ${/* On your own days the editor below draws the photo, with Replace and
          Remove beside it — drawing it here too showed it twice. */
      !editable && fun && fun.photo_id
      ? `<img class="panel-photo" data-photo="${esc(fun.photo_id)}"
          data-action="photo-open" data-photo-id="${esc(fun.photo_id)}"
          data-id="${esc(u.id)}" data-date="${ds}" alt="Photo from ${esc(u.name)}">` : ""}
    ${editable ? photoSection(ds, fun, { compact: true }) : ""}
    ${editable ? `<div class="row">
      ${ex && ex.done
        ? `<button class="btn small" data-action="backfill" data-date="${ds}" data-kind="exercise" data-done="0">Clear exercise</button>`
        : `<button class="btn small good" data-action="backfill" data-date="${ds}" data-kind="exercise" data-done="1">Mark exercise done</button>`}
      ${fun && fun.done
        ? `<button class="btn small" data-action="backfill" data-date="${ds}" data-kind="fun" data-done="0">Clear fun</button>`
        : `<button class="btn small" data-action="backfill" data-date="${ds}" data-kind="fun" data-done="1">Mark fun done</button>`}
    </div>` : ""}
    <div class="row"><button class="btn ghost small" data-action="close-cell">Close</button></div>
  </div>`;
}

/* ---------- profile ---------- */
function renderProfile() {
  const p = myProfile();
  if (!p) return "";
  const ideas = board.funIdeas || [];
  return `
    <div class="card">
      <h2>Your profile</h2>
      <div class="field">
        <label>Your name <span class="muted">(this is what everyone sees)</span></label>
        <input type="text" id="profile-name" value="${esc(p.name)}" maxlength="40" autocomplete="off">
        <div class="actions">
          <button class="btn" data-action="save-name">Save name</button>
        </div>
      </div>
      <div class="field">
        <label>Avatar</label>
        <div class="chips">${EMOJIS.map(e =>
          `<button class="chip ${p.emoji === e ? "on" : ""}" data-action="set-profile" data-key="emoji" data-val="${e}">${e}</button>`).join("")}</div>
      </div>
      <p class="small muted">Everything below is private to you. Other people
        only ever see your name and avatar.</p>
      <div class="field">
        <label>Age band</label>
        ${isLegacyBand(p.ageBand) ? `<p class="small muted">Your band was set before
          the finer ranges existed — pick the closer one.</p>` : ""}
        <div class="chips">${AGE_BANDS.map(([v, l]) =>
          `<button class="chip ${p.ageBand === v ? "on" : ""}" data-action="set-profile" data-key="ageBand" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Current fitness</label>
        <div class="chips">${FITNESS.map(([v, l]) =>
          `<button class="chip ${p.fitness === v ? "on" : ""}" data-action="set-profile" data-key="fitness" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Goals <span class="muted">(pick as many as you like)</span></label>
        <div class="chips">${GOALS.map(([v, l]) =>
          `<button class="chip ${(p.goals || []).includes(v) ? "on" : ""}" data-action="set-goal" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Anything else? <span class="muted">(injuries, equipment, circumstances)</span></label>
        <input type="text" id="profile-note" value="${esc(p.note || "")}"
               placeholder="e.g. dodgy knee, no gym" autocomplete="off">
        <div class="actions">
          <button class="btn" data-action="save-note">Save</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Shared fun ideas</h2>
      <div class="field">
        <input type="text" id="idea-input" placeholder="Add an idea for everyone" autocomplete="off">
      </div>
      <button class="btn primary" data-action="add-idea">Add to pool</button>
      ${ideas.length ? `<ul class="pool">${ideas.map(i =>
        `<li>${esc(i.text)} <span class="muted small">— ${esc((getUser(i.added_by) || {}).name || "someone")}</span></li>`).join("")}</ul>`
        : `<p class="small muted">30 built-in ideas are in rotation. Add your own here.</p>`}
    </div>
    <div class="card">
      <h2>Security</h2>
      ${ui.changingPin ? `
        <div class="field">
          <label>Current PIN</label>
          <input type="text" id="pin-current" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off">
        </div>
        <div class="field">
          <label>New PIN</label>
          <input type="text" id="pin-new" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off">
        </div>
        <div class="actions">
          <button class="btn primary" data-action="save-pin">Save PIN</button>
          <button class="btn ghost" data-action="toggle-change-pin">Cancel</button>
        </div>`
      : `<p class="small muted">Your PIN keeps anyone else from logging as you on another device.</p>
         <button class="btn" data-action="toggle-change-pin">Change PIN</button>`}
    </div>
    <div class="card">
      <h2>Board</h2>
      <div class="actions">
        <button class="btn" data-action="copy-link">Copy invite link</button>
        <button class="btn ghost" data-action="switch-user">Not you? Switch</button>
      </div>
    </div>`;
}

/* ---------- render ---------- */
function show(id, html) {
  const el = document.getElementById(id);
  el.innerHTML = html;
  el.classList.remove("hidden");
}

/* True while someone is typing into any field.

   render() replaces whole views with innerHTML, which destroys and rebuilds
   every input — wiping what you had typed and dropping the keyboard. That is
   fine when a render follows a tap, because nothing is half-typed. It is not
   fine when the 60-second poll fires underneath you.

   It read as "if you type too much on an iPhone it deletes the text", but the
   trigger is time rather than length: a long entry takes more than a minute to
   type, the poll lands mid-sentence and the box empties. Phones hit it most
   because typing is slower and the suggestion bar hides the damage until you
   look up. */
function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/* A poll wanted to redraw while someone was mid-sentence. Hold it, and run it
   the moment the field loses focus, so the board is never more than a blur
   behind. */
let renderDeferred = false;
function renderUnlessTyping() {
  if (isTyping()) { renderDeferred = true; return; }
  render();
}
document.addEventListener("focusout", () => {
  if (!renderDeferred) return;
  renderDeferred = false;
  /* let the click that caused the blur land first */
  setTimeout(() => { if (!isTyping()) render(); }, 150);
});

/* ---------- progress ---------- */

async function loadSummary() {
  try {
    ui.summary = await api.getSummary();
  } catch (e) {
    if (isAuthError(e)) return signedOut();
    ui.summary = { error: true };
  }
  renderUnlessTyping();
}

/* "7h30" reads better than "450 minutes" once the totals get big, but under an
   hour the minutes are the interesting number. */
function prettyHours(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${["January","February","March","April","May","June","July",
             "August","September","October","November","December"][m - 1]} ${y}`;
}

/* Days in a month that had already happened — so a month still running is
   measured against the days so far rather than against days nobody could have
   logged yet. */
function daysElapsed(ym, today) {
  const last = Number(monthEnd(ym + "-01").slice(8));
  if (ym < today.slice(0, 7)) return last;
  if (ym > today.slice(0, 7)) return 0;
  return Number(today.slice(8));
}

function renderProgress() {
  const s = ui.summary;
  if (!s) return `<div class="card"><p class="muted">Loading…</p></div>`;
  if (s.error) return `<div class="card"><p class="muted">Couldn't load your progress.
    <button class="btn small" data-action="tab" data-tab="progress">Try again</button></p></div>`;

  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const months = (s.months || []).slice().sort((a, b) => b.month.localeCompare(a.month));
  if (!months.length) {
    return `<div class="card"><h2>Progress</h2>
      <p class="muted">Nothing logged yet. Once you've ticked a few days this
      fills up with how the month went.</p></div>`;
  }

  const cur = months.find(m => m.month === thisMonth);
  const prev = months.find(m => m.month < thisMonth);
  const t = s.totals || {};

  /* The headline: last month in a sentence, which is what was actually asked
     for. Falls back to this month when there is no history yet. */
  const lead = prev
    ? `<div class="card lead">
         <h2>${esc(monthLabel(prev.month))}</h2>
         <p class="big">You exercised on <b>${prev.exerciseDays}</b> of
           ${daysElapsed(prev.month, today)} days and had
           <b>${prev.funDays}</b> fun ${prev.funDays === 1 ? "day" : "days"}.</p>
         <p class="muted small">
           ${prettyHours(prev.minutes)} of exercise${prev.km ? ` · ${prev.km.toFixed(1)} km` : ""}${
             prev.photos ? ` · ${prev.photos} photo${prev.photos === 1 ? "" : "s"}` : ""}</p>
       </div>`
    : "";

  const curDays = daysElapsed(thisMonth, today);
  const now = `<div class="card">
      <h3>${esc(monthName())} so far</h3>
      <p class="big">${cur ? cur.exerciseDays : 0} of ${curDays} days exercised${
        cur && cur.funDays ? `, ${cur.funDays} fun` : ""}.</p>
      ${cur && prev ? `<p class="muted small">${
        comparison(cur, prev, thisMonth, today)}</p>` : ""}
    </div>`;

  const history = months.length > 1 ? `<div class="card">
      <h3>Every month</h3>
      <div class="months">
        ${months.map(m => `<div class="mrow">
            <span class="mname">${esc(monthLabel(m.month))}</span>
            <span class="mbar"><i style="width:${
              Math.round(100 * m.exerciseDays / Math.max(1, daysElapsed(m.month, today)))}%"></i></span>
            <span class="mnum">${m.exerciseDays}d · ${m.funDays}🎉</span>
          </div>`).join("")}
      </div>
    </div>` : "";

  const totals = `<div class="card">
      <h3>All time</h3>
      <p>${t.exerciseDays || 0} days exercised · ${prettyHours(t.minutes)}${
        t.km ? ` · ${Number(t.km).toFixed(1)} km` : ""}</p>
      <p>${t.funDays || 0} fun days · ${t.photos || 0} photos</p>
      ${(t.likes_received || t.comments_received)
        ? `<p class="muted small">${t.likes_received || 0} ${
            (t.likes_received || 0) === 1 ? "like" : "likes"} and ${t.comments_received || 0} ${
            (t.comments_received || 0) === 1 ? "comment" : "comments"} from the others.</p>` : ""}
      ${(t.topActivities || []).length
        ? `<p class="muted small">Mostly ${t.topActivities.map(a =>
             `${esc(a.activity)} (${a.n})`).join(", ")}.</p>` : ""}
    </div>`;

  return lead + now + history + totals;
}

/* One honest sentence about this month against last, compared on rate rather
   than on count — otherwise the 3rd of the month always looks like a collapse. */
function comparison(cur, prev, thisMonth, today) {
  const curDays = daysElapsed(thisMonth, today);
  const prevDays = daysElapsed(prev.month, today);
  if (!curDays || !prevDays) return "";
  const a = cur.exerciseDays / curDays, b = prev.exerciseDays / prevDays;
  const pct = Math.round(Math.abs(a - b) * 100);
  if (pct < 5) return `About the same pace as ${monthLabel(prev.month).split(" ")[0]}.`;
  return a > b
    ? `That's ${pct} points ahead of ${monthLabel(prev.month).split(" ")[0]}'s pace.`
    : `That's ${pct} points behind ${monthLabel(prev.month).split(" ")[0]}'s pace.`;
}

function render() {
  for (const id of ["view-onboard", "view-today", "view-board", "view-gallery",
                    "view-progress", "view-profile"]) {
    document.getElementById(id).classList.add("hidden");
  }
  const tabs = document.getElementById("tabs");
  const dayEl = document.getElementById("daycount");
  const today = todayStr();
  const n = monthDayNum(today);
  dayEl.textContent = n ? `${prettyDate(today)} · day ${n}/${monthLength()}` : prettyDate(today);
  /* The header carries the month, so on the 1st the whole app renames itself
     without a deploy. */
  const titleEl = document.getElementById("apptitle");
  if (titleEl) titleEl.textContent = `${monthName()} Tracker`;

  /* Demo: the splash replaces the bare "Loading…" and stays until the visitor
     picks a door. isDemo is only known once the board answers, so a first
     paint before that still shows the loading line. */
  if (isDemo() && !ui.splashDone && (!me || !getUser(me.id))) {
    show("view-onboard", renderSplash());
    tabs.classList.add("hidden");
    return;
  }

  if (ui.loading) { show("view-onboard", `<div class="onboard"><p class="muted">Loading…</p></div>`); tabs.classList.add("hidden"); return; }

  if (ui.offline || ui.needPasscode || !me || !getUser(me.id)) {
    show("view-onboard", renderOnboard());
    tabs.classList.add("hidden");
    return;
  }

  tabs.classList.remove("hidden");
  for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === ui.tab);
  if (ui.tab === "today") show("view-today", renderToday());
  else if (ui.tab === "board") show("view-board", renderBoard());
  else if (ui.tab === "gallery") show("view-gallery", renderGallery());
  else if (ui.tab === "progress") show("view-progress", renderProgress());
  else show("view-profile", renderProfile());

  /* The lightbox lives outside <main> so switching views doesn't destroy it. */
  document.getElementById("lightbox").innerHTML = renderLightbox();
  /* Fills every <img data-photo> above: cached ones synchronously, so the
     60-second refresh doesn't make the gallery flicker. */
  hydratePhotos(document);
}

/* Local picks, computed instantly. Startup never waits on the network. */
function loadSuggestions() {
  const p = myProfile();
  if (!p) return;
  const yesterday = addDays(todayStr(), -1);
  const y = entryFor(exLog, yesterday, me.id);
  suggestions = getSuggestions(p, todayStr(), y && y.activity ? [y.activity] : [], {
    yesterdayMinutes: y && y.done ? minutesOf(y) : 0,
    yesterdayFeeling: y && y.done ? y.feeling : null,
  });
  aiSuggestions = null;
  aiAsked = false;
}

/* Asked for only when someone opens the suggestions, then swapped in. */
async function upgradeSuggestions() {
  if (aiAsked || !aiAvailable()) return;
  aiAsked = true;
  aiBusy = true;
  render();
  try {
    const workouts = await getAiSuggestions(todayStr());
    if (workouts) { aiSuggestions = workouts; suggestions = workouts; }
  } catch (e) {
    if (isAuthError(e)) return signedOut();
  } finally {
    aiBusy = false;
    render();
  }
}

/* ---------- actions ---------- */
/* Enter posts a comment. Delegated like the clicks, because the form is
   recreated on every render. */
async function onSubmit(ev) {
  const form = ev.target.closest('form[data-action="comment-add"]');
  if (!form) return;
  ev.preventDefault();
  const t = ui.thread;
  const input = document.getElementById("comment-input");
  if (!t || !input) return;
  const body = input.value.trim();
  if (!body || t.busy) return;

  t.busy = true; t.error = ""; render();
  try {
    const { comment } = await api.addComment(t.owner, t.date, body);
    if (ui.thread && ui.thread.owner === t.owner && ui.thread.date === t.date) {
      ui.thread.comments = [...ui.thread.comments, comment];
      ui.thread.busy = false;
    }
    await refresh();                 /* the board carries the count */
  } catch (e) {
    if (isAuthError(e)) return signedOut();
    if (ui.thread) { ui.thread.busy = false; ui.thread.error = "Couldn't post that"; }
  }
  render();
  /* put the cursor back, so a second comment doesn't need a tap */
  const again = document.getElementById("comment-input");
  if (again) again.focus();
}

async function onClick(ev) {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  /* The lightbox closes on any click inside it, so the comment panel has to
     absorb its own or reading a thread would shut the photo. */
  if (a === "thread-bg") return;
  const today = viewDate();          /* log against the day being shown */

  if (a === "day-back" || a === "day-forward" || a === "day-today") {
    const cur = viewDate();
    ui.viewDate = a === "day-today" ? null
      : addDays(cur, a === "day-back" ? -1 : 1);
    /* Leaving a half-finished entry behind on another day would be confusing. */
    ui.exOther = false; ui.funOwn = false; ui.customMinutes = false;
    clearDraft();
    render();
    return;
  }

  if (a === "tab") {
    ui.tab = el.dataset.tab;
    ui.cell = null; ui.lightbox = null; ui.confirmFunClear = null; ui.thread = null;
    render();
    /* Fetched on open rather than on a timer: looking back is something you do
       occasionally, and this is the one call the 60-second poll never makes. */
    if (ui.tab === "progress") loadSummary();
    return;
  }

  /* ---- photos ---- */
  if (a === "pick-photo") {
    ui.photoTarget = el.dataset.date;
    ui.photoError = "";
    clearDraft();
    render();
    document.getElementById("photo-input").click();
    return;
  }

  if (a === "photo-cancel") { clearDraft(); ui.photoError = ""; render(); return; }

  if (a === "photo-confirm") {
    const ds = el.dataset.date;
    const draft = ui.photoDraft;
    if (!draft || draft.date !== ds) return;
    ui.photoBusy = true; ui.photoError = ""; render();
    try {
      /* A photo needs a fun entry to attach to. The server creates one if it's
         missing, but logging here first keeps the local view honest. */
      const existing = entryFor(funLog, ds, me.id);
      const activity = existing && existing.activity
        ? existing.activity
        : funPromptFor(me.id, ds, board.funIdeas, ui.funSwap);
      const b64 = await blobToBase64(draft.blob);
      const old = existing && existing.photo_id;
      await api.uploadPhoto({ date: ds, b64, mime: "image/jpeg", w: draft.w, h: draft.h, activity });
      if (old) forgetPhoto(old);
      clearDraft();
      await refresh();
      toast("Photo added 📸");
    } catch (e) {
      console.error(e);
      if (isAuthError(e)) { ui.photoBusy = false; return signedOut(); }
      ui.photoError = errorMessage(e) || "Couldn't upload that photo";
    } finally {
      ui.photoBusy = false;
      ui.photoTarget = null;
      render();
    }
    return;
  }

  if (a === "photo-remove") {
    const ds = el.dataset.date;
    const existing = entryFor(funLog, ds, me.id);
    try {
      await api.deletePhoto(ds);
      if (existing && existing.photo_id) forgetPhoto(existing.photo_id);
      await refresh();
      toast("Photo removed");
      render();
    } catch (e) {
      if (isAuthError(e)) return signedOut();
      toast("Couldn't remove that photo");
    }
    return;
  }

  if (a === "photo-open") {
    const u = getUser(el.dataset.id) || {};
    const ds = el.dataset.date;
    const fun = entryFor(funLog, ds, el.dataset.id);
    ui.lightbox = {
      photoId: el.dataset.photoId, name: u.name || "", emoji: u.emoji || "",
      date: ds, activity: (fun && fun.activity) || "",
    };
    render();
    return;
  }

  if (a === "photo-close") { ui.lightbox = null; ui.thread = null; render(); return; }

  /* ---- comments ---- */
  if (a === "comment-toggle") {
    const owner = el.dataset.id, date = el.dataset.date;
    if (ui.thread && ui.thread.owner === owner && ui.thread.date === date) {
      ui.thread = null; render(); return;
    }
    ui.thread = { owner, date, comments: [], loading: true, busy: false, error: "" };
    render();
    try {
      const { comments } = await api.getComments(owner, date);
      if (ui.thread && ui.thread.owner === owner && ui.thread.date === date) {
        ui.thread.comments = comments; ui.thread.loading = false;
      }
    } catch (e) {
      if (isAuthError(e)) return signedOut();
      if (ui.thread) { ui.thread.loading = false; ui.thread.error = "Couldn't load the comments"; }
    }
    render();
    return;
  }
  if (a === "comment-delete") {
    const id = Number(el.dataset.id);
    const t = ui.thread;
    if (!t) return;
    const before = t.comments;
    t.comments = t.comments.filter(c => Number(c.id) !== id);   /* optimistic */
    render();
    try {
      await api.deleteComment(id);
      await refresh();                 /* the board carries the count */
    } catch (e) {
      if (isAuthError(e)) return signedOut();
      t.comments = before;
      toast("Couldn't delete that");
    }
    renderUnlessTyping();
    return;
  }

  if (a === "like") {
    /* Inside the lightbox the backdrop closes the photo, so a like tap must
       not bubble up and shut it. Same on a gallery tile, where the wrapper
       opens the picture. */
    ev.stopPropagation();
    if (!me) { toast("Join first to like photos"); return; }
    const photoId = el.dataset.photoId;
    const row = board.entries.find(e => e.photo_id === photoId);
    if (!row) return;

    /* Optimistic: a like should feel instant on a phone. The server is the
       authority on the count, so its reply overwrites this either way, and a
       failure puts back exactly what was there before. */
    const before = { likes: Number(row.likes) || 0, liked: !!row.liked_by_me };
    row.liked_by_me = !before.liked;
    row.likes = before.likes + (before.liked ? -1 : 1);
    render();

    try {
      const { liked, count } = await api.toggleLike(photoId);
      row.liked_by_me = liked;
      row.likes = count;
    } catch (e) {
      row.liked_by_me = before.liked;
      row.likes = before.likes;
      toast(isAuthError(e) ? "Sign in again to like photos" : errorMessage(e));
    }
    render();
    return;
  }

  if (a === "gallery-filter") { ui.galleryUser = el.dataset.id || null; render(); return; }

  if (a === "undo-fun-cancel") { ui.confirmFunClear = null; render(); return; }

  if (a === "splash-signup") {
    ui.splashDone = true;
    ui.onboardStep = "new";
    render();
    return;
  }

  if (a === "demo-login") {
    ui.demoBusy = true; render();
    try {
      const { id, name, token } = await api.demoLogin();
      setToken(token);
      me = { id, name };
      localStorage.setItem(ME_KEY, JSON.stringify(me));
      ui.splashDone = true;
      await refresh();
      await loadMyProfile();
      loadSuggestions();
      toast(`You're ${name} — have a poke around`);
    } catch (e) {
      toast(errorMessage(e) || "Couldn't start the demo");
    } finally {
      ui.demoBusy = false;
      render();
    }
    return;
  }

  if (a === "retry") {
    ui.loading = true; render();
    await refresh();
    if (ui.offline) toast("Still can't reach the board");
    render();
    return;
  }

  if (a === "submit-passcode") {
    setPasscode(document.getElementById("passcode-input").value.trim());
    ui.loading = true; render();
    await refresh();
    if (ui.needPasscode) toast("That passcode didn't work");
    render();
    return;
  }

  if (a === "onboard-step") {
    ui.onboardStep = el.dataset.val;
    if (el.dataset.val !== "pin") ui.claiming = null;
    render();
    return;
  }

  if (a === "draft" || a === "draft-goal") {
    /* Keep whatever's typed: a chip tap re-renders the whole form. */
    for (const [id, key] of [["name-input", "name"], ["pin-input", "pin"], ["note-input", "note"]]) {
      const elx = document.getElementById(id);
      if (elx) ui.draft[key] = elx.value;
    }
    if (a === "draft-goal") {
      const g = el.dataset.val;
      const set = new Set(ui.draft.goals || []);
      set.has(g) ? set.delete(g) : set.add(g);
      ui.draft.goals = [...set];
    } else {
      ui.draft[el.dataset.key] = el.dataset.val;
    }
    render();
    return;
  }

  if (a === "create-user") {
    const d = ui.draft;
    d.name = (document.getElementById("name-input").value || "").trim();
    d.pin = (document.getElementById("pin-input").value || "").trim();
    d.note = (document.getElementById("note-input").value || "").trim();
    if (!d.name) return toast("Add your name first");
    if (!d.ageBand) return toast("Pick an age band");
    if (!d.fitness) return toast("Pick your current fitness level");
    if (!(d.goals || []).length) return toast("Pick at least one goal");
    if (!/^\d{4}$/.test(d.pin)) return toast("Choose a 4-digit PIN");
    try {
      const { id, token } = await api.createUser(d);
      setToken(token);
      me = { id, name: d.name };
      localStorage.setItem(ME_KEY, JSON.stringify(me));
      ui.draft.pin = "";
      await refresh();
      await loadMyProfile();
      loadSuggestions();
      toast("You're in — welcome!");
      render();
    } catch (e) {
      toast(isNameTaken(e) ? "That name's taken — pick another" : errorMessage(e));
    }
    return;
  }

  if (a === "claim") {
    ui.claiming = getUser(el.dataset.id);
    ui.onboardStep = "pin";
    render();
    return;
  }

  if (a === "submit-claim") {
    const u = ui.claiming;
    const pin = (document.getElementById("claim-pin-input").value || "").trim();
    if (!pin) return toast("Enter your PIN");
    try {
      const { token } = await api.claim(u.id, pin);
      setToken(token);
      me = { id: u.id, name: u.name };
      localStorage.setItem(ME_KEY, JSON.stringify(me));
      ui.claiming = null;
      ui.onboardStep = "who";
      await refresh();
      await loadMyProfile();
      loadSuggestions();
      render();
    } catch (e) {
      toast(errorMessage(e));   /* "wrong PIN", or the lockout message */
    }
    return;
  }

  if (a === "toggle-suggestions") {
    ui.showSuggestions = !ui.showSuggestions;
    render();
    if (ui.showSuggestions) upgradeSuggestions();   /* not awaited: show now, improve shortly */
    return;
  }

  if (a === "log-ex") {
    await saveEntry({ date: today, kind: "exercise", done: true,
      activity: el.dataset.activity, minutes: DEFAULT_MINUTES });
    toast("Nice — 30 minutes logged 💪");
    return;
  }

  if (a === "toggle-ex-other") { ui.exOther = !ui.exOther; render(); return; }

  if (a === "log-ex-other") {
    const what = (document.getElementById("ex-other-input").value || "").trim();
    if (!what) return toast("What did you do?");
    ui.exOther = false;
    await saveEntry({ date: today, kind: "exercise", done: true,
      activity: what, minutes: DEFAULT_MINUTES });
    toast("Logged 💪");
    return;
  }

  if (a === "toggle-custom-minutes") { ui.customMinutes = !ui.customMinutes; render(); return; }

  if (a === "set-minutes" || a === "save-minutes") {
    const raw = a === "set-minutes"
      ? el.dataset.val
      : (document.getElementById("minutes-input").value || "");
    const mins = Math.round(Number(raw));
    if (!Number.isFinite(mins) || mins < 5 || mins > 600) {
      return toast("Give a time between 5 minutes and 10 hours");
    }
    if (a === "save-minutes") ui.customMinutes = false;
    const cur = entryFor(exLog, today, me.id) || {};
    await saveEntry({ date: today, kind: "exercise", done: true,
      activity: cur.activity, note: cur.note, minutes: mins,
      distanceKm: cur.distance_km == null ? null : Number(cur.distance_km),
      feeling: cur.feeling });
    return;
  }

  if (a === "set-feeling") {
    const cur = entryFor(exLog, today, me.id) || {};
    await saveEntry({ date: today, kind: "exercise", done: true,
      activity: cur.activity, note: cur.note, minutes: minutesOf(cur),
      distanceKm: cur.distance_km == null ? null : Number(cur.distance_km),
      feeling: el.dataset.val });
    return;
  }

  if (a === "save-distance") {
    const raw = (document.getElementById("distance-input").value || "").trim();
    const km = raw === "" ? null : Number(raw.replace(",", "."));
    if (km !== null && (!Number.isFinite(km) || km <= 0 || km > 999)) {
      return toast("Give a distance in km, like 6.2");
    }
    const cur = entryFor(exLog, today, me.id) || {};
    await saveEntry({ date: today, kind: "exercise", done: true,
      activity: cur.activity, note: cur.note, minutes: minutesOf(cur),
      distanceKm: km, feeling: cur.feeling });
    toast(km === null ? "Distance cleared" : "Saved");
    return;
  }
  if (a === "undo-ex") { await saveEntry({ date: today, kind: "exercise", done: null }); return; }

  if (a === "swap-fun") { ui.funSwap++; render(); return; }
  if (a === "toggle-fun-own") { ui.funOwn = !ui.funOwn; render(); return; }

  if (a === "log-fun") {
    await saveEntry({ date: today, kind: "fun", done: true, activity: el.dataset.text });
    toast("Fun logged 🎉");
    return;
  }

  if (a === "log-fun-own") {
    const text = (document.getElementById("fun-own-input").value || "").trim();
    if (!text) return toast("What did you do?");
    const share = document.getElementById("fun-share").checked;
    ui.funOwn = false;
    await saveEntry({ date: today, kind: "fun", done: true, activity: text });
    if (share) { try { await api.addFunIdea(text, me.id); await refresh(); render(); } catch {} }
    toast("Fun logged 🎉");
    return;
  }
  if (a === "undo-fun") {
    /* Un-logging fun cascades the photo away in the database, so ask once. */
    const fun = entryFor(funLog, today, me.id);
    if (fun && fun.photo_id && ui.confirmFunClear !== today) {
      ui.confirmFunClear = today;
      render();
      return;
    }
    ui.confirmFunClear = null;
    await saveEntry({ date: today, kind: "fun", done: null });
    return;
  }

  if (a === "undo-fun-confirm") {
    const fun = entryFor(funLog, today, me.id);
    if (fun && fun.photo_id) forgetPhoto(fun.photo_id);
    ui.confirmFunClear = null;
    await saveEntry({ date: today, kind: "fun", done: null });
    return;
  }

  if (a === "cell") {
    const key = { userId: el.dataset.id, date: el.dataset.date };
    ui.cell = (ui.cell && ui.cell.userId === key.userId && ui.cell.date === key.date) ? null : key;
    render();
    return;
  }
  if (a === "close-cell") { ui.cell = null; render(); return; }

  if (a === "backfill") {
    const done = el.dataset.done === "1";
    await saveEntry({ date: el.dataset.date, kind: el.dataset.kind, done: done ? true : null });
    return;
  }

  if (a === "save-name") {
    const name = (document.getElementById("profile-name").value || "").trim();
    if (!name) return toast("Your name can't be empty");
    if (name === me.name) return toast("That's already your name");
    try {
      await api.updateUser({ name });
      me = { ...me, name };
      localStorage.setItem(ME_KEY, JSON.stringify(me));
      await refresh();
      await loadMyProfile();
      toast(`You're ${name} now`);
      render();
    } catch (e) {
      if (isAuthError(e)) return signedOut();
      toast(errorMessage(e) || "Couldn't change your name");
    }
    return;
  }

  if (a === "set-profile" || a === "set-goal" || a === "save-note") {
    const patch = {};
    if (a === "set-goal") {
      const set = new Set((myPrivate && myPrivate.goals) || []);
      set.has(el.dataset.val) ? set.delete(el.dataset.val) : set.add(el.dataset.val);
      if (!set.size) return toast("Keep at least one goal");
      patch.goals = [...set];
    } else if (a === "save-note") {
      patch.note = (document.getElementById("profile-note").value || "").trim();
    } else {
      patch[el.dataset.key] = el.dataset.val;
    }

    /* Optimistic: emoji lives on the shared board, the rest is private. */
    if (patch.emoji) getUser(me.id).emoji = patch.emoji;
    if (myPrivate) Object.assign(myPrivate, patch);
    render();

    try {
      await api.updateUser(patch);
      await loadMyProfile();
      loadSuggestions();
      if (a === "save-note") toast("Saved");
      render();
    } catch (e) {
      if (isAuthError(e)) return signedOut();
      toast(errorMessage(e) || "Couldn't save profile");
      await loadMyProfile();
      render();
    }
    return;
  }

  if (a === "add-idea") {
    const input = document.getElementById("idea-input");
    const text = (input.value || "").trim();
    if (!text) return toast("Type an idea first");
    try {
      await api.addFunIdea(text);
      await refresh();
      toast("Added to the pool");
      render();
    } catch (e) { if (isAuthError(e)) return signedOut(); toast("Couldn't add that"); }
    return;
  }

  if (a === "toggle-change-pin") { ui.changingPin = !ui.changingPin; render(); return; }

  if (a === "save-pin") {
    const currentPin = (document.getElementById("pin-current").value || "").trim();
    const newPin = (document.getElementById("pin-new").value || "").trim();
    if (!/^\d{4}$/.test(newPin)) return toast("New PIN must be 4 digits");
    try {
      await api.changePin(currentPin, newPin);
      ui.changingPin = false;
      toast("PIN updated");
      render();
    } catch (e) { if (isAuthError(e)) return signedOut(); toast(errorMessage(e)); }
    return;
  }

  if (a === "copy-link") {
    try { await navigator.clipboard.writeText(location.origin); toast("Link copied"); }
    catch { toast(location.origin); }
    return;
  }

  if (a === "switch-user") {
    clearToken();
    localStorage.removeItem(ME_KEY);
    me = null;
    ui.onboardStep = "who";
    render();
    return;
  }
}

/* ---------- boot ---------- */
/* Drop a pending draft and release its preview URL. */
function clearDraft() {
  if (ui.photoDraft) URL.revokeObjectURL(ui.photoDraft.previewUrl);
  ui.photoDraft = null;
}

async function onPhotoPicked(ev) {
  const file = ev.target.files && ev.target.files[0];
  /* Reset immediately so picking the same file again still fires a change. */
  ev.target.value = "";
  if (!file) return;

  ui.photoBusy = true; ui.photoError = ""; render();
  try {
    const draft = await prepareUpload(file);
    /* The day the picker was opened for; the day on screen otherwise. */
    draft.date = ui.photoTarget || viewDate();
    ui.photoDraft = draft;
  } catch (e) {
    console.error(e);
    ui.photoError = e && e.code === "decode"
      ? "Couldn't read that photo. If it's an iPhone HEIC, try Settings → Camera → Formats → Most Compatible, or share it from Photos as a JPEG."
      : "Something went wrong preparing that photo";
  } finally {
    ui.photoBusy = false;
    render();
  }
}

async function boot() {
  try { me = JSON.parse(localStorage.getItem(ME_KEY) || "null"); } catch { me = null; }
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.getElementById("photo-input").addEventListener("change", onPhotoPicked);
  render();
  await refresh();
  if (me && getUser(me.id)) { await loadMyProfile(); loadSuggestions(); }
  render();

  /* cheap multiplayer: refetch when the tab regains focus and every 60s.
     Both paths redraw through renderUnlessTyping, so a background update can
     never empty a box someone is still typing into. */
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && me) { await refresh(); renderUnlessTyping(); }
  });
  setInterval(async () => {
    /* Never re-render underneath an upload or a pending draft. */
    if (ui.photoBusy || ui.photoDraft) return;
    if (!document.hidden && me && !ui.needPasscode) { await refresh(); renderUnlessTyping(); }
  }, 60000);
}

boot();
window.__app = { get board() { return board; }, get exLog() { return exLog; }, render, refresh };
