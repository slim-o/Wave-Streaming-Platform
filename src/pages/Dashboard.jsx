import { useEffect, useState } from "react";
import { getDashboardSummary } from "../services/api.js";
import "./Dashboard.css";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setErr("");
        setLoading(true);
        const res = await getDashboardSummary();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="db-page">
      <div className="db-header">
        <div>
          <h1 className="db-title">Dashboard</h1>
          <p className="db-subtitle">Your latest royalty performance.</p>
        </div>
      </div>

      {err && <p className="db-error">{err}</p>}

      <div className="db-grid">
        <div className="db-card">
          <div className="db-card-label">Total Earnings</div>
          <div className="db-card-value">{loading ? "Loading..." : formatMoney(data?.totalEarnings)}</div>
        </div>
        <div className="db-card">
          <div className="db-card-label">Tracks</div>
          <div className="db-card-value">{loading ? "Loading..." : data?.trackCount ?? 0}</div>
        </div>
        <div className="db-card">
          <div className="db-card-label">Allocations</div>
          <div className="db-card-value">{loading ? "Loading..." : data?.allocationCount ?? 0}</div>
        </div>
        <div className="db-card">
          <div className="db-card-label">Last Run</div>
          <div className="db-card-value">{loading ? "Loading..." : formatMonth(data?.lastRunMonth)}</div>
        </div>
      </div>
    </div>
  );
}

function formatMoney(pennies) {
  const value = Number(pennies || 0) / 100;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function formatMonth(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short" });
}
