/*
Will need to have the name field automatically set to the current users name
SUCCESS Modal to appear when track uploads successfully
*/
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getHealth } from "../services/api.js";
import "./RegisterTrack.css";

const DRAFT_KEY = "wave.registerTrack.draft.v1";

const ROLE_OPTIONS = ["Artist", "Producer", "Writer", "Engineer", "Label"];

function emptyContributor() {
  return { name: "", role: "Artist", share: "", email: "" };
}

export default function RegisterTrack() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const navigate = useNavigate();

  const [trackTitle, setTrackTitle] = useState("");
  const [primaryArtist, setPrimaryArtist] = useState("");
  const [releaseDate, setReleaseDate] = useState(""); // yyyy-mm-dd
  const [isrc, setIsrc] = useState("");
  const [audioFile, setAudioFile] = useState(null);

  const [contributors, setContributors] = useState([emptyContributor()]);

  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;

    try {
      const draft = JSON.parse(raw);
      getHealth()
      .then(setData)
      .catch((e) => setErr(e.message));
      setTrackTitle(draft.trackTitle ?? "");
      setPrimaryArtist(draft.primaryArtist ?? "");
      setReleaseDate(draft.releaseDate ?? "");
      setIsrc(draft.isrc ?? "");
      setContributors(
        Array.isArray(draft.contributors) && draft.contributors.length > 0
          ? draft.contributors
          : [emptyContributor()]
      );
      
    } catch {
      // :D
    }
    
  }, []);

  const totalSplit = useMemo(() => {
    return contributors.reduce((sum, c) => {
      const n = Number(c.share);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [contributors]);

  const splitIsValid = useMemo(() => Math.abs(totalSplit - 100) < 0.0001, [totalSplit]);

  const formErrors = useMemo(() => {
    const errs = [];

    if (!trackTitle.trim()) errs.push("Track title is required.");
    if (!primaryArtist.trim()) errs.push("Primary artist is required.");
    if (!releaseDate) errs.push("Release date is required.");
    if (!audioFile) errs.push("Audio file is required.");

    if (contributors.length === 0) errs.push("At least one contributor is required.");

    contributors.forEach((c, idx) => {
      if (!c.name.trim()) errs.push(`Contributor ${idx + 1}: name is required.`);
      if (!c.role) errs.push(`Contributor ${idx + 1}: role is required.`);

      const shareNum = Number(c.share);
      if (!Number.isFinite(shareNum)) errs.push(`Contributor ${idx + 1}: share must be a number.`);
      if (Number.isFinite(shareNum) && (shareNum < 0 || shareNum > 100)) {
        errs.push(`Contributor ${idx + 1}: share must be between 0 and 100.`);
      }
    });

    if (!splitIsValid) errs.push(`Total split must equal 100%. Current total: ${totalSplit.toFixed(2)}%.`);

    return errs;
  }, [trackTitle, primaryArtist, releaseDate, audioFile, contributors, splitIsValid, totalSplit]);

  const canSubmit = formErrors.length === 0 && !submitting;

  function updateContributor(index, patch) {
    setContributors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addContributor() {
    setContributors((prev) => [...prev, emptyContributor()]);
  }

  function removeContributor(index) {
    setContributors((prev) => prev.filter((_, i) => i !== index));
  }

  function saveDraft() {
    setSubmitError("");

    const draft = {
      trackTitle,
      primaryArtist,
      releaseDate,
      isrc,
      contributors
    };

    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    window.alert("Draft saved (audio file is not saved in draft).");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");

    if (!canSubmit) {
      setSubmitError("Please fix validation errors before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("title", trackTitle);
      fd.append("primaryArtist", primaryArtist);
      fd.append("releaseDate", releaseDate);
      fd.append("isrc", isrc);
      fd.append("audio", audioFile);
      fd.append("contributors", JSON.stringify(contributors));

      const res = await fetch("/api/tracks", {
        method: "POST",
        body: fd
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Track registration failed.");
      }

      await res.json();
      localStorage.removeItem(DRAFT_KEY);
      navigate("/tracks");
    } catch (err) {
      setSubmitError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rt-page">
      <div className="rt-header">
        <div>
          <h1 className="rt-title">Register New Track</h1>
          <p className="rt-subtitle">Add track details and define contributor splits.</p>
        </div>

        <button type="button" className="rt-btn rt-btn-secondary" onClick={() => navigate("/tracks")}>
          Cancel
        </button>
      </div>

      <div>
        <h1>Register Track</h1>
        {err && <p style={{ color: "red" }}>{err}</p>}
        {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p>Loading...</p>}
      </div>

      <form className="rt-form" onSubmit={handleSubmit}>
        <section className="rt-card">
          <h2 className="rt-sectionTitle">Track Details</h2>

          <label className="rt-label">
            Track Title *
            <input
              className="rt-input"
              value={trackTitle}
              onChange={(e) => setTrackTitle(e.target.value)}
              placeholder="Enter track title"
            />
          </label>

          <div className="rt-grid2">
            <label className="rt-label">
              Primary Artist *
              <input
                className="rt-input"
                value={primaryArtist}
                onChange={(e) => setPrimaryArtist(e.target.value)}
                placeholder="Artist name"
              />
            </label>

            <label className="rt-label">
              Release Date *
              <input
                className="rt-input"
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
              />
            </label>
          </div>

          <label className="rt-label">
            ISRC Code (Optional)
            <input
              className="rt-input"
              value={isrc}
              onChange={(e) => setIsrc(e.target.value)}
              placeholder="XX-XXX-XX-XXXXX"
            />
            <small className="rt-help">
              International Standard Recording Code – leave blank if not assigned yet.
            </small>
          </label>

          <label className="rt-label">
            Audio File *
            <input
              className="rt-input"
              type="file"
              accept="audio/*"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            />
            {audioFile && (
              <small className="rt-help">
                Selected: {audioFile.name} ({Math.round(audioFile.size / 1024)} KB)
              </small>
            )}
          </label>
        </section>

        <section className="rt-card">
          <div className="rt-rowBetween">
            <h2 className="rt-sectionTitle">Contributors & Split Percentages</h2>
            <button type="button" className="rt-btn rt-btn-secondary" onClick={addContributor}>
              + Add Contributor
            </button>
          </div>

          <div className="rt-tableWrap">
            <table className="rt-table">
              <thead>
                <tr>
                  <th>Contributor Name</th>
                  <th>Role</th>
                  <th>Share %</th>
                  <th>Email</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {contributors.map((c, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        className="rt-input"
                        value={c.name}
                        onChange={(e) => updateContributor(idx, { name: e.target.value })}
                        placeholder="Full name"
                      />
                    </td>

                    <td>
                      <select
                        className="rt-input"
                        value={c.role}
                        onChange={(e) => updateContributor(idx, { role: e.target.value })}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <div className="rt-shareCell">
                        <input
                          className="rt-input rt-shareInput"
                          value={c.share}
                          onChange={(e) => updateContributor(idx, { share: e.target.value })}
                          placeholder="0"
                        />
                        <span>%</span>
                      </div>
                    </td>

                    <td>
                      <input
                        className="rt-input"
                        value={c.email}
                        onChange={(e) => updateContributor(idx, { email: e.target.value })}
                        placeholder="contributor@email.com"
                      />
                    </td>

                    <td>
                      <button
                        type="button"
                        className="rt-btn rt-btn-danger"
                        disabled={contributors.length === 1}
                        onClick={() => removeContributor(idx)}
                        title={contributors.length === 1 ? "At least one contributor required" : "Remove"}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rt-rowBetween rt-splitSummary">
            <strong>Total Split: {totalSplit.toFixed(2)}%</strong>
            <span className={splitIsValid ? "rt-ok" : "rt-bad"}>
              {splitIsValid ? "OK" : "Must equal 100% to proceed"}
            </span>
          </div>

          {!splitIsValid && (
            <div className="rt-warning">
              <strong>Split Validation</strong>
              <div>The total percentage must equal exactly 100% before you can register this track.</div>
              <div>Current total: {totalSplit.toFixed(2)}%</div>
            </div>
          )}
        </section>

        {formErrors.length > 0 && (
          <section className="rt-card">
            <h3 className="rt-errorsTitle">Fix these issues</h3>
            <ul className="rt-errorsList">
              {formErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </section>
        )}

        {submitError && (
          <div className="rt-warning rt-warning-error">
            <strong>Submit error</strong>
            <div>{submitError}</div>
            <div className="rt-help">
              (Expected until you implement <code>POST /api/tracks</code> in Express.)
            </div>
          </div>
        )}

        <div className="rt-actions">
          <button type="button" className="rt-btn rt-btn-secondary" onClick={() => navigate("/tracks")}>
            ← Back to Tracks
          </button>

          <div className="rt-actionsRight">
            <button type="button" className="rt-btn rt-btn-secondary" onClick={saveDraft}>
              Save as Draft
            </button>

            <button type="submit" className="rt-btn rt-btn-primary" disabled={!canSubmit}>
              {submitting ? "Submitting..." : "Save and Register Work"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}