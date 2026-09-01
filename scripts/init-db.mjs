/* One-time schema setup: npm run db:init
   Needs DATABASE_URL. The Neon integration sets it for Production/Preview, so:
     vercel env pull --environment=production .env.production.local
   This uses the pg-compatible Client because the `neon()` tagged-template
   helper cannot run arbitrary DDL text. */
import { Client } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

for (const f of [".env.production.local", ".env.development.local", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Run: vercel env pull --environment=production .env.production.local");
  process.exit(1);
}

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");
/* Strip -- comments before splitting: a semicolon inside a comment would
   otherwise cut a statement in half. */
const statements = schema
  .split("\n")
  .map(line => line.replace(/--.*$/, ""))
  .join("\n")
  .split(";")
  .map(s => s.trim())
  .filter(Boolean);

const client = new Client(url);
await client.connect();
try {
  for (const stmt of statements) await client.query(stmt);
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`);
  console.log(`Applied ${statements.length} statements.`);
  console.log("Tables:", rows.map(r => r.table_name).join(", "));
} finally {
  await client.end();
}
