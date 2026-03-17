import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import ListenerSidebar from "./ListenerSidebar.jsx";
import { getMe } from "../services/api.js";
import ProfileModal from "../components/ProfileModal.jsx";
import "./listenerLayout.css";

export default function ListenerLayout() {
  const navigate = useNavigate();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [user, setUser] = useState(null);

  function handleLogout() {
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

  return (
    <div className="ls-shell">
      <header className="ls-header">
        <div className="ls-logo">WAVE</div>
        <div className="ls-search">
          <span className="ls-search-icon">⌕</span>
          <input className="ls-search-input" placeholder="Search songs, artists, playlists..." />
        </div>
        <div className="ls-actions">
          <button className="ls-bell" type="button">🔔</button>
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
            <div className="ls-track-title">Select a track</div>
            <div className="ls-track-artist">Artist</div>
          </div>
        </div>
        <div className="ls-player-center">
          <div className="ls-controls">
            <button className="ls-control" type="button">⟲</button>
            <button className="ls-control" type="button">⏮</button>
            <button className="ls-play" type="button">▶</button>
            <button className="ls-control" type="button">⏭</button>
            <button className="ls-control" type="button">🔁</button>
          </div>
          <div className="ls-progress">
            <span>0:00</span>
            <div className="ls-bar"><div className="ls-bar-fill" /></div>
            <span>3:30</span>
          </div>
        </div>
        <div className="ls-player-right">
          <button className="ls-control" type="button">☰</button>
          <button className="ls-control" type="button">🖥</button>
          <button className="ls-control" type="button">🔊</button>
          <div className="ls-vol"><div className="ls-vol-fill" /></div>
        </div>
      </div>

      <ProfileModal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
        onLogout={handleLogout}
      />
    </div>
  );
}
