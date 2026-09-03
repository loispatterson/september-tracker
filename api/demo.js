import { sql, endpoint } from "./_lib/db.js";
import { newToken, hashPin } from "./_lib/auth.js";

/* POST /api/demo → a throwaway account, pre-filled, signed straight in.
   Only ever enabled on the demo deployment (DEMO_MODE=1).

   Each visitor gets their own account rather than everyone sharing one: on a
   public link, the first person to hit Undo would otherwise wipe the example
   for everyone after them. */

const ACTIVITIES = ["Run", "Walk", "Yoga", "Cycle", "Swim", "Gym"];
const FUN = [
  "Watched the sunset properly", "Cooked something new", "Called an old friend",
  "Took a photo walk", "Read in a café", "Baked and gave half away",
];
const FEELINGS = ["easy", "good", "good", "hard"];

/* Deterministic-ish variety without Math.random in the hot path of a seed. */
function pick(list, n) { return list[n % list.length]; }

export default endpoint(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (process.env.DEMO_MODE !== "1") {
    return res.status(404).json({ error: "not found" });
  }

  /* Tidy up guests from previous days so the demo board stays readable.
     Age is measured from the newest session, not users.created_at, because
     the account is backdated below so its seeded history reads correctly. */
  const stale = await sql`SELECT u.id FROM users u
                          LEFT JOIN sessions s ON s.user_id = u.id
                          WHERE u.name LIKE 'Guest %'
                          GROUP BY u.id
                          HAVING coalesce(max(s.created_at), 'epoch'::timestamptz)
                                 < now() - interval '2 days'`;
  const staleIds = stale.map((r) => r.id);
  if (staleIds.length) {
    await sql`DELETE FROM entries  WHERE user_id = ANY(${staleIds})`;
    await sql`DELETE FROM sessions WHERE user_id = ANY(${staleIds})`;
    await sql`DELETE FROM users    WHERE id      = ANY(${staleIds})`;
  }

  const n = Math.floor(Math.random() * 9000) + 1000;
  const id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const name = `Guest ${n}`;

  /* A few days of history so the board and streaks have something to show.
     Left deliberately imperfect: a missed day makes the grid look real.
     Only days that have already happened — never pre-fill the rest of the
     month, which would leave the visitor nothing to log. */
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const days = [];
  for (let back = 1; back <= 6; back++) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const ds = iso(d);
    if (ds < "2026-09-01" || ds > "2026-09-30") continue;
    if (back === 3) continue;                       /* one missed day */
    days.push({ ds, back });
  }

  /* Backdate the account to its own earliest day. The streak engine treats
     days before you joined as neutral rather than missed, so a same-day
     join would quietly hide the gap the seeded history is meant to show. */
  const joined = days.length ? days[days.length - 1].ds : iso(today);

  await sql`INSERT INTO users (id, name, emoji, age_band, goal, goals, fitness, note, pin_hash, created_at)
            VALUES (${id}, ${name}, '🙂', '40-44', 'general',
                    'weightloss,strength', 'occasional',
                    'Just having a look around', ${hashPin("0000")}, ${joined})`;

  for (const { ds, back } of days) {
    await sql`INSERT INTO entries (user_id, date, kind, done, activity, minutes, feeling)
              VALUES (${id}, ${ds}, 'exercise', true, ${pick(ACTIVITIES, back)},
                      ${30 + (back % 3) * 15}, ${pick(FEELINGS, back)})
              ON CONFLICT (user_id, date, kind) DO NOTHING`;
    if (back % 2 === 1) {
      await sql`INSERT INTO entries (user_id, date, kind, done, activity)
                VALUES (${id}, ${ds}, 'fun', true, ${pick(FUN, back)})
                ON CONFLICT (user_id, date, kind) DO NOTHING`;
    }
  }

  const token = newToken();
  await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${id})`;
  res.status(200).json({ id, name, token });
});
