# September Tracker

30 minutes of exercise **and** one fun thing, every day of September 2026 — for you and a few friends, on a shared board.

- **Today** — log your 30 minutes (tap an activity, or take one of three workout suggestions tuned to your age band and goal), plus today's fun idea (swap it, or write your own) and a photo of it if you want one.
- **Photos** — everyone's fun photos as a grid; tap one to enlarge.
- **Board** — everyone's 30-day grid, current/best streak and total. Green = exercise done, pink dot = fun done, red = missed, dashed = today, grey = not yet. Tap any cell to see what someone did; tap your own past cells to backfill.
- **You** — edit your profile, add fun ideas to the shared pool, copy the invite link.

No email addresses and no passwords. Two things guard it: a **shared board passcode** (everyone gets the same one, matched case-insensitively) and a **personal 4-digit PIN** you choose when you join. The passcode gets you to the board; your PIN proves you're you when logging in on a new device. Five wrong PINs locks that name for five minutes.

Writes are authorised by a session token issued when you sign up or enter your PIN, and the server takes your identity from that token — never from the request body — so nobody can log entries onto someone else's grid, even with the passcode and a terminal. Reading the board only needs the passcode; it's a shared board by design.

## Run it locally (no cloud, no database)

```bash
npm install
npm run dev:local     # http://localhost:3000
```

This uses `scripts/dev-server.mjs`, which stores everything in `scripts/.local-data.json`. Production uses the real `api/` functions against Postgres; the local server mirrors those routes so the UI behaves the same. **If you change an endpoint's shape, change both.**

## Deploy to Vercel

```bash
vercel login                        # interactive — run this yourself
vercel                              # link/create the project
# Vercel dashboard → Storage → Create Database → Neon → connects DATABASE_URL
vercel env add BOARD_PASSCODE       # optional shared passcode, e.g. "sweatsept"
vercel env pull .env.development.local
npm run db:init                     # applies scripts/schema.sql once
vercel dev                          # local, against the real database
vercel --prod                       # → your shareable URL
```

Then send friends the URL (and passcode). On a phone, **Share → Add to Home Screen** makes it feel like an app.

## Tests

```bash
npm test
```

Runs the same self-tests the browser can run (`import("/js/selftests.js").then(m => m.runSelfTests())`): date maths, the streak engine, workout selection, and the fun deck. No framework, no network.

To time-travel while testing, set `window.TODAY_OVERRIDE = "2026-09-14"` in devtools and reload.

## How it's built

Vanilla JS ES modules, no build step and no frontend dependencies; the only runtime dependency is `@neondatabase/serverless`, used inside the API functions.

```
index.html            app shell, three tabs
css/style.css         theme tokens + dark mode (follows your OS)
js/app.js             state, render loop, delegated click router
js/api.js             fetch client (adds the passcode header)
js/dates.js           YYYY-MM-DD local-time helpers
js/streaks.js         pure streak engine
js/suggestions.js     workout picker  ← the AI upgrade seam
js/fun.js             per-person shuffled deck of fun ideas
js/data/              workout library + curated fun prompts
api/                  board, users, claim, pin, log, fun-ideas
                      (+ _lib/db.js for access checks, _lib/auth.js for PINs/tokens)
scripts/              schema.sql, init-db.mjs, dev-server.mjs, run-tests.mjs
```

Design notes worth knowing:

- **Dates are strings** (`"2026-09-05"`) compared lexically, so there's no timezone drift. The day boundary is each person's local midnight.
- **Streaks**: today counts as *pending*, not missed, so your streak survives until the day actually ends. Days before you joined are neutral — joining on the 10th doesn't hand you nine red squares.
- **Fun ideas are dealt from a shuffled deck** unique to each person, so you get 30 different ideas and never the same one two days running. The idea's *text* is stored when you log it, so editing the pool later never rewrites history.
- **Writes are last-write-wins** upserts keyed on `(user, date, kind)`; the UI updates optimistically and refetches the board after each save, on tab focus, and every 60s.
- **PINs are stored salted and hashed** (PBKDF2-SHA256), never in plain text, and the board endpoint exposes only a `has_pin` boolean. Anyone who joined before PINs existed sets one on first login rather than staying claimable.
- **Photos** are shrunk in the browser (about 1200px, ~100–200 KB) before upload and stored in Postgres. `/api/board` carries only a `photo_id`, never image bytes, because it is refetched every 60 seconds; the bytes come from `/api/photo?id=…`, which is cached forever since a new upload always gets a fresh id. Un-logging a fun day deletes its photo, so the app asks first.
- **Three streaks**: exercise 🔥, fun 🎉 and photo 📸. A photo streak counts days in a row *with a photo*, so a fun day without one breaks it. All three come from the same pure functions in `js/streaks.js`.

### Phase 2: AI suggestions

`getSuggestions()` in `js/suggestions.js` is already async and is the only function the UI calls. To upgrade, change its body to `fetch("/api/suggest")`, add that function calling the Anthropic API with an `ANTHROPIC_API_KEY` env var, and keep `pickWorkouts()` as the offline fallback. Nothing in the UI needs to change.
