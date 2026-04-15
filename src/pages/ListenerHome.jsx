import { useEffect, useState } from "react";
import { apiUrl, getTracks } from "../services/api.js";
import { useListenerPlayer } from "../context/ListenerPlayerContext.jsx";
import "./ListenerHome.css";

export default function ListenerHome() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const { currentTrack, isPlaying, startTrack } = useListenerPlayer();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setErr("");
        setLoading(true);
        const data = await getTracks("all");
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
    <div className="lh-page">
      <div className="lh-header">
        <h1>Discover</h1>
        <p>All tracks currently available on Wave.</p>
      </div>

      {err && <p className="lh-error">{err}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="lh-grid">
          {tracks.length === 0 ? (
            <div className="lh-empty">No tracks available yet.</div>
          ) : (
            tracks.map((t) => (
              <div className="lh-card" key={t.id}>
                <div className="lh-cover">
                  {t.has_cover ? (
                    <img
                      className="lh-cover-img"
                      // Production uses VITE_API_BASE_URL; local dev uses the Vite proxy.
                      // apiUrl() keeps both working.
                      src={apiUrl(`/api/tracks/${t.id}/cover`)}
                      alt={`${t.title} cover`}
                      loading="lazy"
                      onError={(e) => {
                        // Hide broken images
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <div className="lh-cover-fallback"></div>
                </div>
                <div className="lh-title">{t.title}</div>
                <div className="lh-artist">{t.primary_artist_name}</div>
                <button
                  className="lh-play"
                  type="button"
                  onClick={() => startTrack(t)}
                >
                  {currentTrack?.id === t.id && isPlaying ? "Playing" : "Play"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
