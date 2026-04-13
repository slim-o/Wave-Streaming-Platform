import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getMe } from "../services/api.js";

export default function RequireRole({ allowed, children }) {
  const location = useLocation();
  const token = localStorage.getItem("token");
  const [status, setStatus] = useState({ loading: true, role: null, error: "" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) {
        if (!cancelled) setStatus({ loading: false, role: null, error: "missing_token" });
        return;
      }

      try {
        const me = await getMe();
        if (!cancelled) setStatus({ loading: false, role: me?.role || null, error: "" });
      } catch {
        if (!cancelled) setStatus({ loading: false, role: null, error: "me_failed" });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  if (status.loading) return <p style={{ padding: 16 }}>Loading…</p>;

  if (!token || status.error) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = status.role;
  if (!role || !Array.isArray(allowed) || !allowed.includes(role)) {
    // Redirect to the "home" page for the current role.
    if (role === "LISTENER") return <Navigate to="/listener" replace />;
    return <Navigate to="/" replace />;
  }

  return children;
}

