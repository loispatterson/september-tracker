import { api, setPasscode, setToken, clearToken, isPasscodeError, isAuthError,
         isNameTaken, errorMessage } from "./api.js";
import { todayStr, prettyDate, septDates, septDayNum, SEPT_START, SEPT_END, addDays } from "./dates.js";
import { currentStreak, bestStreak, totalHits, dayResult, HIT, MISS, PENDING } from "./streaks.js";
import { getSuggestions } from "./suggestions.js";
import { funPromptFor } from "./fun.js";
import { buildLogs } from "./logs.js";
import { galleryItems } from "./imageutil.js";
import { prepareUpload, blobToBase64, hydratePhotos, forgetPhoto, cachedUrl } from "./photos.js";

const ME_KEY = "septTracker.me";
const ACTIVITIES = ["Run", "Walk", "Gym", "Cycle", "Swim", "Yoga", "Class", "Other"];
const AGE_BANDS = [["under30", "Under 30"], ["30-44", "30–44"], ["45-59", "45–59"], ["60plus", "60+"]];
const GOALS = [["strength", "Strength"], ["cardio", "Cardio"], ["mobility", "Mobility"], ["general", "General fitness"]];
const EMOJIS = ["💪", "🏃", "🚴", "🧘", "🏊", "⚡", "🔥", "🌟", "🐝", "🦊", "🐙", "🦕"];

/* ---------- state ---------- */
let board = { users: [], entries: [], funIdeas: [] };
let me = null;                    /* { id, name } from localStorage */
let exLog = {}, funLog = {}, photoLog = {};   /* log[date][userId] = entry */
let suggestions = [];

