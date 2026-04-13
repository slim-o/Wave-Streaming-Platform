import { useEffect, useMemo, useState } from "react";
import { getAdminRoyaltyRuns, runRoyalties } from "../services/api.js";
import "./AdminRoyalties.css";

function monthInputToMonthStart(value) {
  if (!value) return "";
  const parts = String(value).split("-");
  if (parts.length !== 2) return "";
  const yyyy = parts[0];
  const mm = parts[1];
  if (!/^\d{4}$/.test(yyyy) || !/^\d{2}$/.test(mm)) return "";
  return `${yyyy}-${mm}-01`;
}

function currentMonthInputValue() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export default function AdminRoyalties() {
  const [monthInput, setMonthInput] = useState(currentMonthInputValue());
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const monthStart = useMemo(() => monthInputToMonthStart(monthInput), [monthInput]);

  async function refreshRuns() {
    setLoadingRuns(true);
    try {
      const r = await getAdminRoyaltyRuns(6);
      setRuns(r.runs || []);
    } catch (e) {
      setErr(e.message || "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRun() {
    if (!monthStart) {
      setErr("Pick a valid month");
      return;
    }
    setErr("");
    setRunning(true);
    setResult(null);
    try {
      const r = await runRoyalties(monthStart);
      setResult(r);
      await refreshRuns();
    } catch (e) {
      setErr(e.message || "Failed to run royalties");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="ar-page">
      <div className="ar-header">
        <div>
          <h1 className="ar-title">Admin Panel</h1>
          <p className="ar-subtitle">Run monthly settlement and view recent runs.</p>
        </div>
      </div>

      {err && <p className="ar-error">{err}</p>}

      <div className="ar-card">
        <div className="ar-row">
          <label className="ar-label">
            Month
            <input
              className="ar-input"
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
            />
          </label>

          <button className="ar-btn" type="button" onClick={onRun} disabled={running || !monthStart}>
            {running ? "Running..." : "Run Royalties"}
          </button>
        </div>

        {result && (
          <div className="ar-result">
            <div className="ar-result-title">Run Result</div>
            <pre className="ar-pre">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>

      <div className="ar-card">
        <div className="ar-card-title">Last Runs</div>
        {loadingRuns ? (
          <p>Loading…</p>
        ) : runs.length === 0 ? (
          <p className="ar-muted">No runs found.</p>
        ) : (
          <div className="ar-table-wrap">
            <table className="ar-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Executed</th>
                  <th>Allocations</th>
                  <th>Tracks</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId}>
                    <td>{r.monthStart}</td>
                    <td>{r.executedAt ? new Date(r.executedAt).toLocaleString() : ""}</td>
                    <td>{r.allocationCount}</td>
                    <td>{r.trackCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

