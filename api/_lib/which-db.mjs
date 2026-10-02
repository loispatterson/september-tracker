/* Which database a script is pointed at.

   There are now three, and the names do not separate them. The friends' live
   board and Cairn are both called `neondb`, and the demo is a second database
   inside the live board's own Neon project, so it shares an endpoint with it.
   Either half alone gets it wrong: match on name and Cairn looks like the live
   board, match on endpoint and the demo does.

   So each database is identified by the pair, and the check is ordered most
   specific first. scripts/seed-demo.mjs already refused to run unless the URL
   said `septdemo`; this is the same idea made reliable now that the names
   collide.

   Every destructive or seeding script asks this before it does anything. */

export const DATABASES = {
  /* Cairn, the Movember pilot. Its own Neon project, so the endpoint is
     enough and is the only thing that is actually unique. */
  cairn: { endpoint: "ep-holy-cherry-zao9eayq" },

  /* The public demo: a separate database inside the live board's project, so
     it must be matched on the database name and checked before `live`. */
  demo: { database: "septdemo" },

  /* The friends' live board. Nothing but the app itself should ever write to
     this, which is why it is last and requires both halves to match. */
  live: { endpoint: "ep-nameless-silence", database: "neondb" },
};

function parts(url) {
  const m = String(url || "").match(/@([^/?]+)\/([^/?]+)/);
  return m ? { host: m[1], database: m[2] } : { host: "", database: "" };
}

export function whichDb(url = process.env.DATABASE_URL || "") {
  const { host, database } = parts(url);
  if (!host) return "unknown";
  for (const [name, want] of Object.entries(DATABASES)) {
    if (want.endpoint && !host.includes(want.endpoint)) continue;
    if (want.database && database !== want.database) continue;
    return name;
  }
  return "unknown";
}

/* Refuse loudly rather than doing something irreversible to the wrong board. */
export function requireDb(expected, url = process.env.DATABASE_URL || "") {
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const got = whichDb(url);
  if (got !== expected) {
    console.error(`Refusing to run: this script is for the "${expected}" database, ` +
                  `but DATABASE_URL points at "${got}".`);
    process.exit(1);
  }
  return got;
}
