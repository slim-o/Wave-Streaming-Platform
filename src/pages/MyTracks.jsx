import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getTracks } from "../services/api.js";
import "./MyTracks.css";

// NEED TO FILTER IT BASED ON CURRENT USER
// IMAGES WITH TRACKS

export default function MyTracks() {
  const [tracks, setTracks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  let navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setErr("");
        setLoading(true);

        const data = await getTracks("me");
        if (!cancelled) setTracks(data.tracks ?? []);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load tracks");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mt-page">
      <div className="mt-header">
        <div>
          <h1 className="mt-title">My Tracks</h1>
          <p className="mt-subtitle">Tracks registered on the platform.</p>
        </div>

        <Link className="mt-btn" to="/tracks/new">
          Register New Track
        </Link>
      </div>
      
      {loading && <p>Loading…</p>}
      {err && <p className="mt-error">{err}</p>}

      {!loading && !err && (
        <div className="mt-card">
          <table className="mt-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Primary Artist</th>
                <th>Release Date</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {tracks.length === 0 ? (
                <tr>
                  <td colSpan="5">No tracks yet. Register your first track.</td>
                </tr>
              ) : (
                tracks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.primary_artist_name}</td>
                    <td>{formatDate(t.release_date)}</td>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>
                      {/* add /tracks/:id later */}
                      <button className="mt-btn-secondary" disabled>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(s) {
  if (!s) return "";
  return new Date(s).toLocaleDateString();
}

function formatDateTime(s) {
  if (!s) return "";
  return new Date(s).toLocaleString();
}
