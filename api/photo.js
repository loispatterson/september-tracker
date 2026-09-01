import { sql, endpoint, bad } from "./_lib/db.js";
import { validatePhoto, newPhotoId, stripDataUrl, b64Bytes } from "./_lib/photos.js";

/* GET    ?id=p_xxx   → the image bytes (passcode only: photos are shared)
   POST   {date,b64,mime,w,h} → upsert your photo for that day
   DELETE ?date=…     → remove your photo, keeping the fun entry */
export default endpoint(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  if (req.method === "DELETE") return del(req, res);
  res.status(405).json({ error: "method" });
});

async function get(req, res) {
  const id = String(req.query?.id || "");
  if (!id) return bad(res, "id required");

  const rows = await sql`SELECT mime, encode(data, 'base64') AS b64
                         FROM entry_photos WHERE id = ${id}`;
  if (!rows.length) return res.status(404).json({ error: "not found" });

  /* An id is regenerated on every upload, so bytes for a given id never change
     and can be cached hard. private, never public: these are passcode-gated. */
  const etag = `"${id}"`;
  if (req.headers["if-none-match"] === etag) {
    res.setHeader("ETag", etag);
    return res.status(304).end();
  }
  const buf = Buffer.from(rows[0].b64, "base64");
  res.setHeader("Content-Type", rows[0].mime);
  res.setHeader("Content-Length", buf.length);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("ETag", etag);
  res.status(200).end(buf);
}

/* Writes need a session; the reader above only needs the board passcode. */
const post = endpoint(async (req, res, userId) => {
  const { date, mime, w, h, activity } = req.body || {};
  const b64 = stripDataUrl((req.body || {}).b64);
  const problem = validatePhoto({ date, mime, b64 });
  if (problem) return res.status(problem.status).json({ error: problem.error });

  /* The photo's foreign key needs a fun entry to hang off. DO NOTHING, never
     DO UPDATE: attaching a photo must not overwrite an existing note or
     activity someone already wrote for that day. */
  await sql`INSERT INTO entries (user_id, date, kind, done, activity, updated_at)
            VALUES (${userId}, ${date}, 'fun', true,
                    ${activity ? String(activity).slice(0, 200) : "Photo"}, now())
            ON CONFLICT (user_id, date, kind) DO NOTHING`;

  const id = newPhotoId();
  const bytes = b64Bytes(b64);
  await sql`INSERT INTO entry_photos (id, user_id, date, kind, mime, width, height, bytes, data)
            VALUES (${id}, ${userId}, ${date}, 'fun', ${mime},
                    ${Number(w) || null}, ${Number(h) || null}, ${bytes}, decode(${b64}, 'base64'))
            ON CONFLICT (user_id, date, kind) DO UPDATE SET
              id = EXCLUDED.id, mime = EXCLUDED.mime,
              width = EXCLUDED.width, height = EXCLUDED.height,
              bytes = EXCLUDED.bytes, data = EXCLUDED.data, created_at = now()`;

  res.status(200).json({ photoId: id, bytes });
}, { auth: true });

const del = endpoint(async (req, res, userId) => {
  const date = String(req.query?.date || "");
  if (!date) return bad(res, "date required");
  await sql`DELETE FROM entry_photos WHERE user_id = ${userId} AND date = ${date}`;
  res.status(200).json({ ok: true });
}, { auth: true });
