import express from "express";
import cors from "cors";
import dotenv from "dotenv";

//temp to test it works as intended
import multer from "multer";
import crypto from "crypto";

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

app.post("/api/tracks", upload.single("audio"), (req, res) => {
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

    // return a fake trackId for now and echo the received payload
    const trackId = crypto.randomUUID();

    res.status(201).json({
      trackId,
      title,
      primaryArtist,
      releaseDate,
      isrc: isrc || null,
      audio: {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        sizeBytes: req.file.size
      },
      contributors: contributorsArr
    });
  } catch (e) {
    res.status(500).send("Server error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));