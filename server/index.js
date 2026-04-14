import express from "express";
import cors from "cors";
import dotenv from "dotenv";

//temp to test it works as intended
import multer from "multer";
import path from "path";

import { pool } from "./db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createStorageAdapterFromEnv } from "./storage/storage.js";
import { appendLedgerEvent, appendLedgerEvents } from "./ledger/ledger.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "Ps_XcibxJTQT4AYP5KItvoNpiIRSyPzpO5zivUJ1Hgg=";
const storage = createStorageAdapterFromEnv();

// File uploads stored in memory (temporary).
// Will be replaced with persistent storage later.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB max file size
});

// Convert percentage (e.g. 12.5) to basis points (1250).
// Stored as BigInt-compatible value for financial precision.
function toBasisPoints(sharePercent) {
  const n = Number(sharePercent);
  return BigInt(Math.round(n * 100)); // 2dp -> basis points
}

// Allocate share using basis points (out of 10,000).
// Uses BigInt to avoid floating-point errors in money calculations.
function allocByBp(totalPennies, bp) {
  return (totalPennies * bp) / 10000n;
}

// JWT authentication middleware.
// - Expects "Authorization: Bearer <token>"
// - Verifies signature and expiry
// - Attaches { userId, role } to req.user
function extractToken(req, allowQuery = false) {
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (bearer) return bearer;
  if (allowQuery && typeof req.query.token === "string" && req.query.token.length > 0) {
    return req.query.token;
  }
  return null;
}

function authenticate(req, res, next) {
  const token = extractToken(req, false);
  if (!token) return res.status(401).send("Missing auth token");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { userId: payload.userId, role: payload.role };
    return next();
  } catch {
    return res.status(401).send("Invalid or expired token");
  }
}

function authenticateStream(req, res, next) {
  const token = extractToken(req, true);
  if (!token) return res.status(401).send("Missing auth token");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { userId: payload.userId, role: payload.role };
    return next();
  } catch {
    return res.status(401).send("Invalid or expired token");
  }
}

// Role-based authorization middleware.
// Usage: requireRole("CREATOR", "LABEL")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user?.role) return res.status(401).send("Unauthorized");
    if (!roles.includes(req.user.role)) return res.status(403).send("Forbidden");
    return next();
  };
}

function escapeCsvField(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function penniesToGbpString(pennies) {
  let p;
  try {
    p = BigInt(pennies || 0);
  } catch {
    p = 0n;
  }
  const isNeg = p < 0n;
  const abs = isNeg ? -p : p;
  const pounds = abs / 100n;
  const rest = abs % 100n;
  const out = `${pounds.toString()}.${rest.toString().padStart(2, "0")}`;
  return isNeg ? `-${out}` : out;
}

function normalizeEmail(email) {
  if (!email) return null;
  const s = String(email).trim().toLowerCase();
  return s.length > 0 ? s : null;
}

// =====================================================
// Health & Diagnostics
// =====================================================

// Basic liveness check (used for uptime monitoring)
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "wave-api" });
});

// Verifies database connectivity
app.get("/api/db-check", async (req, res) => {
  const r = await pool.query("SELECT now() as now");
  res.json(r.rows[0]);
});

