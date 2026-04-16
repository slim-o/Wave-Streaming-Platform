import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ListenerSidebar from "./ListenerSidebar.jsx";
import { apiUrl, getMe, postPlayEvent } from "../services/api.js";
import ProfileModal from "../components/ProfileModal.jsx";
import { ListenerPlayerProvider } from "../context/ListenerPlayerContext.jsx";
import "./listenerLayout.css";

export default function ListenerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [user, setUser] = useState(null);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [isFlushing, setIsFlushing] = useState(false);
  const [queueTracks, setQueueTracks] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [searchText, setSearchText] = useState("");

  const audioRef = useRef(null);
  const sessionRef = useRef(null);
  const seekingRef = useRef(false);
  const lastObservedSecRef = useRef(0);
  const flushingRef = useRef(false);
  const firstPathRef = useRef(true);
  const suppressPauseFlushRef = useRef(false);

  function getMonthStart(dateObj = new Date()) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}-01`;
  }

  function mergeRanges(ranges, nextStartMs, nextEndMs) {
    if (nextEndMs <= nextStartMs) return ranges;
    const sorted = [...ranges, [nextStartMs, nextEndMs]].sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of sorted) {
      if (merged.length === 0) {
        merged.push(r);
        continue;
      }
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push(r);
      }
    }
    return merged;
  }

  function addListenedRange(startMs, endMs) {
    if (!sessionRef.current) return;
    sessionRef.current.ranges = mergeRanges(sessionRef.current.ranges, startMs, endMs);
  }

  function getUniqueListenedMs(ranges) {
    return ranges.reduce((sum, r) => sum + (r[1] - r[0]), 0);
  }

  function ensureSession(track) {
    if (!track) return;
    if (sessionRef.current && sessionRef.current.trackId === track.id) return;
    sessionRef.current = {
      trackId: track.id,
      monthStart: getMonthStart(),
      ranges: []
    };
  }

  async function flushSession(options = {}) {
    if (!sessionRef.current || flushingRef.current) return;

    const listenedMs = Math.round(getUniqueListenedMs(sessionRef.current.ranges));
    const payload = {
      trackId: sessionRef.current.trackId,
      monthStart: sessionRef.current.monthStart,
      listenedMs
    };

    sessionRef.current = null;
    if (listenedMs < 10000) return;

    try {
      flushingRef.current = true;
      setIsFlushing(true);
      await postPlayEvent(payload, options);
    } catch (e) {
      console.error("Failed to flush play session", e);
    } finally {
      flushingRef.current = false;
      setIsFlushing(false);
    }
  }

  function setPlaybackPosition(nextSec) {
    const max = durationSec || 0;
    const bounded = Math.max(0, Math.min(nextSec, max));
    setPositionSec(bounded);
    const audio = audioRef.current;
    if (audio) audio.currentTime = bounded;
    lastObservedSecRef.current = bounded;
  }

  async function startTrack(track, opts = null) {
    if (!track?.id) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (opts && Array.isArray(opts.queue)) {
      setQueueTracks(opts.queue);
      setQueueIndex(Number.isFinite(Number(opts.index)) ? Number(opts.index) : -1);
    } else if (queueTracks && queueTracks.length > 0) {
      const idx = queueTracks.findIndex((t) => String(t?.id) === String(track.id));
      if (idx >= 0) setQueueIndex(idx);
    }

    if (currentTrack?.id && currentTrack.id !== track.id) {
      suppressPauseFlushRef.current = true;
      audio.pause();
      suppressPauseFlushRef.current = false;
      await flushSession();
    }

    setCurrentTrack(track);
    setPositionSec(0);
    setDurationSec(0);
    lastObservedSecRef.current = 0;
    ensureSession(track);

    const token = localStorage.getItem("token");
    const srcPath = token
      ? `/api/tracks/${track.id}/stream?token=${encodeURIComponent(token)}`
      : `/api/tracks/${track.id}/stream`;
    const src = apiUrl(srcPath);

    if (audio.src !== src) {
      audio.src = src;
      audio.load();
    }

    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Playback failed", err);
      setIsPlaying(false);
    }
  }

  async function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    ensureSession(currentTrack);
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error("Playback failed", err);
      setIsPlaying(false);
    }
  }

  async function playPrevious() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.currentTime > 3) {
      setPlaybackPosition(0);
      return;
    }

    if (queueTracks.length > 0 && queueIndex > 0) {
      const prevIdx = queueIndex - 1;
      const prevTrack = queueTracks[prevIdx];
      if (prevTrack?.id) {
        await startTrack(prevTrack, { queue: queueTracks, index: prevIdx });
        return;
      }
    }

    setPlaybackPosition(0);
  }

  async function playNext() {
    if (!currentTrack) return;
    if (queueTracks.length > 0 && queueIndex >= 0 && queueIndex + 1 < queueTracks.length) {
      const nextIdx = queueIndex + 1;
      const nextTrack = queueTracks[nextIdx];
      if (nextTrack?.id) {
        await startTrack(nextTrack, { queue: queueTracks, index: nextIdx });
      }
    }
  }

  function seekTo(nextSec) {
    setPlaybackPosition(nextSec);
  }

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
  }

  function handleLogout() {
    void flushSession();
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      try {
        const me = await getMe();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      }
    }
    loadUser();
    return () => { cancelled = true; };
  }, []);

  // Keep the header search box synced with the Search page query string.
  useEffect(() => {
    if (!location.pathname.startsWith("/listener/search")) return;
    const q = (searchParams.get("q") || "").toString();
    setSearchText(q);
  }, [location.pathname, searchParams]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    function onPlay() {
      setIsPlaying(true);
      ensureSession(currentTrack);
      lastObservedSecRef.current = audio.currentTime || 0;
    }

    function onPause() {
      setIsPlaying(false);
      if (suppressPauseFlushRef.current) return;
      void flushSession();
    }

    function onEnded() {
      setIsPlaying(false);
      void flushSession();
    }

    function onLoadedMetadata() {
      const d = Number(audio.duration) || 0;
      setDurationSec(d);
      setPositionSec(Number(audio.currentTime) || 0);
      lastObservedSecRef.current = Number(audio.currentTime) || 0;
    }

    function onTimeUpdate() {
      const current = Number(audio.currentTime) || 0;
      const prev = lastObservedSecRef.current;
      if (isPlaying && !seekingRef.current && current > prev) {
        addListenedRange(Math.round(prev * 1000), Math.round(current * 1000));
      }
      lastObservedSecRef.current = current;
      setPositionSec(current);
    }

    function onSeeking() {
      seekingRef.current = true;
      setPositionSec(Number(audio.currentTime) || 0);
    }

    function onSeeked() {
      seekingRef.current = false;
      lastObservedSecRef.current = Number(audio.currentTime) || 0;
      setPositionSec(Number(audio.currentTime) || 0);
    }

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onSeeked);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    function handleBeforeUnload() {
      void flushSession({ keepalive: true });
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      void flushSession({ keepalive: true });
    };
  }, []);

  useEffect(() => {
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }
    void flushSession();
  }, [location.pathname]);

  const playerContextValue = {
    currentTrack,
    isPlaying,
    positionSec,
    durationSec,
    isFlushing,
    startTrack
  };

  const hasPrev = Boolean(currentTrack && queueTracks.length > 0 && queueIndex > 0);
  const hasNext = Boolean(currentTrack && queueTracks.length > 0 && queueIndex >= 0 && queueIndex + 1 < queueTracks.length);

  return (
    <ListenerPlayerProvider value={playerContextValue}>
      <div className="ls-shell">
        <header className="ls-header">
          <div className="ls-logo">WAVE</div>
          <div className="ls-search">
            <span className="ls-search-icon">🔍</span>
            <input
              className="ls-search-input"
              placeholder="Search songs, artists, playlists..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchText("");
                  return;
                }
                if (e.key !== "Enter") return;
                const q = (searchText || "").trim();
                navigate(q ? `/listener/search?q=${encodeURIComponent(q)}` : "/listener/search");
              }}
            />
          </div>
          <div className="ls-actions">
            
            <button
              className="ls-avatar-btn"
              type="button"
              aria-label="Open profile"
              onClick={() => setShowProfileModal(true)}
            >
              <svg className="ls-avatar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7" />
              </svg>
            </button>
          </div>
        </header>

        <ListenerSidebar />

        <main className="ls-main">
          <Outlet />
        </main>

        <div className="ls-player">
          <div className="ls-player-left">
            <div className="ls-cover">Album</div>
            <div>
              <div className="ls-track-title">{currentTrack?.title || "Select a track"}</div>
              <div className="ls-track-artist">{currentTrack?.primary_artist_name || "Artist"}</div>
            </div>
          </div>
          <div className="ls-player-center">
            <div className="ls-controls">
              <button
                className="ls-control-icon"
                type="button"
                onClick={playPrevious}
                aria-label="Previous track"
                disabled={!currentTrack}
                title="Previous"
              >
                ⏮
              </button>
              <button className="ls-play" type="button" onClick={togglePlayPause}>
                {isPlaying ? "⏸" : "▶"}
              </button>
              <button
                className="ls-control-icon"
                type="button"
                onClick={playNext}
                aria-label="Next track"
                disabled={!hasNext}
                title="Next"
              >
                ⏭
              </button>
            </div>
            <div className="ls-progress">
              <span>{formatClock(positionSec)}</span>
              <div className="ls-progress-mid">
                <input
                  className="ls-seek"
                  type="range"
                  min="0"
                  max={durationSec || 0}
                  value={positionSec}
                  style={{ "--seek-progress": `${durationSec ? (positionSec / durationSec) * 100 : 0}%` }}
                  onChange={(e) => seekTo(Number(e.target.value))}
                />
              </div>
              <span>{formatClock(durationSec)}</span>
            </div>
          </div>
          <div className="ls-player-right">
            <button className="ls-control" type="button">Queue</button>
            <button className="ls-control" type="button">Device</button>
            <button className="ls-control" type="button">Volume</button>
            <div className="ls-vol"><div className="ls-vol-fill" /></div>
          </div>
        </div>

        <audio ref={audioRef} preload="metadata" />

        <ProfileModal
          open={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          user={user}
          onLogout={handleLogout}
        />
        {isFlushing && <div className="ls-saving">Saving listening event...</div>}
      </div>
    </ListenerPlayerProvider>
  );
}
