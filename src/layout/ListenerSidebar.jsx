import { NavLink } from "react-router-dom";
import "./listenerSidebar.css";

const items = [
  { to: "/listener", label: "Home" },
  { to: "/listener/search", label: "Search" },
  { to: "/listener/library", label: "Library" },
  { to: "/listener/impact", label: "My Impact" }
];

export default function ListenerSidebar() {
  return (
    <aside className="lsb-sidebar">
      {/* <div className="lsb-logo">W</div> */}

      <nav className="lsb-nav">
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === "/listener"}
            className={({ isActive }) => (isActive ? "lsb-item active" : "lsb-item")}
          >
            {i.label}
          </NavLink>
        ))}
      </nav>

      <div className="lsb-section">
        <div className="lsb-section-title">Playlists</div>
        <div className="lsb-section-item">Chill Vibes</div>
        <div className="lsb-section-item">Workout Mix</div>
        <div className="lsb-section-item muted">+ Create playlist</div>
      </div>
    </aside>
  );
}
