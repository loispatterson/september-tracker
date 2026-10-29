# A shared daily board

One codebase, two challenges. Which one a deployment runs is decided by the
`CHALLENGE` environment variable, and **its absence means the original**, so
the friends' board gets no new variable and no new code path.

- **`wellbeing`** (the default) — 30 minutes of exercise **and** one fun thing,
  every day of the month, for you and a few friends.
- **`movember`** — **Cairn**, *everyone adds a stone*: a daily moustache photo
  for thirty days, with viewer accounts for people who sponsor and watch rather
  than grow. Movember is a trademark and their guidelines forbid using the word
  in a product name, so the app is Cairn and the copy says who it is for.

Every challenge-specific string and rule lives in `js/challenge.js`. Nothing
else should need to know which challenge it is.

## The wellbeing board

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

## Deploying Cairn

A **separate Vercel project** (`cairn`) with a **separate Neon database**,
pinned to the `movember` branch and set `CHALLENGE=movember`. `main` stays
frozen for the duration of the pilot.

Two deployments buy no extra serverless functions — both build the same `api/`
directory from the same commit, so both sit against the same Hobby limit of
twelve. The reason for two projects is risk isolation only: no commit that
could break the friends' board is ever deployed to it.

Deploying is a `git push` to `movember`. Nothing else. `vercel-build` runs
`scripts/stamp-html.mjs`, which writes the challenge's title, manifest link and
apple-touch-icon into `index.html` before it is served — iOS reads those from
the HTML as served, so correcting them from JavaScript afterwards is too late.

Schema changes go to the database **before** the push that needs them, because
a push deploys immediately and an endpoint that expects a column the database
hasn't got fails on live signup:

```sh
printf 'DATABASE_URL=%s\n' '<cairn pooled url>' > .env.cairn.local
node --env-file=.env.cairn.local scripts/init-db.mjs
git push origin movember
```

`schema.sql` is idempotent — every statement is `IF NOT EXISTS` — so running it
again is safe and is the normal way to apply a migration. `init-db.mjs` splits
the file naively on `;`, so **no comment or literal in `schema.sql` may contain
a semicolon**; a test enforces this, because the failure mode is a half-applied
migration rather than an error.

## Running the pilot

Three scripts carry the measurement. None of what they record can be
reconstructed afterwards, so they matter from day one rather than in December.

All three need Cairn's `DATABASE_URL`. Pass it with `--env-file` rather than
inline, so the connection string stays out of shell history:

```sh
alias cairn='node --env-file=.env.cairn.local'

cairn scripts/record-totals.mjs                     # lists the pages to read
cairn scripts/record-totals.mjs lois=120 ahmed=45.5 # writes today's figures
cairn scripts/pilot-report.mjs                      # the four questions
cairn scripts/pilot-report.mjs 2026-11              # a specific month
cairn scripts/delete-user.mjs <name>                # removes someone completely
```

The `npm run totals` / `report` / `forget` shortcuts do the same thing but read
`DATABASE_URL` from the environment, so they are for the wellbeing board.

`totals` is deliberately manual. A scraper against someone else's fundraising
site breaks the week they change their markup, fails quietly, and the readings
are gone for good — those pages only ever show today's total. Twice a week, by
hand, buys a series that is certainly right.

`forget` is the answer to "take me off it". The board is a public URL with real
names and faces on it, so that request has to have an answer on the evening
somebody makes it.

## Notifications

One evening nudge to people who haven't posted, and a late one only to someone
with a streak worth saving. Never on a day you've already posted — a
notification that arrives when there's nothing to do teaches people to swipe
the next one away unread.

Sending runs in **GitHub Actions, not on Vercel**. Hobby allows twelve
serverless functions and `api/` holds exactly twelve, so a sender there would
be the thirteenth and the deploy would fail quietly. Hobby cron also fires once
a day with no control over the hour.

Setting it up, once:

```sh
node scripts/vapid-keys.mjs     # prints both keys and where each one goes
```

The public key goes in `VAPID_PUBLIC_KEY` on Vercel **and** in GitHub Actions
secrets. The private key goes in GitHub secrets **only** — nothing in `api/`
sends a notification, so the deployment has no reason to be able to. Generate
once and keep them: changing the keys invalidates every subscription already
issued, and every phone stops receiving with nothing in any log to say why.

Until `VAPID_PUBLIC_KEY` is set, the notifications row hides itself and the
app behaves exactly as it did before.

To test without waking anyone: Actions → **nudge** → Run workflow, leaving
*print instead of sending* ticked.

**On an iPhone** push only works once the app has been added to the Home Screen
and opened from that icon — three manual taps no code can trigger. The You tab
shows the steps and hides the enable button until then, because a button that
cannot work reads as the app being broken. Expect roughly a third of iPhone
users not to complete it.

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

## Public demo

`https://september-tracker-demo.vercel.app` is a separate Vercel project running
this same code against a separate Neon database (`septdemo`), with
`DEMO_MODE=1` and no `BOARD_PASSCODE`. It exists so the app can be linked
publicly without exposing the real board.

`DEMO_MODE=1` changes three things and nothing else:

- `POST /api/demo` starts answering. Elsewhere it is a 404.
- Each visitor gets their own throwaway `Guest NNNN` account with a couple of
  days already logged, so the board is never empty. Guests idle for two days
  are deleted on the next visit.
- `/api/board` hides everyone else's guest account, so a visitor sees the two
  example people plus themselves rather than a row per person who ever
  clicked the link.

To refresh the example people (Ada and Sam):

    DATABASE_URL='<septdemo url>' node scripts/seed-demo.mjs

Their history is written relative to today, so re-running it any day in
September brings them up to date rather than leaving them looking like they
gave up in week one. Worth re-running every few days while the demo is being
shared.

The gallery images in `scripts/demo-photos/` are drawn, not photographed: the
demo is public, so it can't show anyone's real pictures. To change them, edit
the scenes in `scripts/demo-photos.mjs`, re-render, then re-seed:

    PLAYWRIGHT_CORE=<path to playwright-core> node scripts/demo-photos.mjs

The photo id embeds a hash of the image bytes, so a redrawn scene gets a new
id and bypasses the immutable cache `/api/photo` sets on photo bytes.

Deploying the demo means relinking the directory, so put it back afterwards:

    cp .vercel/project.json /tmp/main.json
    vercel link --yes --project september-tracker-demo
    vercel deploy --prod --yes
    cp /tmp/main.json .vercel/project.json

The demo has no `ANTHROPIC_API_KEY`, so suggestions come from the built-in
library rather than Claude. Adding the key would turn AI suggestions on, but
it also puts a paid API call behind a public link.