// Public: serve cover art for a track (if present).
// This is intentionally unauthenticated so <img src="..."> can load it without attaching JWT headers.
app.get("/api/tracks/:id/cover", async (req, res) => {
  const trackId = req.params.id;
  try {
    const assetRes = await pool.query(
      `SELECT object_key, mime_type
       FROM public.cover_assets
       WHERE track_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [trackId]
    );
    if (assetRes.rows.length === 0) return res.status(404).send("No cover art");

    const { object_key: objectKey, mime_type: mimeType } = assetRes.rows[0];
    const out = await storage.getObjectStream({ key: objectKey });

    res.status(out.statusCode || 200);
    res.setHeader("Content-Type", mimeType || out.contentType || "application/octet-stream");
    if (out.contentLength != null) res.setHeader("Content-Length", String(out.contentLength));
    res.setHeader("Cache-Control", "public, max-age=3600");
    return out.body.pipe(res);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load cover art");
  }
});

// =====================================================
// Health & Diagnostics
// =====================================================

// Register new user and issue JWT
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, displayName, role } = req.body || {};
    if (!email?.trim()) return res.status(400).send("Email is required");
    if (!password || password.length < 8) return res.status(400).send("Password must be at least 8 characters");

    const normalizedRole = (role || "CREATOR").toUpperCase();
    if (!["CREATOR", "LISTENER"].includes(normalizedRole)) {
      return res.status(400).send("Invalid role");
    }

    const existing = await pool.query(`SELECT id FROM public.users WHERE email = $1`, [email.trim()]);
    if (existing.rows.length > 0) return res.status(409).send("Email already registered");

    const hash = await bcrypt.hash(password, 10);

    const insertRes = await pool.query(
      `INSERT INTO public.users (email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, role`,
      [email.trim(), displayName?.trim() || null, hash, normalizedRole]
    );

    const user = insertRes.rows[0];
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "1h" });

    return res.json({ token, user: { id: user.id, role: user.role, email: email.trim(), display_name: displayName?.trim() || null } });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Registration failed");
  }
});

// Authenticate credentials and return JWT
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim()) return res.status(400).send("Email is required");
    if (!password) return res.status(400).send("Password is required");

    const userRes = await pool.query(
      `SELECT id, email, display_name, role, password_hash, is_active
       FROM public.users
       WHERE email = $1`,
      [email.trim()]
    );

    if (userRes.rows.length === 0) return res.status(401).send("Invalid credentials");
    const user = userRes.rows[0];
    if (!user.is_active) return res.status(403).send("Account disabled");
    if (user.role === "LABEL") return res.status(403).send("Role not allowed");

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).send("Invalid credentials");

    await pool.query(`UPDATE public.users SET last_login_at = now() WHERE id = $1`, [user.id]);

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "1h" });
    return res.json({
      token,
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Login failed");
  }
});

// Return current authenticated user's profile
app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const userRes = await pool.query(
      `SELECT id, email, display_name, role, created_at
       FROM public.users
       WHERE id = $1`,
      [req.user.userId]
    );
    if (userRes.rows.length === 0) return res.status(404).send("User not found");
    return res.json(userRes.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load user");
  }
});

// =====================================================
// Track Management
// =====================================================

// Create new track with split agreement and audio metadata (CREATOR only)
app.post("/api/tracks", authenticate, requireRole("CREATOR", "ADMIN"), upload.fields([{ name: "audio", maxCount: 1 }, { name: "cover", maxCount: 1 }]), async (req, res) => {
  // Transaction ensures track, splits, and audio metadata are atomic
  const client = await pool.connect();
  let uploadedObjectKey = null;
  let uploadedCoverKey = null;

  try {
    // field extractions
    const { title, primaryArtist, releaseDate, isrc, contributors } = req.body;

    const audioFile = req.files?.audio?.[0] || null;
    const coverFile = req.files?.cover?.[0] || null;

    if (!title?.trim()) return res.status(400).send("Missing title");
    if (!primaryArtist?.trim()) return res.status(400).send("Missing primaryArtist");
    if (!releaseDate) return res.status(400).send("Missing releaseDate");
    if (!audioFile) return res.status(400).send("Missing audio file");

    if (coverFile) {
      if (!String(coverFile.mimetype || "").toLowerCase().startsWith("image/")) {
        return res.status(400).send("Cover must be an image");
      }
      if (Number(coverFile.size || 0) > 5 * 1024 * 1024) {
        return res.status(400).send("Cover image is too large (max 5MB)");
      }
    }

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
        req.user.userId
      ]
    );

    const trackId = trackRes.rows[0].id;
    const audioExt = path.extname(audioFile.originalname || "") || ".bin";
    const objectKey = `tracks/${trackId}/audio/original${audioExt.toLowerCase()}`;

    await storage.putObject({
      key: objectKey,
      body: audioFile.buffer,
      contentType: audioFile.mimetype || "application/octet-stream"
    });
    uploadedObjectKey = objectKey;

    let coverObjectKey = null;
    if (coverFile) {
      const coverExt = path.extname(coverFile.originalname || "") || ".img";
      coverObjectKey = `tracks/${trackId}/cover/original${coverExt.toLowerCase()}`;
      await storage.putObject({
        key: coverObjectKey,
        body: coverFile.buffer,
        contentType: coverFile.mimetype || "application/octet-stream"
      });
      uploadedCoverKey = coverObjectKey;
    }

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

    // 4 - insert audio metadata (file storage can come later)
    await client.query(
      `INSERT INTO audio_assets
       (track_id, original_filename, mime_type, size_bytes, storage_provider, object_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        trackId,
        audioFile.originalname,
        audioFile.mimetype,
        audioFile.size,
        "minio",
        objectKey
      ]
    );

    if (coverFile && coverObjectKey) {
      await client.query(
        `INSERT INTO public.cover_assets
         (track_id, original_filename, mime_type, size_bytes, storage_provider, object_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          trackId,
          coverFile.originalname,
          coverFile.mimetype,
          coverFile.size,
          "minio",
          coverObjectKey
        ]
      );
    }

    await appendLedgerEvent(client, {
      occurredAt: new Date(),
      eventType: "TRACK_REGISTERED",
      actorUserId: req.user.userId,
      entityType: "track",
      entityId: trackId,
      payload: {
        title: title.trim(),
        primaryArtistName: primaryArtist.trim(),
        objectKey,
        coverObjectKey,
        storageProvider: "minio"
      }
    });

    await client.query("COMMIT");
    return res.status(201).json({ trackId });
  } catch (e) {
    await client.query("ROLLBACK");
    if (uploadedObjectKey) {
      try {
        await storage.deleteObject({ key: uploadedObjectKey });
      } catch (cleanupErr) {
        console.error("Failed to cleanup uploaded object after rollback", cleanupErr);
      }
    }
    if (uploadedCoverKey) {
      try {
        await storage.deleteObject({ key: uploadedCoverKey });
      } catch (cleanupErr) {
        console.error("Failed to cleanup uploaded cover object after rollback", cleanupErr);
      }
    }
    console.error(e);
    return res.status(500).send("Database error");
  } finally {
    client.release();
  }
});

// List tracks (optionally filtered to current user via ?createdBy=me)
app.get("/api/tracks", async (req, res) => {
  try {
    // later you can filter by created_by_user_id when auth exists
    const createdBy = req.query.createdBy;
    const collaborations = req.query.collaborations;
    if (createdBy === "me") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).send("Missing auth token");
      let userId;
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        userId = payload.userId;
      } catch {
        return res.status(401).send("Invalid or expired token");
      }

      const result = await pool.query(
        `SELECT
           t.id,
           t.title,
           t.primary_artist_name,
           t.release_date,
           t.created_at,
           (ca.id IS NOT NULL) AS has_cover,
           CASE WHEN scr.id IS NULL THEN 'ACTIVE' ELSE 'PENDING' END AS split_change_status,
           scr.id AS pending_request_id
         FROM public.tracks t
         LEFT JOIN public.cover_assets ca ON ca.track_id = t.id
         LEFT JOIN LATERAL (
           SELECT id
           FROM public.split_change_requests
           WHERE track_id = t.id
             AND status = 'PENDING'
           ORDER BY created_at DESC
           LIMIT 1
         ) scr ON true
         WHERE t.created_by_user_id = $1
         ORDER BY t.created_at DESC`,
        [userId]
      );
      return res.json({ tracks: result.rows });
    }

    if (collaborations === "me") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).send("Missing auth token");
      let userId;
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        userId = payload.userId;
      } catch {
        return res.status(401).send("Invalid or expired token");
      }

      const emailRes = await pool.query(
        `SELECT lower(email) AS email
         FROM public.users
         WHERE id = $1`,
        [userId]
      );
      const userEmail = String(emailRes.rows[0]?.email || "").toLowerCase();
      if (!userEmail) return res.json({ tracks: [] });

      const result = await pool.query(
        `SELECT
           t.id,
           t.title,
           t.primary_artist_name,
           t.release_date,
           t.created_at,
           (ca.id IS NOT NULL) AS has_cover,
           CASE WHEN scr.id IS NULL THEN 'ACTIVE' ELSE 'PENDING' END AS split_change_status,
           scr.id AS pending_request_id
         FROM public.tracks t
         LEFT JOIN public.cover_assets ca ON ca.track_id = t.id
         LEFT JOIN LATERAL (
           SELECT id
           FROM public.split_change_requests
           WHERE track_id = t.id
             AND status = 'PENDING'
           ORDER BY created_at DESC
           LIMIT 1
         ) scr ON true
         WHERE t.created_by_user_id IS DISTINCT FROM $1
           AND (
             EXISTS (
               SELECT 1
               FROM public.split_agreements sa
               JOIN public.split_shares ss ON ss.agreement_id = sa.id
               WHERE sa.track_id = t.id
                 AND sa.status = 'ACTIVE'
                 AND lower(ss.contributor_email) = $2
             )
             OR EXISTS (
               SELECT 1
               FROM public.split_change_requests scr2
               JOIN public.split_change_shares scs ON scs.request_id = scr2.id
               WHERE scr2.track_id = t.id
                 AND scr2.status = 'PENDING'
                 AND lower(scs.contributor_email) = $2
             )
           )
         ORDER BY t.created_at DESC`,
        [userId, userEmail]
      );
      return res.json({ tracks: result.rows });
    }

    const result = await pool.query(
      `SELECT
         t.id,
         t.title,
         t.primary_artist_name,
         t.release_date,
         t.created_at,
         (ca.id IS NOT NULL) AS has_cover
       FROM public.tracks t
       LEFT JOIN public.cover_assets ca ON ca.track_id = t.id
       ORDER BY t.created_at DESC`
    );

    res.json({ tracks: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).send("Database error");
  }
});

// Creator-only: detailed earnings breakdown for a single track + month.
app.get("/api/tracks/:id/earnings", authenticate, requireRole("CREATOR", "ADMIN"), async (req, res) => {
  const trackId = req.params.id;
  const requestedMonth = req.query.month;

  if (requestedMonth && !/^\d{4}-\d{2}-01$/.test(String(requestedMonth))) {
    return res.status(400).send("Invalid month format. Use YYYY-MM-01");
  }

  try {
    const userId = req.user.userId;

    const userRes = await pool.query(
      `SELECT email
       FROM public.users
       WHERE id = $1`,
      [userId]
    );
    const userEmail = String(userRes.rows[0]?.email || "").toLowerCase();

    const trackRes = await pool.query(
      `SELECT id, title, primary_artist_name, release_date, isrc, created_by_user_id
       FROM public.tracks
       WHERE id = $1`,
      [trackId]
    );
    if (trackRes.rows.length === 0) return res.status(404).send("Track not found");
    const track = trackRes.rows[0];

    const isAdmin = req.user.role === "ADMIN";
    const isOwner = String(track.created_by_user_id) === String(userId);

    if (!isAdmin && !isOwner) {
      // Allow collaborators (by contributor_email) to view insights too.
      const collabRes = await pool.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM public.split_agreements sa
             JOIN public.split_shares ss ON ss.agreement_id = sa.id
             WHERE sa.track_id = $1
               AND sa.status = 'ACTIVE'
               AND lower(ss.contributor_email) = $2
           ) OR EXISTS (
             SELECT 1
             FROM public.split_change_requests scr
             JOIN public.split_change_shares scs ON scs.request_id = scr.id
             WHERE scr.track_id = $1
               AND scr.status = 'PENDING'
               AND lower(scs.contributor_email) = $2
           ) AS ok`,
        [trackId, userEmail]
      );
      if (!collabRes.rows[0]?.ok) return res.status(403).send("Forbidden");
    }

    // Resolve month + runId
    let monthStart = requestedMonth ? String(requestedMonth) : null;
    let runId = null;

    if (!monthStart) {
      const latestRunRes = await pool.query(
        `SELECT rr.id AS run_id, rr.month_start
         FROM public.royalty_runs rr
         JOIN public.royalty_allocations ra ON ra.run_id = rr.id
         WHERE ra.track_id = $1
         ORDER BY rr.month_start DESC
         LIMIT 1`,
        [trackId]
      );
      if (latestRunRes.rows.length > 0) {
        runId = latestRunRes.rows[0].run_id;
        monthStart = latestRunRes.rows[0].month_start;
      }
    } else {
      const runRes = await pool.query(
        `SELECT id
         FROM public.royalty_runs
         WHERE month_start = $1`,
        [monthStart]
      );
      runId = runRes.rows[0]?.id || null;
    }

    // Play stats for this month (0 if no monthStart resolved)
    let playStats = { playEvents: 0, listenedMs: "0", uniqueListeners: 0 };
    if (monthStart) {
      const playStatsRes = await pool.query(
        `SELECT
           COUNT(*)::bigint AS play_events,
           COALESCE(SUM(listened_ms), 0)::bigint AS listened_ms,
           COUNT(DISTINCT listener_user_id)::bigint AS unique_listeners
         FROM public.play_events
         WHERE track_id = $1
           AND month_start = $2`,
        [trackId, monthStart]
      );
      playStats = {
        playEvents: Number(playStatsRes.rows[0]?.play_events || 0),
        listenedMs: String(playStatsRes.rows[0]?.listened_ms || 0),
        uniqueListeners: Number(playStatsRes.rows[0]?.unique_listeners || 0)
      };
    }

    // Active splits for the track.
    const splitsRes = await pool.query(
      `SELECT ss.contributor_name, ss.contributor_role, ss.contributor_email, ss.share_percent
       FROM public.split_agreements sa
       JOIN public.split_shares ss ON ss.agreement_id = sa.id
       WHERE sa.track_id = $1
         AND sa.status = 'ACTIVE'
       ORDER BY ss.share_percent DESC, ss.contributor_name ASC`,
      [trackId]
    );

    const hasSplits = splitsRes.rows.length > 0;

    // Allocation totals for (runId, trackId).
    let trackTotalPennies = 0n;
    const allocationByKey = new Map(); // name|role -> pennies(BigInt)

    if (runId) {
      const allocAggRes = await pool.query(
        `SELECT
           contributor_name,
           contributor_role,
           COALESCE(SUM(amount_pennies), 0)::bigint AS amount_pennies
         FROM public.royalty_allocations
         WHERE run_id = $1
           AND track_id = $2
         GROUP BY contributor_name, contributor_role`,
        [runId, trackId]
      );

      for (const r of allocAggRes.rows) {
        const pennies = BigInt(r.amount_pennies || 0);
        trackTotalPennies += pennies;
        allocationByKey.set(`${r.contributor_name}||${r.contributor_role}`, pennies);
      }
    }

    let contributors = [];
    if (!hasSplits) {
      contributors = [
        {
          name: track.primary_artist_name,
          role: "Primary Artist",
          email: null,
          sharePercent: 100,
          earningsPennies: trackTotalPennies.toString(),
          isYou: false
        }
      ];
    } else {
      contributors = splitsRes.rows.map((r) => {
        const key = `${r.contributor_name}||${r.contributor_role}`;
        const pennies = allocationByKey.get(key) || 0n;
        const email = r.contributor_email ? String(r.contributor_email) : null;
        const isYou = Boolean(email && userEmail && email.toLowerCase() === userEmail);
        return {
          name: r.contributor_name,
          role: r.contributor_role,
          email,
          sharePercent: Number(r.share_percent),
          earningsPennies: pennies.toString(),
          isYou
        };
      });
    }

    const yourPennies = contributors.reduce((sum, c) => sum + (c.isYou ? BigInt(c.earningsPennies || 0) : 0n), 0n);
    const hasYouMatch = contributors.some((c) => c.isYou);

    return res.json({
      track: {
        id: track.id,
        title: track.title,
        primaryArtistName: track.primary_artist_name,
        releaseDate: track.release_date,
        isrc: track.isrc || null
      },
      monthStart,
      runId,
      playStats,
      earnings: {
        trackTotalPennies: trackTotalPennies.toString(),
        yourPennies: yourPennies.toString(),
        hasYouMatch
      },
      contributors
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load track earnings");
  }
});

// =====================================================
// Split Changes (UC3)
// =====================================================

// Propose a split change for a track (owner or ADMIN).
app.post("/api/tracks/:id/split-changes", authenticate, requireRole("CREATOR", "ADMIN"), async (req, res) => {
  const trackId = req.params.id;
  const shares = req.body?.shares;

  if (!Array.isArray(shares) || shares.length === 0) {
    return res.status(400).send("shares is required");
  }

  const normalizedShares = shares.map((s) => ({
    name: String(s?.name || "").trim(),
    role: String(s?.role || "").trim() || "Artist",
    sharePercent: Number(s?.sharePercent),
    email: normalizeEmail(s?.email)
  }));

  for (const s of normalizedShares) {
    if (!s.name) return res.status(400).send("Each share must have a contributor name");
    if (!Number.isFinite(s.sharePercent) || s.sharePercent < 0 || s.sharePercent > 100) {
      return res.status(400).send("Each sharePercent must be a number between 0 and 100");
    }
  }

  const total = normalizedShares.reduce((sum, s) => sum + s.sharePercent, 0);
  if (Math.abs(total - 100) > 0.0001) {
    return res.status(400).send(`Split total must equal 100. Current total: ${total}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const proposerEmailRes = await client.query(
      `SELECT lower(email) AS email
       FROM public.users
       WHERE id = $1`,
      [req.user.userId]
    );
    const proposerEmail = proposerEmailRes.rows[0]?.email || null;

    const trackRes = await client.query(
      `SELECT id, created_by_user_id, title
       FROM public.tracks
       WHERE id = $1`,
      [trackId]
    );
    if (trackRes.rows.length === 0) return res.status(404).send("Track not found");

    const track = trackRes.rows[0];
    if (req.user.role !== "ADMIN" && String(track.created_by_user_id) !== String(req.user.userId)) {
      return res.status(403).send("Forbidden");
    }

    const existingPending = await client.query(
      `SELECT id
       FROM public.split_change_requests
       WHERE track_id = $1
         AND status = 'PENDING'
       LIMIT 1`,
      [trackId]
    );
    if (existingPending.rows.length > 0) {
      return res.status(409).send("A split change request is already pending for this track");
    }

    const requestRes = await client.query(
      `INSERT INTO public.split_change_requests
       (track_id, proposed_by_user_id, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id`,
      [trackId, req.user.userId]
    );
    const requestId = requestRes.rows[0].id;
    const now = new Date();

    for (const s of normalizedShares) {
      await client.query(
        `INSERT INTO public.split_change_shares
         (request_id, contributor_name, contributor_role, share_percent, contributor_email)
         VALUES ($1, $2, $3, $4, $5)`,
        [requestId, s.name, s.role, s.sharePercent, s.email]
      );
    }

    const distinctEmails = [...new Set(normalizedShares.map((s) => s.email).filter(Boolean))];
    let matchedApproversCount = 0;
    const ledgerEvents = [];
    const createdApprovalUserIds = new Set();

    if (distinctEmails.length > 0) {
      const usersRes = await client.query(
        `SELECT id, lower(email) AS email
         FROM public.users
         WHERE email IS NOT NULL
           AND lower(email) = ANY($1::text[])
           AND is_active = true`,
        [distinctEmails]
      );

      for (const u of usersRes.rows) {
        const autoApprove = String(u.id) === String(req.user.userId);
        const approvalRes = await client.query(
          `INSERT INTO public.split_change_approvals
           (request_id, approver_user_id, approver_email, decision, decided_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [requestId, u.id, u.email, autoApprove ? "APPROVED" : null, autoApprove ? now : null]
        );
        createdApprovalUserIds.add(String(u.id));

        if (autoApprove) {
          ledgerEvents.push({
            occurredAt: now,
            eventType: "SPLIT_CHANGE_APPROVED",
            actorUserId: req.user.userId,
            entityType: "split_change_approval",
            entityId: approvalRes.rows[0].id,
            payload: { requestId, trackId, decision: "APPROVED", approverUserId: u.id }
          });
        }
      }

      matchedApproversCount = usersRes.rows.length;
    }

    // The proposer is always treated as already-approved (even if their email is not in the proposed shares).
    if (!createdApprovalUserIds.has(String(req.user.userId))) {
      if (!proposerEmail) {
        // Shouldn't happen in auth-ready schema, but keep it safe.
        throw new Error("Proposer email is missing");
      }

      const proposerApprovalRes = await client.query(
        `INSERT INTO public.split_change_approvals
         (request_id, approver_user_id, approver_email, decision, decided_at)
         VALUES ($1, $2, $3, 'APPROVED', $4)
         RETURNING id`,
        [requestId, req.user.userId, proposerEmail, now]
      );

      matchedApproversCount += 1;

      ledgerEvents.push({
        occurredAt: now,
        eventType: "SPLIT_CHANGE_APPROVED",
        actorUserId: req.user.userId,
        entityType: "split_change_approval",
        entityId: proposerApprovalRes.rows[0].id,
        payload: { requestId, trackId, decision: "APPROVED", approverUserId: req.user.userId, auto: true }
      });
    }

    await appendLedgerEvent(client, {
      occurredAt: now,
      eventType: "SPLIT_CHANGE_PROPOSED",
      actorUserId: req.user.userId,
      entityType: "split_change_request",
      entityId: requestId,
      payload: {
        trackId,
        trackTitle: track.title,
        requiredApprovals: distinctEmails.length,
        matchedApproversCount
      }
    });

    // If all approvals are already satisfied (e.g., only the proposer was matched and auto-approved),
    // apply the split change immediately so the track has an ACTIVE agreement.
    const remainingRes = await client.query(
      `SELECT COUNT(*)::bigint AS remaining
       FROM public.split_change_approvals
       WHERE request_id = $1
         AND decision IS DISTINCT FROM 'APPROVED'`,
      [requestId]
    );
    const remaining = Number(remainingRes.rows[0]?.remaining || 0);

    let appliedAgreementId = null;

    if (remaining === 0) {
      await client.query(
        `UPDATE public.split_agreements
         SET status = 'DEPRECATED'
         WHERE track_id = $1
           AND status = 'ACTIVE'`,
        [trackId]
      );

      const newAgreementRes = await client.query(
        `INSERT INTO public.split_agreements (track_id, status)
         VALUES ($1, 'ACTIVE')
         RETURNING id`,
        [trackId]
      );
      appliedAgreementId = newAgreementRes.rows[0].id;

      for (const s of normalizedShares) {
        await client.query(
          `INSERT INTO public.split_shares
           (agreement_id, contributor_name, contributor_role, share_percent, contributor_email)
           VALUES ($1, $2, $3, $4, $5)`,
          [appliedAgreementId, s.name, s.role, s.sharePercent, s.email || null]
        );
      }

      await client.query(
        `UPDATE public.split_change_requests
         SET status = 'APPROVED', decided_at = $1
         WHERE id = $2`,
        [now, requestId]
      );

      ledgerEvents.push({
        occurredAt: now,
        eventType: "SPLIT_APPLIED",
        actorUserId: req.user.userId,
        entityType: "split_agreement",
        entityId: appliedAgreementId,
        payload: { requestId, trackId, agreementId: appliedAgreementId, auto: true }
      });
    }

    if (ledgerEvents.length > 0) {
      await appendLedgerEvents(client, ledgerEvents);
    }

    await client.query("COMMIT");
    return res.status(201).json({
      requestId,
      status: appliedAgreementId ? "APPROVED" : "PENDING",
      requiredApprovals: distinctEmails.length,
      matchedApproversCount,
      agreementId: appliedAgreementId
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e?.code === "23514" && e?.constraint === "ledger_events_event_type_check") {
      return res.status(500).send(
        "Ledger event type not allowed by DB constraint. Run server/sql/ledger_events_allow_split_change_events.sql on the same DB your API uses."
      );
    }
    return res.status(500).send("Failed to propose split change");
  } finally {
    client.release();
  }
});

// Get active splits and the latest pending split-change request for a track.
app.get("/api/tracks/:id/splits", authenticate, async (req, res) => {
  const trackId = req.params.id;

  try {
    const userRes = await pool.query(
      `SELECT lower(email) AS email
       FROM public.users
       WHERE id = $1`,
      [req.user.userId]
    );
    const userEmail = String(userRes.rows[0]?.email || "").toLowerCase();

    const trackRes = await pool.query(
      `SELECT id, title, created_by_user_id
       FROM public.tracks
       WHERE id = $1`,
      [trackId]
    );
    if (trackRes.rows.length === 0) return res.status(404).send("Track not found");

    const track = trackRes.rows[0];
    const isOwner = String(track.created_by_user_id) === String(req.user.userId);
    const isAdmin = req.user.role === "ADMIN";

    // Active agreement + shares
    const activeAgreementRes = await pool.query(
      `SELECT id
       FROM public.split_agreements
       WHERE track_id = $1
         AND status = 'ACTIVE'
       ORDER BY created_at DESC
       LIMIT 1`,
      [trackId]
    );
    const activeAgreementId = activeAgreementRes.rows[0]?.id || null;

    const activeShares = activeAgreementId
      ? (await pool.query(
        `SELECT contributor_name, contributor_role, share_percent, contributor_email, created_at
         FROM public.split_shares
         WHERE agreement_id = $1
         ORDER BY share_percent DESC, contributor_name ASC`,
        [activeAgreementId]
      )).rows
      : [];

    // Pending request (latest)
    const pendingReqRes = await pool.query(
      `SELECT id, status, proposed_by_user_id, created_at, decided_at
       FROM public.split_change_requests
       WHERE track_id = $1
         AND status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 1`,
      [trackId]
    );
    const pending = pendingReqRes.rows[0] || null;

    let pendingShares = [];
    let pendingApprovals = [];

    if (pending) {
      pendingShares = (await pool.query(
        `SELECT contributor_name, contributor_role, share_percent, contributor_email
         FROM public.split_change_shares
         WHERE request_id = $1
         ORDER BY share_percent DESC, contributor_name ASC`,
        [pending.id]
      )).rows;

      pendingApprovals = (await pool.query(
        `SELECT id, approver_user_id, approver_email, decision, decided_at
         FROM public.split_change_approvals
         WHERE request_id = $1
         ORDER BY approver_email ASC`,
        [pending.id]
      )).rows;
    }

    if (!isOwner && !isAdmin) {
      // Collaborator visibility: must match contributor_email in ACTIVE shares or pending shares.
      const canSee = await pool.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM public.split_shares ss
             JOIN public.split_agreements sa ON sa.id = ss.agreement_id
             WHERE sa.track_id = $1
               AND sa.status = 'ACTIVE'
               AND lower(ss.contributor_email) = $2
           ) OR EXISTS (
             SELECT 1
             FROM public.split_change_requests scr
             JOIN public.split_change_shares scs ON scs.request_id = scr.id
             WHERE scr.track_id = $1
               AND scr.status = 'PENDING'
               AND lower(scs.contributor_email) = $2
           ) AS ok`,
        [trackId, userEmail]
      );
      if (!canSee.rows[0]?.ok) return res.status(403).send("Forbidden");
    }

    return res.json({
      track: { id: track.id, title: track.title },
      viewer: { role: req.user.role, isOwner, email: userEmail || null },
      active: {
        agreementId: activeAgreementId,
        shares: activeShares
      },
      pending: pending ? {
        requestId: pending.id,
        status: pending.status,
        proposedByUserId: pending.proposed_by_user_id,
        createdAt: pending.created_at,
        decidedAt: pending.decided_at,
        shares: pendingShares,
        approvals: pendingApprovals
      } : null
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load splits");
  }
});

// Respond to a split change request (approve/reject).
// Convenience: if someone visits this in a browser, return a clear 405 instead of "Cannot GET ...".
app.get("/api/split-changes/:requestId/respond", (req, res) => {
  return res.status(405).send("Method Not Allowed. Use POST with JSON body { decision: \"APPROVED\"|\"REJECTED\" }.");
});

app.post("/api/split-changes/:requestId/respond", authenticate, async (req, res) => {
  const requestId = req.params.requestId;
  const decisionRaw = String(req.body?.decision || "").toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(decisionRaw)) {
    return res.status(400).send("decision must be APPROVED or REJECTED");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const reqRes = await client.query(
      `SELECT id, track_id, status
       FROM public.split_change_requests
       WHERE id = $1`,
      [requestId]
    );
    if (reqRes.rows.length === 0) return res.status(404).send("Request not found");

    const requestRow = reqRes.rows[0];
    if (requestRow.status !== "PENDING") {
      return res.status(409).send("Request is not pending");
    }

    const trackId = requestRow.track_id;
    const isAdmin = req.user.role === "ADMIN";

    let approvalsToUpdate = [];

    if (isAdmin) {
      const pendingApprovalsRes = await client.query(
        `SELECT id, approver_user_id
         FROM public.split_change_approvals
         WHERE request_id = $1
           AND decision IS NULL`,
        [requestId]
      );
      approvalsToUpdate = pendingApprovalsRes.rows.map((r) => ({ id: r.id, approverUserId: r.approver_user_id }));
    } else {
      const approvalRes = await client.query(
        `SELECT id, decision
         FROM public.split_change_approvals
         WHERE request_id = $1
           AND approver_user_id = $2`,
        [requestId, req.user.userId]
      );
      if (approvalRes.rows.length === 0) return res.status(403).send("Forbidden");
      if (approvalRes.rows[0].decision) return res.status(409).send("Already responded");
      approvalsToUpdate = [{ id: approvalRes.rows[0].id, approverUserId: req.user.userId }];
    }

    if (approvalsToUpdate.length === 0) {
      return res.status(400).send("No pending approvals to update");
    }

    const now = new Date();
    const ledgerEvents = [];

    for (const a of approvalsToUpdate) {
      await client.query(
        `UPDATE public.split_change_approvals
         SET decision = $1, decided_at = $2
         WHERE id = $3`,
        [decisionRaw, now, a.id]
      );

      ledgerEvents.push({
        occurredAt: now,
        eventType: decisionRaw === "APPROVED" ? "SPLIT_CHANGE_APPROVED" : "SPLIT_CHANGE_REJECTED",
        actorUserId: req.user.userId,
        entityType: "split_change_approval",
        entityId: a.id,
        payload: { requestId, trackId, decision: decisionRaw, approverUserId: a.approverUserId }
      });
    }

    if (decisionRaw === "REJECTED") {
      await client.query(
        `UPDATE public.split_change_requests
         SET status = 'REJECTED', decided_at = $1
         WHERE id = $2`,
        [now, requestId]
      );

      ledgerEvents.push({
        occurredAt: now,
        eventType: "SPLIT_CHANGE_REJECTED",
        actorUserId: req.user.userId,
        entityType: "split_change_request",
        entityId: requestId,
        payload: { requestId, trackId, status: "REJECTED" }
      });

      await appendLedgerEvents(client, ledgerEvents);
      await client.query("COMMIT");
      return res.json({ requestId, status: "REJECTED" });
    }

    // If all required approvals are approved, apply the split change.
    const remainingRes = await client.query(
      `SELECT COUNT(*)::bigint AS remaining
       FROM public.split_change_approvals
       WHERE request_id = $1
         AND decision IS DISTINCT FROM 'APPROVED'`,
      [requestId]
    );
    const remaining = Number(remainingRes.rows[0]?.remaining || 0);

    if (remaining === 0) {
      // Deactivate existing active agreements.
      await client.query(
        `UPDATE public.split_agreements
         SET status = 'DEPRECATED'
         WHERE track_id = $1
           AND status = 'ACTIVE'`,
        [trackId]
      );

      const newAgreementRes = await client.query(
        `INSERT INTO public.split_agreements (track_id, status)
         VALUES ($1, 'ACTIVE')
         RETURNING id`,
        [trackId]
      );
      const newAgreementId = newAgreementRes.rows[0].id;

      const sharesRes = await client.query(
        `SELECT contributor_name, contributor_role, share_percent, contributor_email
         FROM public.split_change_shares
         WHERE request_id = $1`,
        [requestId]
      );

      for (const s of sharesRes.rows) {
        await client.query(
          `INSERT INTO public.split_shares
           (agreement_id, contributor_name, contributor_role, share_percent, contributor_email)
           VALUES ($1, $2, $3, $4, $5)`,
          [newAgreementId, s.contributor_name, s.contributor_role, s.share_percent, s.contributor_email || null]
        );
      }

      await client.query(
        `UPDATE public.split_change_requests
         SET status = 'APPROVED', decided_at = $1
         WHERE id = $2`,
        [now, requestId]
      );

      ledgerEvents.push({
        occurredAt: now,
        eventType: "SPLIT_APPLIED",
        actorUserId: req.user.userId,
        entityType: "split_agreement",
        entityId: newAgreementId,
        payload: { requestId, trackId, agreementId: newAgreementId }
      });

      await appendLedgerEvents(client, ledgerEvents);
      await client.query("COMMIT");
      return res.json({ requestId, status: "APPROVED", agreementId: newAgreementId });
    }

    await appendLedgerEvents(client, ledgerEvents);
    await client.query("COMMIT");
    return res.json({ requestId, status: "PENDING" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    if (e?.code === "23514" && e?.constraint === "ledger_events_event_type_check") {
      return res.status(500).send(
        "Ledger event type not allowed by DB constraint. Run server/sql/ledger_events_allow_split_change_events.sql on the same DB your API uses."
      );
    }
    return res.status(500).send("Failed to respond to split change");
  } finally {
    client.release();
  }
});

// Inbox for pending split-change approvals for the current user.
app.get("/api/split-changes/inbox", authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         sca.id AS approval_id,
         scr.id AS request_id,
         scr.track_id,
         t.title AS track_title,
         scr.created_at,
         scr.proposed_by_user_id,
         u.display_name AS proposed_by_display_name,
         u.email AS proposed_by_email
       FROM public.split_change_approvals sca
       JOIN public.split_change_requests scr ON scr.id = sca.request_id
       JOIN public.tracks t ON t.id = scr.track_id
       JOIN public.users u ON u.id = scr.proposed_by_user_id
       WHERE sca.approver_user_id = $1
         AND sca.decision IS NULL
         AND scr.status = 'PENDING'
       ORDER BY scr.created_at DESC`,
      [req.user.userId]
    );

    return res.json({ inbox: r.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load inbox");
  }
});

// =====================================================
// Royalty Engine
// =====================================================

// Execute monthly royalty allocation (user-centric distribution model)
app.post("/api/royalties/run", authenticate, requireRole("ADMIN"), async (req, res) => {
  const month = req.query.month; // expect "2026-02-01"
  if (!month) return res.status(400).send("Missing month query param (YYYY-MM-01)");
  if (!/^\d{4}-\d{2}-01$/.test(month)) {
    return res.status(400).send("Invalid month format. Use YYYY-MM-01");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1 - Create royalty run row (or reuse if already ran)
    const runRes = await client.query(
      `INSERT INTO public.royalty_runs (month_start)
       VALUES ($1)
       ON CONFLICT (month_start) DO UPDATE SET executed_at = now()
       RETURNING id`,
      [month]
    );
    const runId = runRes.rows[0].id;

    const ledgerEvents = [
      {
        occurredAt: new Date(),
        eventType: "ROYALTY_RUN_EXECUTED",
        actorUserId: null,
        entityType: "royalty_run",
        entityId: runId,
        payload: { monthStart: month }
      }
    ];

    // 2 - Load subscriptions
    const subsRes = await client.query(
      `SELECT listener_user_id, amount_pennies
       FROM public.subscriptions
       WHERE month_start = $1`,
      [month]
    );
    const subsByUser = new Map(
      subsRes.rows.map(r => [r.listener_user_id, BigInt(r.amount_pennies)])
    );

    // 3 - Load listening totals per (user, track)
    const listensRes = await client.query(
      `SELECT listener_user_id, track_id, SUM(listened_ms)::bigint AS listened_ms
       FROM public.play_events
       WHERE month_start = $1
       GROUP BY listener_user_id, track_id`,
      [month]
    );

    // group listens by user
    const listensByUser = new Map(); // userId -> [{trackId, ms}]
    for (const r of listensRes.rows) {
      const arr = listensByUser.get(r.listener_user_id) || [];
      arr.push({ trackId: r.track_id, ms: BigInt(r.listened_ms) });
      listensByUser.set(r.listener_user_id, arr);
    }

    // 4 - Compute track totals (pennies) from user-centric allocation
    const trackTotals = new Map(); // trackId -> pennies (BigInt)

    for (const [userId, items] of listensByUser.entries()) {
      const sub = subsByUser.get(userId);
      if (!sub || sub <= 0n) continue;

      const totalMs = items.reduce((s, x) => s + x.ms, 0n);
      if (totalMs <= 0n) continue;

      // base allocation: floor each share
      const allocated = items.map(x => {
        const pennies = (sub * x.ms) / totalMs; // integer division floors
        return { ...x, pennies };
      });

      let sumPennies = allocated.reduce((s, x) => s + x.pennies, 0n);
      let remainder = sub - sumPennies;

      // distribute remainder to largest ms tracks (deterministic)
      allocated.sort((a, b) => (b.ms > a.ms ? 1 : b.ms < a.ms ? -1 : (a.trackId > b.trackId ? 1 : -1)));

      let i = 0;
      while (remainder > 0n && allocated.length > 0) {
        allocated[i].pennies += 1n;
        remainder -= 1n;
        i = (i + 1) % allocated.length;
      }

      // add to global track totals
      for (const x of allocated) {
        if (x.pennies <= 0n) continue;
        trackTotals.set(x.trackId, (trackTotals.get(x.trackId) || 0n) + x.pennies);
      }
    }

    const trackIds = [...trackTotals.keys()];
    if (trackIds.length === 0) {
      // clear allocations for this run and finish
      await client.query(`DELETE FROM public.royalty_allocations WHERE run_id = $1`, [runId]);
      await appendLedgerEvents(client, ledgerEvents);
      await client.query("COMMIT");
      return res.json({ runId, month, message: "No listening/subscriptions to allocate." });
    }

    // 5 - Load split shares for tracks (ACTIVE agreement)
    const splitsRes = await client.query(
      `SELECT sa.track_id, ss.contributor_name, ss.contributor_role, ss.share_percent
       FROM public.split_agreements sa
       JOIN public.split_shares ss ON ss.agreement_id = sa.id
       WHERE sa.status = 'ACTIVE'
         AND sa.track_id = ANY($1::uuid[])`,
      [trackIds]
    );

    const splitsByTrack = new Map(); // trackId -> [{name, role, percent}]
    for (const r of splitsRes.rows) {
      const arr = splitsByTrack.get(r.track_id) || [];
      arr.push({
        name: r.contributor_name,
        role: r.contributor_role,
        percent: Number(r.share_percent),
      });
      splitsByTrack.set(r.track_id, arr);
    }

    // Load primary artist names for fallback
    const trackMetaRes = await client.query(
      `SELECT id, primary_artist_name
       FROM public.tracks
       WHERE id = ANY($1::uuid[])`,
      [trackIds]
    );
    const primaryArtistByTrack = new Map(
      trackMetaRes.rows.map(r => [r.id, r.primary_artist_name])
    );

    // 6 - Clear previous allocations for this run and insert new ones
    await client.query(`DELETE FROM public.royalty_allocations WHERE run_id = $1`, [runId]);

    const skippedTracks = [];
    const trackSummaries = [];

    for (const trackId of trackIds) {
      const totalPennies = trackTotals.get(trackId) || 0n;
      const splits = splitsByTrack.get(trackId) || [];

      if (splits.length === 0) {
        const primaryArtist = primaryArtistByTrack.get(trackId);
        if (!primaryArtist || !String(primaryArtist).trim()) {
          skippedTracks.push(trackId);
          continue;
        }

        const allocRes = await client.query(
          `INSERT INTO public.royalty_allocations
           (run_id, track_id, contributor_name, contributor_role, amount_pennies)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [runId, trackId, primaryArtist, "Primary Artist", totalPennies.toString()]
        );

        ledgerEvents.push({
          occurredAt: new Date(),
          eventType: "ROYALTY_ALLOCATED",
          actorUserId: null,
          entityType: "royalty_allocation",
          entityId: allocRes.rows[0].id,
          payload: {
            runId,
            trackId,
            contributorName: primaryArtist,
            contributorRole: "Primary Artist",
            amountPennies: totalPennies.toString()
          }
        });

        trackSummaries.push({
          trackId,
          totalPennies: totalPennies.toString(),
          allocatedPennies: totalPennies.toString(),
          usedFallback: true
        });

        continue;
      }

      // allocate by splits; handle rounding at contributor level too
      let allocatedSum = 0n;
      const contribRows = splits.map(s => {
        const bp = toBasisPoints(s.percent);
        const pennies = allocByBp(totalPennies, bp);
        allocatedSum += pennies;
        return { ...s, bp, pennies };
      });

      let remainder = totalPennies - allocatedSum;

      // deterministic remainder: highest bp first, then name
      contribRows.sort((a, b) => (b.bp > a.bp ? 1 : b.bp < a.bp ? -1 : (a.name > b.name ? 1 : -1)));

      let j = 0;
      while (remainder > 0n && contribRows.length > 0) {
        contribRows[j].pennies += 1n;
        remainder -= 1n;
        j = (j + 1) % contribRows.length;
      }

      for (const c of contribRows) {
        if (c.pennies <= 0n) continue;
        const allocRes = await client.query(
          `INSERT INTO public.royalty_allocations
           (run_id, track_id, contributor_name, contributor_role, amount_pennies)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [runId, trackId, c.name, c.role, c.pennies.toString()]
        );

        ledgerEvents.push({
          occurredAt: new Date(),
          eventType: "ROYALTY_ALLOCATED",
          actorUserId: null,
          entityType: "royalty_allocation",
          entityId: allocRes.rows[0].id,
          payload: {
            runId,
            trackId,
            contributorName: c.name,
            contributorRole: c.role,
            amountPennies: c.pennies.toString()
          }
        });
      }

      trackSummaries.push({
        trackId,
        totalPennies: totalPennies.toString(),
        allocatedPennies: totalPennies.toString(),
        usedFallback: false
      });
    }

    await appendLedgerEvents(client, ledgerEvents);
    await client.query("COMMIT");
    res.json({ runId, month, tracksAllocated: trackSummaries.length, skippedTracks, trackSummaries });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).send("Royalty run failed");
  } finally {
    client.release();
  }
});

// Fetch royalty allocations for a given month (optionally scoped to current user)
app.get("/api/royalties/allocations", async (req, res) => {
  const month = req.query.month; // expect "YYYY-MM-01"
  if (!month) return res.status(400).send("Missing month query param (YYYY-MM-01)");
  if (!/^\d{4}-\d{2}-01$/.test(month)) {
    return res.status(400).send("Invalid month format. Use YYYY-MM-01");
  }
  const createdBy = req.query.createdBy;

  try {
    const runRes = await pool.query(
      `SELECT id, month_start, executed_at
       FROM public.royalty_runs
       WHERE month_start = $1`,
      [month]
    );

    if (runRes.rows.length === 0) {
      return res.json({ month, runId: null, allocations: [] });
    }

    const runId = runRes.rows[0].id;

    let allocRes;
    if (createdBy === "me") {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return res.status(401).send("Missing auth token");
      let userId;
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        userId = payload.userId;
      } catch {
        return res.status(401).send("Invalid or expired token");
      }

      allocRes = await pool.query(
        `SELECT ra.track_id, t.title AS track_title, ra.contributor_name, ra.contributor_role, ra.amount_pennies, ra.created_at
         FROM public.royalty_allocations ra
         JOIN public.tracks t ON t.id = ra.track_id
         WHERE ra.run_id = $1
           AND t.created_by_user_id = $2
         ORDER BY ra.track_id, ra.contributor_name`,
        [runId, userId]
      );
    } else {
      allocRes = await pool.query(
        `SELECT ra.track_id, t.title AS track_title, ra.contributor_name, ra.contributor_role, ra.amount_pennies, ra.created_at
         FROM public.royalty_allocations ra
         JOIN public.tracks t ON t.id = ra.track_id
         WHERE ra.run_id = $1
         ORDER BY ra.track_id, ra.contributor_name`,
        [runId]
      );
    }

    return res.json({
      month,
      runId,
      allocations: allocRes.rows
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Database error");
  }
});

// Export monthly royalty allocations as CSV (creator-scoped by default; admin can export all).
app.get("/api/royalties/export", authenticate, requireRole("CREATOR", "ADMIN"), async (req, res) => {
  const month = req.query.month;
  const requestedScope = (req.query.scope || "me").toString().toLowerCase();

  if (!month) return res.status(400).send("Missing month query param (YYYY-MM-01)");
  if (!/^\d{4}-\d{2}-01$/.test(String(month))) {
    return res.status(400).send("Invalid month format. Use YYYY-MM-01");
  }

  const scope = req.user.role === "ADMIN" ? (requestedScope === "all" ? "all" : "me") : "me";

  try {
    const runRes = await pool.query(
      `SELECT id
       FROM public.royalty_runs
       WHERE month_start = $1`,
      [month]
    );

    const runId = runRes.rows[0]?.id || null;
    const header = [
      "month_start",
      "run_id",
      "track_id",
      "track_title",
      "contributor_name",
      "contributor_role",
      "amount_pennies",
      "amount_gbp",
      "allocation_created_at"
    ].join(",");

    if (!runId) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="royalties_${month}_${scope}.csv"`);
      return res.status(200).send(`${header}\n`);
    }

    let q;
    let params;

    if (scope === "me") {
      q = `SELECT
          $1::date AS month_start,
          ra.run_id,
          ra.track_id,
          t.title AS track_title,
          ra.contributor_name,
          ra.contributor_role,
          ra.amount_pennies,
          ra.created_at AS allocation_created_at
        FROM public.royalty_allocations ra
        JOIN public.tracks t ON t.id = ra.track_id
        WHERE ra.run_id = $2
          AND t.created_by_user_id = $3
        ORDER BY t.title ASC, ra.contributor_name ASC`;
      params = [month, runId, req.user.userId];
    } else {
      q = `SELECT
          $1::date AS month_start,
          ra.run_id,
          ra.track_id,
          t.title AS track_title,
          ra.contributor_name,
          ra.contributor_role,
          ra.amount_pennies,
          ra.created_at AS allocation_created_at
        FROM public.royalty_allocations ra
        JOIN public.tracks t ON t.id = ra.track_id
        WHERE ra.run_id = $2
        ORDER BY t.title ASC, ra.contributor_name ASC`;
      params = [month, runId];
    }

    const rowsRes = await pool.query(q, params);

    const lines = [header];
    for (const r of rowsRes.rows) {
      lines.push([
        escapeCsvField(r.month_start),
        escapeCsvField(r.run_id),
        escapeCsvField(r.track_id),
        escapeCsvField(r.track_title),
        escapeCsvField(r.contributor_name),
        escapeCsvField(r.contributor_role),
        escapeCsvField(r.amount_pennies),
        escapeCsvField(penniesToGbpString(r.amount_pennies)),
        escapeCsvField(r.allocation_created_at)
      ].join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="royalties_${month}_${scope}.csv"`);
    return res.status(200).send(`${lines.join("\n")}\n`);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to export royalties");
  }
});

// Export monthly allocations for a single track as CSV.
app.get("/api/tracks/:id/export", authenticate, requireRole("CREATOR", "ADMIN"), async (req, res) => {
  const trackId = req.params.id;
  const month = req.query.month;
  if (!month) return res.status(400).send("Missing month query param (YYYY-MM-01)");
  if (!/^\d{4}-\d{2}-01$/.test(String(month))) {
    return res.status(400).send("Invalid month format. Use YYYY-MM-01");
  }

  try {
    const userEmailRes = await pool.query(
      `SELECT lower(email) AS email
       FROM public.users
       WHERE id = $1`,
      [req.user.userId]
    );
    const userEmail = String(userEmailRes.rows[0]?.email || "").toLowerCase();

    const trackRes = await pool.query(
      `SELECT id, title, created_by_user_id
       FROM public.tracks
       WHERE id = $1`,
      [trackId]
    );
    if (trackRes.rows.length === 0) return res.status(404).send("Track not found");

    const track = trackRes.rows[0];
    const isAdmin = req.user.role === "ADMIN";
    const isOwner = String(track.created_by_user_id) === String(req.user.userId);

    if (!isAdmin && !isOwner) {
      const collabRes = await pool.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM public.split_agreements sa
             JOIN public.split_shares ss ON ss.agreement_id = sa.id
             WHERE sa.track_id = $1
               AND sa.status = 'ACTIVE'
               AND lower(ss.contributor_email) = $2
           ) OR EXISTS (
             SELECT 1
             FROM public.split_change_requests scr
             JOIN public.split_change_shares scs ON scs.request_id = scr.id
             WHERE scr.track_id = $1
               AND scr.status = 'PENDING'
               AND lower(scs.contributor_email) = $2
           ) AS ok`,
        [trackId, userEmail]
      );
      if (!collabRes.rows[0]?.ok) return res.status(403).send("Forbidden");
    }

    const runRes = await pool.query(
      `SELECT id
       FROM public.royalty_runs
       WHERE month_start = $1`,
      [month]
    );
    const runId = runRes.rows[0]?.id || null;

    const header = [
      "month_start",
      "run_id",
      "track_id",
      "track_title",
      "contributor_name",
      "contributor_role",
      "amount_pennies",
      "amount_gbp",
      "allocation_created_at"
    ].join(",");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="track_${trackId}_${month}.csv"`);

    if (!runId) {
      return res.status(200).send(`${header}\n`);
    }

    const allocRes = await pool.query(
      `SELECT
         $1::date AS month_start,
         ra.run_id,
         ra.track_id,
         t.title AS track_title,
         ra.contributor_name,
         ra.contributor_role,
         ra.amount_pennies,
         ra.created_at AS allocation_created_at
       FROM public.royalty_allocations ra
       JOIN public.tracks t ON t.id = ra.track_id
       WHERE ra.run_id = $2
         AND ra.track_id = $3
       ORDER BY ra.contributor_name ASC`,
      [month, runId, trackId]
    );

    const lines = [header];
    for (const r of allocRes.rows) {
      lines.push([
        escapeCsvField(r.month_start),
        escapeCsvField(r.run_id),
        escapeCsvField(r.track_id),
        escapeCsvField(r.track_title),
        escapeCsvField(r.contributor_name),
        escapeCsvField(r.contributor_role),
        escapeCsvField(r.amount_pennies),
        escapeCsvField(penniesToGbpString(r.amount_pennies)),
        escapeCsvField(r.allocation_created_at)
      ].join(","));
    }

    return res.status(200).send(`${lines.join("\n")}\n`);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to export track earnings");
  }
});

// =====================================================
// Dashboard
// =====================================================

// Aggregate dashboard metrics for CREATOR
app.get("/api/dashboard/summary", authenticate, requireRole("CREATOR", "ADMIN"), async (req, res) => {
  try {
    const userId = req.user.userId;

    const totalsRes = await pool.query(
      `SELECT
         COALESCE(SUM(ra.amount_pennies), 0)::bigint AS total_earnings,
         COUNT(ra.id)::bigint AS allocation_count,
         COUNT(DISTINCT ra.track_id)::bigint AS track_count
       FROM public.royalty_allocations ra
       JOIN public.tracks t ON t.id = ra.track_id
       WHERE t.created_by_user_id = $1`,
      [userId]
    );

    const lastRunRes = await pool.query(
      `SELECT MAX(rr.month_start) AS last_run_month
       FROM public.royalty_runs rr
       JOIN public.royalty_allocations ra ON ra.run_id = rr.id
       JOIN public.tracks t ON t.id = ra.track_id
       WHERE t.created_by_user_id = $1`,
      [userId]
    );

    return res.json({
      totalEarnings: totalsRes.rows[0].total_earnings,
      allocationCount: totalsRes.rows[0].allocation_count,
      trackCount: totalsRes.rows[0].track_count,
      lastRunMonth: lastRunRes.rows[0].last_run_month
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Database error");
  }
});

// =====================================================
// Admin
// =====================================================

// Admin: list recent royalty runs with aggregate counts.
app.get("/api/admin/royalties/runs", authenticate, requireRole("ADMIN"), async (req, res) => {
  const rawLimit = req.query.limit;
  const limit = Math.max(1, Math.min(24, Number(rawLimit || 6)));
  if (!Number.isFinite(limit)) return res.status(400).send("Invalid limit");

  try {
    const r = await pool.query(
      `SELECT
         rr.id AS run_id,
         rr.month_start,
         rr.executed_at,
         COUNT(ra.id)::bigint AS allocation_count,
         COUNT(DISTINCT ra.track_id)::bigint AS track_count
       FROM public.royalty_runs rr
       LEFT JOIN public.royalty_allocations ra ON ra.run_id = rr.id
       GROUP BY rr.id, rr.month_start, rr.executed_at
       ORDER BY rr.month_start DESC
       LIMIT $1`,
      [limit]
    );

    const runs = r.rows.map((row) => ({
      runId: row.run_id,
      monthStart: row.month_start,
      executedAt: row.executed_at,
      allocationCount: String(row.allocation_count || 0),
      trackCount: String(row.track_count || 0)
    }));

    return res.json({ runs });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load royalty runs");
  }
});

// Admin: generate/overwrite monthly subscriptions for all active users.
app.post("/api/admin/subscriptions/generate", authenticate, requireRole("ADMIN"), async (req, res) => {
  const { monthStart, amountPennies } = req.body || {};
  if (!monthStart) return res.status(400).send("monthStart is required (YYYY-MM-01)");
  if (!/^\d{4}-\d{2}-01$/.test(String(monthStart))) {
    return res.status(400).send("Invalid monthStart format. Use YYYY-MM-01");
  }

  const n = typeof amountPennies === "string" ? Number(amountPennies) : amountPennies;
  if (!Number.isInteger(n)) return res.status(400).send("amountPennies must be an integer");
  if (n < 0) return res.status(400).send("amountPennies must be >= 0");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const upsertRes = await client.query(
      `INSERT INTO public.subscriptions (listener_user_id, month_start, amount_pennies)
       SELECT u.id, $1::date, $2::bigint
       FROM public.users u
       WHERE u.is_active = true
       ON CONFLICT (listener_user_id, month_start)
       DO UPDATE SET amount_pennies = EXCLUDED.amount_pennies
       RETURNING id, listener_user_id, (xmax = 0) AS inserted`,
      [String(monthStart), n]
    );

    let insertedCount = 0;
    let updatedCount = 0;
    const events = [];

    for (const row of upsertRes.rows) {
      if (row.inserted) insertedCount += 1;
      else updatedCount += 1;

      events.push({
        occurredAt: new Date(),
        eventType: "SUBSCRIPTION_CREATED",
        actorUserId: req.user.userId,
        entityType: "subscription",
        entityId: row.id,
        payload: {
          monthStart: String(monthStart),
          amountPennies: String(n),
          inserted: Boolean(row.inserted),
          listenerUserId: row.listener_user_id
        }
      });
    }

    if (events.length > 0) {
      await appendLedgerEvents(client, events);
    }

    await client.query("COMMIT");
    return res.json({
      monthStart: String(monthStart),
      amountPennies: String(n),
      insertedCount,
      updatedCount
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).send("Failed to generate subscriptions");
  } finally {
    client.release();
  }
});

app.get("/api/tracks/:id/stream", authenticateStream, async (req, res) => {
  const trackId = req.params.id;
  const range = req.headers.range;

  try {
    const assetRes = await pool.query(
      `SELECT mime_type, object_key, storage_provider
       FROM public.audio_assets
       WHERE track_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [trackId]
    );

    if (assetRes.rows.length === 0) return res.status(404).send("Audio asset not found");

    const asset = assetRes.rows[0];
    if (!asset.object_key) return res.status(404).send("Audio object key not found");
    if (asset.storage_provider !== "minio") {
      return res.status(500).send("Unsupported storage provider for stream");
    }

    const objectOut = await storage.getObjectStream({ key: asset.object_key, range });
    const stream = objectOut.body;
    if (!stream || typeof stream.pipe !== "function") {
      return res.status(500).send("Invalid stream response");
    }

    res.setHeader("Accept-Ranges", objectOut.acceptRanges || "bytes");
    res.setHeader("Content-Type", objectOut.contentType || asset.mime_type || "application/octet-stream");
    if (objectOut.contentLength != null) {
      res.setHeader("Content-Length", String(objectOut.contentLength));
    }
    if (objectOut.contentRange) {
      res.setHeader("Content-Range", objectOut.contentRange);
    }

    res.status(objectOut.statusCode || 200);
    stream.on("error", (err) => {
      console.error("MinIO stream error", err);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to stream track");
  }
});

// Record a listener play event from playback sessions.
app.post("/api/play-events", authenticate, requireRole("LISTENER", "ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { trackId, monthStart, listenedMs, playedAt } = req.body || {};

    if (!trackId) return res.status(400).send("trackId is required");
    if (!monthStart) return res.status(400).send("monthStart is required");
    if (!/^\d{4}-\d{2}-01$/.test(monthStart)) {
      return res.status(400).send("Invalid monthStart format. Use YYYY-MM-01");
    }
    if (!Number.isInteger(listenedMs)) {
      return res.status(400).send("listenedMs must be an integer");
    }
    if (listenedMs < 10000) {
      return res.status(400).send("listenedMs must be at least 10000");
    }
    if (playedAt && Number.isNaN(Date.parse(playedAt))) {
      return res.status(400).send("playedAt must be a valid timestamp");
    }

    const trackCheck = await client.query(
      `SELECT id FROM public.tracks WHERE id = $1`,
      [trackId]
    );
    if (trackCheck.rows.length === 0) {
      return res.status(404).send("Track not found");
    }

    await client.query("BEGIN");

    const insertRes = await client.query(
      `INSERT INTO public.play_events
       (listener_user_id, track_id, month_start, listened_ms, played_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamp, now()))
       RETURNING id`,
      [req.user.userId, trackId, monthStart, listenedMs, playedAt || null]
    );

    const playEventId = insertRes.rows[0].id;

    await appendLedgerEvent(client, {
      occurredAt: new Date(),
      eventType: "PLAY_EVENT_RECORDED",
      actorUserId: req.user.userId,
      entityType: "play_event",
      entityId: playEventId,
      payload: { trackId, monthStart, listenedMs }
    });

    await client.query("COMMIT");
    return res.status(201).json({ id: playEventId });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    console.error(e);
    return res.status(500).send("Failed to record play event");
  } finally {
    client.release();
  }
});

// =====================================================
// Ledger (Debug/Traceability)
// =====================================================

app.get("/api/ledger/events", authenticate, requireRole("CREATOR", "ADMIN"), async (req, res) => {
  const rawLimit = req.query.limit;
  const rawCursor = req.query.cursor;

  const limit = Math.max(1, Math.min(200, Number(rawLimit || 50)));
  if (!Number.isFinite(limit)) return res.status(400).send("Invalid limit");

  let cursor = null;
  if (typeof rawCursor === "string" && rawCursor.length > 0) {
    if (!/^\d+$/.test(rawCursor)) return res.status(400).send("Invalid cursor");
    cursor = rawCursor;
  }

  try {
    const params = [];
    let sql = `SELECT
        id,
        occurred_at,
        event_type,
        actor_user_id,
        entity_type,
        entity_id,
        payload,
        chain_index,
        prev_hash,
        event_hash
      FROM public.ledger_events`;

    if (cursor) {
      params.push(cursor);
      sql += ` WHERE chain_index < $1::bigint`;
    }

    params.push(limit);
    sql += ` ORDER BY chain_index DESC LIMIT $${params.length}`;

    const r = await pool.query(sql, params);
    const events = r.rows;
    const nextCursor = events.length > 0 ? String(events[events.length - 1].chain_index) : null;

    return res.json({ events, nextCursor });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load ledger events");
  }
});

// =====================================================
// Listener Impact
// =====================================================

// Returns month-level impact metrics for the authenticated listener.
app.get("/api/listener/impact", authenticate, requireRole("LISTENER", "ADMIN"), async (req, res) => {
  const requestedMonth = req.query.month;
  if (requestedMonth && !/^\d{4}-\d{2}-01$/.test(requestedMonth)) {
    return res.status(400).send("Invalid month format. Use YYYY-MM-01");
  }
  const month = requestedMonth && /^\d{4}-\d{2}-01$/.test(requestedMonth)
    ? requestedMonth
    : (() => {
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${yyyy}-${mm}-01`;
    })();

  try {
    const listenerUserId = req.user.userId;

    const subRes = await pool.query(
      `SELECT amount_pennies
       FROM public.subscriptions
       WHERE listener_user_id = $1
         AND month_start = $2`,
      [listenerUserId, month]
    );
    const subscriptionPennies = BigInt(subRes.rows[0]?.amount_pennies || 0);

    const playAggRes = await pool.query(
      `SELECT
         pe.track_id,
         t.title,
         t.primary_artist_name,
         SUM(pe.listened_ms)::bigint AS listened_ms,
         COUNT(*)::bigint AS play_events
       FROM public.play_events pe
       JOIN public.tracks t ON t.id = pe.track_id
       WHERE pe.listener_user_id = $1
         AND pe.month_start = $2
       GROUP BY pe.track_id, t.title, t.primary_artist_name`,
      [listenerUserId, month]
    );

    const trackRows = playAggRes.rows.map((r) => ({
      trackId: r.track_id,
      title: r.title,
      primaryArtistName: r.primary_artist_name,
      listenedMs: BigInt(r.listened_ms || 0),
      playEvents: Number(r.play_events || 0)
    }));

    const totalListeningMs = trackRows.reduce((sum, r) => sum + r.listenedMs, 0n);
    const totalPlayEvents = trackRows.reduce((sum, r) => sum + r.playEvents, 0);

    // Listener-centric per-track allocation for the selected month.
    const trackAllocations = new Map(); // trackId -> pennies(BigInt)
    if (subscriptionPennies > 0n && totalListeningMs > 0n) {
      const allocated = trackRows.map((r) => ({
        trackId: r.trackId,
        listenedMs: r.listenedMs,
        pennies: (subscriptionPennies * r.listenedMs) / totalListeningMs
      }));

      let allocatedSum = allocated.reduce((sum, r) => sum + r.pennies, 0n);
      let remainder = subscriptionPennies - allocatedSum;

      allocated.sort((a, b) => (
        b.listenedMs > a.listenedMs ? 1 :
          b.listenedMs < a.listenedMs ? -1 :
            (a.trackId > b.trackId ? 1 : -1)
      ));

      let i = 0;
      while (remainder > 0n && allocated.length > 0) {
        allocated[i].pennies += 1n;
        remainder -= 1n;
        i = (i + 1) % allocated.length;
      }

      for (const a of allocated) {
        trackAllocations.set(a.trackId, a.pennies);
      }
    }

    const trackIds = trackRows.map((r) => r.trackId);
    const topTracks = trackRows
      .sort((a, b) => Number(b.listenedMs - a.listenedMs))
      .slice(0, 5)
      .map((r) => ({
        trackId: r.trackId,
        title: r.title,
        primaryArtistName: r.primaryArtistName,
        listenedMs: r.listenedMs.toString(),
        playEvents: r.playEvents,
        sharePercent: totalListeningMs > 0n
          ? Number(((Number(r.listenedMs) / Number(totalListeningMs)) * 100).toFixed(1))
          : 0,
        allocatedPennies: (trackAllocations.get(r.trackId) || 0n).toString()
      }));

    // Build artist support from the listener allocations + active splits.
    const artistSupport = new Map(); // artistName -> pennies(BigInt)

    if (trackIds.length > 0) {
      const splitsRes = await pool.query(
        `SELECT sa.track_id, ss.contributor_name, ss.share_percent
         FROM public.split_agreements sa
         JOIN public.split_shares ss ON ss.agreement_id = sa.id
         WHERE sa.status = 'ACTIVE'
           AND sa.track_id = ANY($1::uuid[])`,
        [trackIds]
      );

      const splitsByTrack = new Map();
      for (const r of splitsRes.rows) {
        const arr = splitsByTrack.get(r.track_id) || [];
        arr.push({
          contributorName: r.contributor_name,
          sharePercent: Number(r.share_percent)
        });
        splitsByTrack.set(r.track_id, arr);
      }

      const primaryArtistByTrack = new Map(trackRows.map((r) => [r.trackId, r.primaryArtistName]));

      for (const trackId of trackIds) {
        const totalPennies = trackAllocations.get(trackId) || 0n;
        if (totalPennies <= 0n) continue;

        const splits = splitsByTrack.get(trackId) || [];
        if (splits.length === 0) {
          const fallbackName = primaryArtistByTrack.get(trackId) || "Unknown Artist";
          artistSupport.set(fallbackName, (artistSupport.get(fallbackName) || 0n) + totalPennies);
          continue;
        }

        let allocatedSum = 0n;
        const contributors = splits.map((s) => {
          const bp = toBasisPoints(s.sharePercent);
          const pennies = allocByBp(totalPennies, bp);
          allocatedSum += pennies;
          return { ...s, bp, pennies };
        });

        let remainder = totalPennies - allocatedSum;
        contributors.sort((a, b) => (b.bp > a.bp ? 1 : b.bp < a.bp ? -1 : (a.contributorName > b.contributorName ? 1 : -1)));

        let j = 0;
        while (remainder > 0n && contributors.length > 0) {
          contributors[j].pennies += 1n;
          remainder -= 1n;
          j = (j + 1) % contributors.length;
        }

        for (const c of contributors) {
          if (c.pennies <= 0n) continue;
          artistSupport.set(c.contributorName, (artistSupport.get(c.contributorName) || 0n) + c.pennies);
        }
      }
    }

    const allocatedPennies = [...trackAllocations.values()].reduce((sum, p) => sum + p, 0n);

    const topArtists = [...artistSupport.entries()]
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .slice(0, 5)
      .map(([name, pennies]) => ({
        name,
        amountPennies: pennies.toString(),
        sharePercent: allocatedPennies > 0n
          ? Number(((Number(pennies) / Number(allocatedPennies)) * 100).toFixed(1))
          : 0
      }));

    const historyRes = await pool.query(
      `SELECT
         s.month_start,
         s.amount_pennies,
         COALESCE(SUM(pe.listened_ms), 0)::bigint AS listened_ms,
         COUNT(pe.id)::bigint AS play_events,
         COUNT(DISTINCT pe.track_id)::bigint AS distinct_tracks
       FROM public.subscriptions s
       LEFT JOIN public.play_events pe
         ON pe.listener_user_id = s.listener_user_id
        AND pe.month_start = s.month_start
       WHERE s.listener_user_id = $1
         AND s.month_start <= $2
       GROUP BY s.month_start, s.amount_pennies
       ORDER BY s.month_start DESC
       LIMIT 6`,
      [listenerUserId, month]
    );

    const history = historyRes.rows.map((r) => ({
      monthStart: r.month_start,
      subscriptionPennies: String(r.amount_pennies || 0),
      allocatedPennies: String(r.amount_pennies || 0),
      listenedMs: String(r.listened_ms || 0),
      playEvents: Number(r.play_events || 0),
      distinctTracks: Number(r.distinct_tracks || 0)
    }));

    return res.json({
      month,
      subscriptionPennies: subscriptionPennies.toString(),
      allocatedPennies: allocatedPennies.toString(),
      totalListeningMs: totalListeningMs.toString(),
      totalPlayEvents,
      distinctTracks: trackRows.length,
      topTracks,
      topArtists,
      history
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Failed to load listener impact");
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await storage.assertReady();
  app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
}

startServer().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
