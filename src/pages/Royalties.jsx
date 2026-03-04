import { useEffect, useMemo, useState } from "react";
import { getRoyaltiesAllocations } from "../services/api.js";
import "./Royalties.css";

export default function Royalties() {
  const [allocations, setAllocations] = useState([]);
  const [monthInput, setMonthInput] = useState(getCurrentMonth());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const monthStart = `${monthInput}-01`;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setErr("");
        setLoading(true);
        const res = await getRoyaltiesAllocations(monthStart);
        if (!cancelled) setAllocations(res.allocations ?? []);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load allocations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [monthStart]);

  const {
    totalPennies,
    allocationCount,
    trackCount,
    trackRows,
    platformFeePennies,
    creatorPennies
  } = useMemo(() => {
    let total = 0;
    const trackMap = new Map();

    for (const a of allocations) {
      const amount = Number(a.amount_pennies) || 0;
      total += amount;

      const entry = trackMap.get(a.track_id) || {
        trackId: a.track_id,
        trackTitle: a.track_title || "",
        totalPennies: 0,
        contributors: new Set()
      };
      entry.totalPennies += amount;
      if (a.contributor_name) entry.contributors.add(a.contributor_name);
      trackMap.set(a.track_id, entry);
    }

    const rows = Array.from(trackMap.values()).map((t) => ({
      trackId: t.trackId,
      trackTitle: t.trackTitle,
      totalPennies: t.totalPennies,
      contributors: t.contributors.size
    })).sort((a, b) => b.totalPennies - a.totalPennies);

    const fee = Math.round(total * 0.10);
    const creator = total - fee;

    return {
      totalPennies: total,
      allocationCount: allocations.length,
      trackCount: trackMap.size,
      trackRows: rows,
      platformFeePennies: fee,
      creatorPennies: creator
    };
  }, [allocations]);

  return (
    <div className="ry-page">
      <div className="ry-header">
        <div>
          <h1 className="ry-title">Royalties</h1>
          <p className="ry-subtitle">Monthly earnings and allocation breakdown.</p>
        </div>
        <div className="ry-controls">
          <label className="ry-label" htmlFor="ry-month">Month</label>
          <input
            id="ry-month"
            className="ry-input"
            type="month"
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
          />
        </div>
      </div>

      {err && <p className="ry-error">{err}</p>}

      <div className="ry-grid">
        <div className="ry-card">
          <div className="ry-card-title">Monthly Summary</div>
          {loading ? (
            <p>Loadingâ€¦</p>
          ) : (
            <div className="ry-stats">
              <div className="ry-stat">
                <div className="ry-stat-label">Total Earnings</div>
                <div className="ry-stat-value">{formatMoney(totalPennies)}</div>
              </div>
              <div className="ry-stat">
                <div className="ry-stat-label">Allocations</div>
                <div className="ry-stat-value">{allocationCount}</div>
              </div>
              <div className="ry-stat">
                <div className="ry-stat-label">Tracks</div>
                <div className="ry-stat-value">{trackCount}</div>
              </div>
              <div className="ry-stat">
                <div className="ry-stat-label">Platform Fee (10%)</div>
                <div className="ry-stat-value">{formatMoney(platformFeePennies)}</div>
              </div>
              <div className="ry-stat">
                <div className="ry-stat-label">Creator Share</div>
                <div className="ry-stat-value">{formatMoney(creatorPennies)}</div>
              </div>
            </div>
          )}
        </div>

        <div className="ry-card">
          <div className="ry-card-title">Payout Trace</div>
          {loading ? (
            <p>Loadingâ€¦</p>
          ) : (
            <div className="ry-trace">
              <div className="ry-trace-step">
                <div className="ry-trace-label">Subscription Total</div>
                <div className="ry-trace-value">{formatMoney(totalPennies)}</div>
              </div>
              <div className="ry-trace-arrow">â†’</div>
              <div className="ry-trace-step">
                <div className="ry-trace-label">Platform Fee</div>
                <div className="ry-trace-value">{formatMoney(platformFeePennies)}</div>
              </div>
              <div className="ry-trace-arrow">â†’</div>
              <div className="ry-trace-step">
                <div className="ry-trace-label">Tracks</div>
                <div className="ry-trace-value">{formatMoney(creatorPennies)}</div>
              </div>
              <div className="ry-trace-arrow">â†’</div>
              <div className="ry-trace-step">
                <div className="ry-trace-label">Creator Shares</div>
                <div className="ry-trace-value">{formatMoney(creatorPennies)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ry-card">
        <div className="ry-card-title">Per‑Track Breakdown</div>
        {loading ? (
          <p>Loadingâ€¦</p>
        ) : (
          <table className="ry-table">
            <thead>
              <tr>
                <th>Track ID</th>
                <th>Title</th>
                <th>Total Allocated</th>
                <th>Contributors</th>
              </tr>
            </thead>
            <tbody>
              {trackRows.length === 0 ? (
                <tr>
                  <td colSpan="4">No allocations for this month.</td>
                </tr>
              ) : (
                trackRows.map((t) => (
                  <tr key={t.trackId}>
                    <td>{t.trackId}</td>
                    <td>{t.trackTitle || "—"}</td>
                    <td>{formatMoney(t.totalPennies)}</td>
                    <td>{t.contributors}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function getCurrentMonth() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function formatMoney(pennies) {
  const value = Number(pennies || 0) / 100;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}
