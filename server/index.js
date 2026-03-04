import express from "express";
import cors from "cors";
import dotenv from "dotenv";

//temp to test it works as intended
import multer from "multer";

import { pool } from "./db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "Ps_XcibxJTQT4AYP5KItvoNpiIRSyPzpO5zivUJ1Hgg=";

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
function authenticate(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
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
// Assumes authenticate() has already populated req.user.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user?.role) return res.status(401).send("Unauthorized");
    if (!roles.includes(req.user.role)) return res.status(403).send("Forbidden");
    return next();
  };
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
app.post("/api/tracks", authenticate, requireRole("CREATOR"), upload.single("audio"), async (req, res) => {
  // Transaction ensures track, splits, and audio metadata are atomic
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
        req.user.userId
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

    // 4 - insert audio metadata (file storage can come later)
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
        null // later: set to an uploads path OR S3 / cloud key
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

// List tracks (optionally filtered to current user via ?createdBy=me)
app.get("/api/tracks", async (req, res) => {
  try {
    // later you can filter by created_by_user_id when auth exists
    const createdBy = req.query.createdBy;
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
        `SELECT id, title, primary_artist_name, release_date, created_at
         FROM tracks
         WHERE created_by_user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
      return res.json({ tracks: result.rows });
    }

    const result = await pool.query(
      `SELECT id, title, primary_artist_name, release_date, created_at
       FROM tracks
       ORDER BY created_at DESC`
    );

    res.json({ tracks: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).send("Database error");
  }
});

// =====================================================
// Royalty Engine
// =====================================================

// Execute monthly royalty allocation (user-centric distribution model)
app.post("/api/royalties/run", async (req, res) => {
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

        await client.query(
          `INSERT INTO public.royalty_allocations
           (run_id, track_id, contributor_name, contributor_role, amount_pennies)
           VALUES ($1, $2, $3, $4, $5)`,
          [runId, trackId, primaryArtist, "Primary Artist", totalPennies.toString()]
        );

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
        await client.query(
          `INSERT INTO public.royalty_allocations
           (run_id, track_id, contributor_name, contributor_role, amount_pennies)
           VALUES ($1, $2, $3, $4, $5)`,
          [runId, trackId, c.name, c.role, c.pennies.toString()]
        );
      }

      trackSummaries.push({
        trackId,
        totalPennies: totalPennies.toString(),
        allocatedPennies: totalPennies.toString(),
        usedFallback: false
      });
    }

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

// =====================================================
// Dashboard
// =====================================================

// Aggregate dashboard metrics for CREATOR
app.get("/api/dashboard/summary", authenticate, requireRole("CREATOR"), async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
