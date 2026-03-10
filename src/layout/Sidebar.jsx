import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getMe } from "../services/api.js";
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
  const [displayName, setDisplayName] = useState("Artist Studio");

  function handleLogout() {
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await getMe();
        if (!cancelled) setDisplayName(me.display_name || me.email || "Artist Studio");
      } catch {
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
      </nav>

      <div className="profile">
        <div className="avatar">AS</div>
        <div>
          <div className="name">{displayName}</div>
          <div className="tier">Independent</div>
        </div>
        <button className="logoutBtn" onClick={handleLogout} type="button">
          Logout
        </button>
      </div>
    </aside>
  );
}
