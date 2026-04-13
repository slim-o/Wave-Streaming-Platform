import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getMe } from "../services/api.js";
import ProfileModal from "../components/ProfileModal.jsx";
import "./sidebar.css";

const items = [
  { to: "/", label: "Dashboard" },
  { to: "/tracks", label: "My Tracks" },
  { to: "/analytics", label: "Analytics" },
  { to: "/royalties", label: "Royalties" },
  { to: "/collaborators", label: "Collaborators" },
  { to: "/settings", label: "Settings" }
];

export default function Sidebar() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  function handleLogout() {
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await getMe();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) setUser(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="sidebar">
      <div className="logo">W</div>

      <nav className="nav">
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === "/"}
            className={({ isActive }) => (isActive ? "navItem active" : "navItem")}
          >
            {i.label}
          </NavLink>
        ))}

        {user?.role === "ADMIN" && (
          <>
            <NavLink
              to="/admin/royalties"
              className={({ isActive }) => (isActive ? "navItem active" : "navItem")}
            >
              Admin
            </NavLink>
            <NavLink
              to="/listener"
              className={({ isActive }) => (isActive ? "navItem active" : "navItem")}
            >
              Listener View
            </NavLink>
          </>
        )}
      </nav>

      <div className="profile">
        <button
          className="avatarBtn"
          type="button"
          aria-label="Open profile"
          onClick={() => setShowProfileModal(true)}
        >
          <svg className="avatarIcon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7" />
          </svg>
        </button>
        <div>
          <div className="name">{user?.display_name || user?.email || "Artist Studio"}</div>
          <div className="tier">Independent</div>
        </div>
      </div>

      <ProfileModal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
        onLogout={handleLogout}
      />
    </aside>
  );
}
