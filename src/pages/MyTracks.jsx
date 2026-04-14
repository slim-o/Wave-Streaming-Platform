import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCollaborationTracks, getTracks } from "../services/api.js";
import "./MyTracks.css";

// NEED TO FILTER IT BASED ON CURRENT USER
// IMAGES WITH TRACKS

export default function MyTracks() {
  const [tracks, setTracks] = useState(null);
  const [collabs, setCollabs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  let navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setErr("");
        setLoading(true);

        const [ownedData, collabData] = await Promise.all([
          getTracks("me"),
          getCollaborationTracks()
        ]);

        if (!cancelled) {
          setTracks(ownedData.tracks ?? []);
          setCollabs(collabData.tracks ?? []);
        }
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
        <>
          <div className="mt-card">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 12px 0" }}>
              <div style={{ fontWeight: 700, color: "#0f172a" }}>Owned Tracks</div>
              <div style={{ color: "#64748b", fontSize: 13 }}>Tracks registered by this account.</div>
            </div>
            <table className="mt-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Primary Artist</th>
                  <th>Release Date</th>
                  <th>Created</th>
                  <th>Splits</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {(tracks || []).length === 0 ? (
                  <tr>
                    <td colSpan="6">No tracks yet. Register your first track.</td>
                  </tr>
                ) : (
                  (tracks || []).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="mt-titleCell">
                          <div className="mt-thumbWrap">
                            {t.has_cover ? (
                              <img
                                className="mt-thumb"
                                src={`/api/tracks/${t.id}/cover`}
                                alt=""
                                loading="lazy"
                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                              />
                            ) : null}
                          </div>
                          <span>{t.title}</span>
                        </div>
                      </td>
                      <td>{t.primary_artist_name}</td>
                      <td>{formatDate(t.release_date)}</td>
                      <td>{formatDateTime(t.created_at)}</td>
                      <td>
                        <span className={t.split_change_status === "PENDING" ? "mt-badge pending" : "mt-badge active"}>
                          {t.split_change_status || "ACTIVE"}
                        </span>
                      </td>
                      <td>
                        <Link className="mt-btn-secondary" to={`/tracks/${t.id}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-card" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 12px 0" }}>
              <div style={{ fontWeight: 700, color: "#0f172a" }}>Collaborations</div>
              <div style={{ color: "#64748b", fontSize: 13 }}>Tracks where this account appears in contributor splits.</div>
            </div>
            <table className="mt-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Primary Artist</th>
                  <th>Release Date</th>
                  <th>Created</th>
                  <th>Splits</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {(collabs || []).length === 0 ? (
                  <tr>
                    <td colSpan="6">No collaboration tracks yet.</td>
                  </tr>
                ) : (
                  (collabs || []).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="mt-titleCell">
                          <div className="mt-thumbWrap">
                            {t.has_cover ? (
                              <img
                                className="mt-thumb"
                                src={`/api/tracks/${t.id}/cover`}
                                alt=""
                                loading="lazy"
                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                              />
                            ) : null}
                          </div>
                          <span>{t.title}</span>
                        </div>
                      </td>
                      <td>{t.primary_artist_name}</td>
                      <td>{formatDate(t.release_date)}</td>
                      <td>{formatDateTime(t.created_at)}</td>
                      <td>
                        <span className={t.split_change_status === "PENDING" ? "mt-badge pending" : "mt-badge active"}>
                          {t.split_change_status || "ACTIVE"}
                        </span>
                      </td>
                      <td>
                        <Link className="mt-btn-secondary" to={`/tracks/${t.id}`}>
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
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
