import express from "express";
import cors from "cors";
import dotenv from "dotenv";

//temp to test it works as intended
import multer from "multer";
import crypto from "crypto";
import { pool } from "./db.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// will keep uploads in memory for now - will store in actual database later
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "wave-api" });
});

app.get("/api/db-check", async (req, res) => {
  const r = await pool.query("SELECT now() as now");
  res.json(r.rows[0]);
});

app.post("/api/tracks", upload.single("audio"), async (req, res) => {
  const client = await pool.connect();

  try {
    // field extractions
    const { title, primaryArtist, releaseDate, isrc, contributors } = req.body;

    if (!title?.trim()) return res.status(400).send("Missing title");
    if (!primaryArtist?.trim()) return res.status(400).send("Missing primaryArtist");
    if (!releaseDate) return res.status(400).send("Missing releaseDate");
    if (!req.file) return res.status(400).send("Missing audio file");

    // parse contributors (sent as JSON string in FormData)
    let contributorsArr;
    try {
      contributorsArr = JSON.parse(contributors || "[]");
    } catch {
      return res.status(400).send("Invalid contributors JSON");
    }

    if (!Array.isArray(contributorsArr) || contributorsArr.length === 0) {
      return res.status(400).send("At least one contributor is required");
    }

    // validate split totals = 100
    const total = contributorsArr.reduce((sum, c) => {
      const n = Number(c.share);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    if (Math.abs(total - 100) > 0.0001) {
      return res.status(400).send(`Split total must equal 100. Current total: ${total}`);
    }

    // DB interaction
    await client.query("BEGIN");

    // 1 - insert track
    const trackRes = await client.query(
      `INSERT INTO tracks (title, primary_artist_name, release_date, isrc, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        title.trim(),
        primaryArtist.trim(),
        releaseDate,
        isrc?.trim() || null,
        null // TODO : created_by_user_id from logged in user
      ]
    );

    const trackId = trackRes.rows[0].id;

    // 2 - create split agreement
    const agreementRes = await client.query(
      `INSERT INTO split_agreements (track_id, status)
       VALUES ($1, 'ACTIVE')
       RETURNING id`,
      [trackId]
    );

    const agreementId = agreementRes.rows[0].id;

    // 3 - insert split shares
    for (const c of contributorsArr) {
      await client.query(
        `INSERT INTO split_shares
         (agreement_id, contributor_name, contributor_role, share_percent, contributor_email)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          agreementId,
          (c.name || "").trim(),
          c.role || "Artist",
          Number(c.share),
          c.email?.trim() || null
        ]
      );
    }

    // 4) insert audio metadata (file storage can come later)
    await client.query(
      `INSERT INTO audio_assets
       (track_id, original_filename, mime_type, size_bytes, storage_provider, object_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        trackId,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        "local",
        null // later: set to an uploads path OR S3 key
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json({ trackId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).send("Database error");
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));