import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import "./layout.css";

export default function CreatorLayout() {
  return (
    <div className="appShell">
      <Sidebar />
      <main className="mainContent">
        <Outlet />
      </main>
    </div>
  );
}