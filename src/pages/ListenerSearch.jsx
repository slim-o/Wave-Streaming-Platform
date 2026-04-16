import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiUrl, getTracks } from "../services/api.js";
import { useListenerPlayer } from "../context/ListenerPlayerContext.jsx";
import "./ListenerHome.css";

export default function ListenerSearch() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get("q") || "").toString();

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return (tracks || []).filter((t) => {
      const title = String(t.title || "").toLowerCase();
      const artist = String(t.primary_artist_name || "").toLowerCase();
      return title.includes(needle) || artist.includes(needle);
    });
  }, [q, tracks]);

  return (
    <div className="lh-page">
      <div className="lh-header">
        <h1>Search</h1>
        <p>{q ? `Results for "${q}"` : "Type to search for tracks and artists."}</p>
      </div>

      {err && <p className="lh-error">{err}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : !q.trim() ? (
        <div className="lh-empty">Type in the search bar above and press Enter.</div>
      ) : filtered.length === 0 ? (
        <div className="lh-empty">No results found.</div>
      ) : (
        <div className="lh-grid">
          {filtered.map((t, idx) => (
            <div className="lh-card" key={t.id}>
              <div className="lh-cover">
                {t.has_cover ? (
                  <img
                    className="lh-cover-img"
                    src={apiUrl(`/api/tracks/${t.id}/cover`)}
                    alt={`${t.title} cover`}
                    loading="lazy"
                    onError={(e) => {
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
                onClick={() => startTrack(t, { queue: filtered, index: idx })}
              >
                {currentTrack?.id === t.id && isPlaying ? "Playing" : "Play"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
