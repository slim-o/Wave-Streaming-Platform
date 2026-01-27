import { NavLink } from "react-router-dom";
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
          <div className="name">Artist Studio</div>
          <div className="tier">Independent</div>
        </div>
      </div>
    </aside>
  );
}