/* ephemeral UI state — never persisted */
const ui = {
  tab: "today",
  needPasscode: false,
  offline: false,                 /* board unreachable — show a real message */
  onboardStep: "who",             /* who | new | pin */
  claiming: null,                 /* user being claimed, awaiting their PIN */
  draft: { name: "", emoji: "💪", ageBand: "", goal: "", pin: "" },
  changingPin: false,
  showSuggestions: false,
  funSwap: 0,
  funOwn: false,
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
function myProfile() {
  const u = me && getUser(me.id);
  return u ? { id: u.id, name: u.name, emoji: u.emoji, ageBand: u.age_band, goal: u.goal } : null;
}
function entryFor(log, ds, userId) { return (log[ds] && log[ds][userId]) || null; }

function rebuildLogs() {
  ({ exLog, funLog, photoLog } = buildLogs(board.entries));
}

/* ---------- data ---------- */
async function refresh() {
  try {
    board = await api.getBoard();
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
async function saveEntry({ date, kind, done, activity, note }) {
  const local = { user_id: me.id, date, kind, done, activity: activity || null, note: note || null };
  board.entries = board.entries.filter(e => !(e.user_id === me.id && e.date === date && e.kind === kind));
  if (done !== null) board.entries.push(local);
  rebuildLogs();
  render();
  try {
    await api.saveEntry({ date, kind, done, activity, note });
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
        <label>Main goal</label>
        <div class="chips">${GOALS.map(([v, l]) =>
          `<button class="chip ${d.goal === v ? "on" : ""}" data-action="draft" data-key="goal" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Choose a 4-digit PIN <span class="muted">(so only you can log as you)</span></label>
        <input type="text" id="pin-input" inputmode="numeric" maxlength="4"
               value="${esc(d.pin || "")}" placeholder="••••" autocomplete="off">
      </div>
      <button class="btn primary big" data-action="create-user">Start September</button>
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
    <p class="muted small">30 minutes of exercise + one fun thing, every day of September.</p>
    <div class="members">
      ${board.users.map(u =>
        `<button class="btn" data-action="claim" data-id="${u.id}">${u.emoji} ${esc(u.name)}</button>`).join("")}
    </div>
    <button class="btn primary big" data-action="onboard-step" data-val="new">I'm new — set me up</button>
  </div>`;
}

/* ---------- today ---------- */
function renderToday() {
  const today = todayStr();
  const p = myProfile();
  if (!p) return "";
  const inSept = today >= SEPT_START && today <= SEPT_END;
  const ex = entryFor(exLog, today, me.id);
  const fun = entryFor(funLog, today, me.id);

  if (!inSept) {
    return `<div class="card"><h2>${esc(prettyDate(today))}</h2>
      <p class="muted">September's challenge runs 1–30 September 2026.
      ${today < SEPT_START ? "Not started yet — check the Board tab." : "It's a wrap! See the Board for the final grids."}</p></div>`;
  }

  /* --- exercise card --- */
  let exHtml;
  if (ex && ex.done) {
    exHtml = `<div class="done-banner">
        <span>✅ 30 min done${ex.activity ? " · " + esc(ex.activity) : ""}</span>
        <button class="btn small" data-action="undo-ex">Undo</button>
      </div>
      ${ex.note ? `<p class="small muted">${esc(ex.note)}</p>` : ""}`;
  } else {
    exHtml = `<div class="chips">
        ${ACTIVITIES.map(a => `<button class="chip" data-action="log-ex" data-activity="${a}">${a}</button>`).join("")}
      </div>
      <p class="small muted">Tap what you did — that logs your 30 minutes.</p>
      <button class="btn ghost small" data-action="toggle-suggestions">${ui.showSuggestions ? "Hide ideas" : "Need an idea?"}</button>
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
      <span class="marks">${e && e.done ? "✅" : "⬜"}${f && f.done ? "🎉" : "⬜"}</span>
    </div>`;
  }).join("");

  return `
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
function photoSection(ds, fun) {
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
    <button class="btn ghost" data-action="pick-photo" data-date="${ds}">📷 Add a photo</button>
  </div>${photoStreakLine(ds)}`;
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
    <button class="gtile" data-action="photo-open" data-photo-id="${esc(i.photoId)}"
            data-id="${esc(i.userId)}" data-date="${i.date}">
      <img data-photo="${esc(i.photoId)}" alt="${esc(i.name)}, ${esc(prettyDate(i.date))}">
      <span class="gcap">${i.emoji} ${septDayNum(i.date)}</span>
    </button>`).join("")}</div>`;
}

function renderLightbox() {
  const lb = ui.lightbox;
  if (!lb) return "";
  return `<div class="lightbox" data-action="photo-close">
    <img data-photo="${esc(lb.photoId)}" alt="">
    <div class="cap">${lb.emoji} ${esc(lb.name)} · ${esc(prettyDate(lb.date))}${
      lb.activity ? " · " + esc(lb.activity) : ""}</div>
    <button class="btn" data-action="photo-close">Close</button>
  </div>`;
}

/* ---------- board ---------- */
/* When someone joined: clamps to Sept 1, so days before they joined read as
   "not their problem" rather than misses. */
function joinedOf(u) {
  const j = u.joined || SEPT_START;
  return j < SEPT_START ? SEPT_START : j;
}

function cellClass(userId, ds, today, since) {
  if (ds > today) return "future";
  const r = dayResult(userId, exLog, ds, today, since);
  if (r === HIT) return "hit";
  if (r === MISS) return "miss";
  if (r === PENDING) return "pending";
  return "";
}

function renderBoard() {
  const today = todayStr();
  const dates = septDates();
  if (!board.users.length) return `<div class="card"><p class="muted">Nobody's joined yet.</p></div>`;

  return board.users.map(u => {
    const since = joinedOf(u);
    const cells = dates.map(ds => {
      const fun = entryFor(funLog, ds, u.id);
      const hasPhoto = !!(photoLog[ds] && photoLog[ds][u.id]);
      return `<button class="cell ${cellClass(u.id, ds, today, since)}" data-action="cell" data-id="${u.id}" data-date="${ds}">
        ${septDayNum(ds)}${fun && fun.done
          ? `<span class="fun-dot${hasPhoto ? " photo" : ""}"></span>` : ""}
      </button>`;
    }).join("");
    const cur = currentStreak(u.id, exLog, today, since);
    const best = bestStreak(u.id, exLog, today, since);
    const tot = totalHits(u.id, exLog, today, since);
    const funStreak = currentStreak(u.id, funLog, today, since);
    const photoStreak = currentStreak(u.id, photoLog, today, since);
    const panel = ui.cell && ui.cell.userId === u.id ? cellPanel(u, ui.cell.date, today) : "";
    return `<div class="card board-user">
      <div class="board-head">
        <span>${u.emoji}</span>
        <b>${esc(u.name)}</b>
      </div>
      <div class="streaks">
        <span class="stats">🔥 ${cur} · best ${best} · ${tot}/30</span>
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
    ex && ex.done ? `✅ Exercise: ${esc(ex.activity || "done")}${ex.note ? " — " + esc(ex.note) : ""}` :
      (blank || "❌ No exercise logged"),
    fun && fun.done ? `🎉 Fun: ${esc(fun.activity || "done")}${fun.note ? " — " + esc(fun.note) : ""}` :
      (ds > today || preJoin ? "" : "⬜ No fun logged"),
  ].filter(Boolean);

  return `<div class="panel">
    <b>${esc(prettyDate(ds))}</b>
    ${lines.map(l => `<div class="small">${l}</div>`).join("")}
    ${fun && fun.photo_id ? `<img class="panel-photo" data-photo="${esc(fun.photo_id)}"
        data-action="photo-open" data-photo-id="${esc(fun.photo_id)}"
        data-id="${esc(u.id)}" data-date="${ds}" alt="Photo from ${esc(u.name)}">` : ""}
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
      <p><b>${p.emoji} ${esc(p.name)}</b></p>
      <div class="field">
        <label>Avatar</label>
        <div class="chips">${EMOJIS.map(e =>
          `<button class="chip ${p.emoji === e ? "on" : ""}" data-action="set-profile" data-key="emoji" data-val="${e}">${e}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Age band</label>
        <div class="chips">${AGE_BANDS.map(([v, l]) =>
          `<button class="chip ${p.ageBand === v ? "on" : ""}" data-action="set-profile" data-key="ageBand" data-val="${v}">${l}</button>`).join("")}</div>
      </div>
      <div class="field">
        <label>Main goal</label>
        <div class="chips">${GOALS.map(([v, l]) =>
          `<button class="chip ${p.goal === v ? "on" : ""}" data-action="set-profile" data-key="goal" data-val="${v}">${l}</button>`).join("")}</div>
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

function render() {
  for (const id of ["view-onboard", "view-today", "view-board", "view-gallery", "view-profile"]) {
    document.getElementById(id).classList.add("hidden");
  }
  const tabs = document.getElementById("tabs");
  const dayEl = document.getElementById("daycount");
  const today = todayStr();
  const n = septDayNum(today);
  dayEl.textContent = n ? `${prettyDate(today)} · day ${n}/30` : prettyDate(today);

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
  else show("view-profile", renderProfile());

  /* The lightbox lives outside <main> so switching views doesn't destroy it. */
  document.getElementById("lightbox").innerHTML = renderLightbox();
  /* Fills every <img data-photo> above: cached ones synchronously, so the
     60-second refresh doesn't make the gallery flicker. */
  hydratePhotos(document);
}

async function loadSuggestions() {
  const p = myProfile();
  if (!p) return;
  const yesterday = addDays(todayStr(), -1);
  const y = entryFor(exLog, yesterday, me.id);
  suggestions = await getSuggestions(p, todayStr(), y && y.activity ? [y.activity] : []);
}

/* ---------- actions ---------- */
async function onClick(ev) {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  const today = todayStr();

  if (a === "tab") {
    ui.tab = el.dataset.tab;
    ui.cell = null; ui.lightbox = null; ui.confirmFunClear = null;
    render();
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

  if (a === "photo-close") { ui.lightbox = null; render(); return; }

  if (a === "gallery-filter") { ui.galleryUser = el.dataset.id || null; render(); return; }

  if (a === "undo-fun-cancel") { ui.confirmFunClear = null; render(); return; }

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

  if (a === "draft") {
    const nameEl = document.getElementById("name-input");
    if (nameEl) ui.draft.name = nameEl.value;
    const pinEl = document.getElementById("pin-input");
    if (pinEl) ui.draft.pin = pinEl.value;
    ui.draft[el.dataset.key] = el.dataset.val;
    render();
    return;
  }

  if (a === "create-user") {
    const d = ui.draft;
    d.name = (document.getElementById("name-input").value || "").trim();
    d.pin = (document.getElementById("pin-input").value || "").trim();
    if (!d.name) return toast("Add your name first");
    if (!d.ageBand) return toast("Pick an age band");
    if (!d.goal) return toast("Pick a goal");
    if (!/^\d{4}$/.test(d.pin)) return toast("Choose a 4-digit PIN");
    try {
      const { id, token } = await api.createUser(d);
      setToken(token);
      me = { id, name: d.name };
      localStorage.setItem(ME_KEY, JSON.stringify(me));
      ui.draft.pin = "";
      await refresh();
      await loadSuggestions();
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
      await loadSuggestions();
      render();
    } catch (e) {
      toast(errorMessage(e));   /* "wrong PIN", or the lockout message */
    }
    return;
  }

  if (a === "toggle-suggestions") { ui.showSuggestions = !ui.showSuggestions; render(); return; }

  if (a === "log-ex") {
    await saveEntry({ date: today, kind: "exercise", done: true, activity: el.dataset.activity });
    toast("Nice — 30 minutes logged 💪");
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

  if (a === "set-profile") {
    const patch = { [el.dataset.key]: el.dataset.val };
    const u = getUser(me.id);
    if (el.dataset.key === "emoji") u.emoji = el.dataset.val;
    if (el.dataset.key === "ageBand") u.age_band = el.dataset.val;
    if (el.dataset.key === "goal") u.goal = el.dataset.val;
    render();
    try { await api.updateUser(patch); await loadSuggestions(); }
    catch (e) { if (isAuthError(e)) return signedOut(); toast("Couldn't save profile"); }
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
    draft.date = ui.photoTarget || todayStr();
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
  document.getElementById("photo-input").addEventListener("change", onPhotoPicked);
  render();
  await refresh();
  if (me && getUser(me.id)) await loadSuggestions();
  render();

  /* cheap multiplayer: refetch when the tab regains focus and every 60s */
  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && me) { await refresh(); render(); }
  });
  setInterval(async () => {
    /* Never re-render underneath an upload or a pending draft. */
    if (ui.photoBusy || ui.photoDraft) return;
    if (!document.hidden && me && !ui.needPasscode) { await refresh(); render(); }
  }, 60000);
}

boot();
window.__app = { get board() { return board; }, get exLog() { return exLog; }, render, refresh };
