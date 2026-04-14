import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { exportTrackEarningsCsv, getTrackEarnings } from "../services/api.js";
import "./TrackEarnings.css";

function penniesToPoundsString(penniesBigInt) {
  const isNeg = penniesBigInt < 0n;
  const abs = isNeg ? -penniesBigInt : penniesBigInt;
  const pounds = abs / 100n;
  const p = abs % 100n;
  const s = `${pounds.toString()}.${p.toString().padStart(2, "0")}`;
  return isNeg ? `-£${s}` : `£${s}`;
}

function parsePennies(value) {
  try {
    return BigInt(value || 0);
  } catch {
    return 0n;
  }
}

function formatMonthLabel(monthStart) {
  if (!monthStart) return "";
  const d = new Date(monthStart);
  if (Number.isNaN(d.getTime())) return monthStart;
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString();
}

export default function TrackEarnings() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [monthInput, setMonthInput] = useState("");
  const [exporting, setExporting] = useState(false);

  const monthStart = monthInput ? `${monthInput}-01` : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setErr("");
        setLoading(true);
        const r = await getTrackEarnings(id);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load track earnings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    // Initialize the month selector from the server-resolved month (latest run).
    if (!data?.monthStart) return;
    const d = new Date(data.monthStart);
    if (Number.isNaN(d.getTime())) return;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    setMonthInput(`${yyyy}-${mm}`);
  }, [data?.monthStart]);

  useEffect(() => {
    let cancelled = false;
    async function loadForMonth() {
      if (!monthStart) return;
      try {
        setErr("");
        setLoading(true);
        const r = await getTrackEarnings(id, monthStart);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load track earnings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadForMonth();
    return () => { cancelled = true; };
  }, [id, monthStart]);

  const computed = useMemo(() => {
    const trackTotalPennies = parsePennies(data?.earnings?.trackTotalPennies);
    const feePennies = trackTotalPennies / 10n; // illustrative 10% platform fee (UI-only)
    const listenedMs = parsePennies(data?.playStats?.listenedMs);
    const listenedMinutes = Number(listenedMs) / 1000 / 60;

    return {
      trackTotalPennies,
      feePennies,
      listenedMinutes
    };
  }, [data]);

  const monthLabel = data?.monthStart ? formatMonthLabel(data.monthStart) : null;

  return (
    <div className="te-page">
      <div className="te-header">
        <div>
          <Link className="te-back" to="/tracks">
            &larr; Back to My Tracks
          </Link>
          <h1 className="te-title">
            {data?.track?.title ? `Earnings for ${data.track.title}` : "Track Earnings"}
            {monthLabel ? ` - ${monthLabel}` : ""}
          </h1>
          <p className="te-subtitle">Detailed breakdown of earnings and royalty allocation.</p>
        </div>

        <div className="te-actions">
          <div className="te-month">
            <label className="te-month-label" htmlFor="te-month">Month</label>
            <input
              id="te-month"
              className="te-month-input"
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
            />
          </div>

          <button
            className="te-btn"
            disabled={loading || exporting || !monthStart}
            type="button"
            onClick={async () => {
              try {
                setErr("");
                setExporting(true);
                const { blob, filename } = await exportTrackEarningsCsv(id, monthStart);
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              } catch (e) {
                setErr(e.message || "Failed to export CSV");
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="te-tabs" role="tablist" aria-label="Track navigation">
        <NavLink
          end
          to="."
          relative="path"
          className={({ isActive }) => (isActive ? "te-tab active" : "te-tab")}
        >
          Overview & Earnings
        </NavLink>
        <NavLink
          to="splits"
          relative="path"
          className={({ isActive }) => (isActive ? "te-tab active" : "te-tab")}
        >
          Contributors & Splits
        </NavLink>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p className="te-error">{err}</p>}

      {!loading && !err && data && (
        <>
          {!data.monthStart && (
            <div className="te-card te-empty">
              <h2 className="te-card-title">No settlements yet</h2>
              <p className="te-muted">Run royalties for a month to populate this breakdown.</p>
            </div>
          )}

          <div className="te-card te-track">
            <div className="te-track-left">
              <div className="te-cover" aria-hidden="true">♪</div>
              <div>
                <div className="te-track-name">{data.track.title}</div>
                <div className="te-track-meta">
                  <span>{data.track.primaryArtistName}</span>
                  <span className="te-dot">•</span>
                  <span>Released {formatDate(data.track.releaseDate)}</span>
                  {data.track.isrc ? (
                    <>
                      <span className="te-dot">•</span>
                      <span>ISRC: {data.track.isrc}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="te-track-stats">
              <div className="te-stat">
                <div className="te-stat-label">Total Streams</div>
                <div className="te-stat-value">{data.playStats.playEvents.toLocaleString()}</div>
              </div>
              <div className="te-stat">
                <div className="te-stat-label">Listened Minutes</div>
                <div className="te-stat-value">{Number.isFinite(computed.listenedMinutes) ? computed.listenedMinutes.toFixed(1) : "0.0"}</div>
              </div>
              <div className="te-stat">
                <div className="te-stat-label">Total Track Earnings</div>
                <div className="te-stat-value">{penniesToPoundsString(computed.trackTotalPennies)}</div>
              </div>
              <div className="te-stat">
                <div className="te-stat-label">Your Share This Month</div>
                <div className="te-stat-value">
                  {data.earnings.hasYouMatch ? penniesToPoundsString(parsePennies(data.earnings.yourPennies)) : "Not linked"}
                </div>
                {!data.earnings.hasYouMatch && (
                  <div className="te-stat-hint">No contributor email match.</div>
                )}
              </div>
            </div>
          </div>

          <div className="te-card">
            <h2 className="te-card-title">Payout Trace</h2>
            <p className="te-muted">How earnings were calculated for this track.</p>

            <div className="te-trace">
              <div className="te-trace-step">
                <div className="te-step-num">1</div>
                <div className="te-step-body">
                  <div className="te-step-title">Allocated Subscription Revenue to This Track</div>
                  <div className="te-step-row">
                    <span>Allocated to track (engine output)</span>
                    <span>{penniesToPoundsString(computed.trackTotalPennies)}</span>
                  </div>
                </div>
              </div>

              <div className="te-trace-step">
                <div className="te-step-num">2</div>
                <div className="te-step-body">
                  <div className="te-step-title">Platform Fee (Illustrative)</div>
                  <div className="te-muted te-small">Shown for explanation only; the allocation engine does not deduct fees.</div>
                  <div className="te-step-row">
                    <span>Illustrative 10% platform fee</span>
                    <span>{penniesToPoundsString(computed.feePennies)}</span>
                  </div>
                </div>
              </div>

              <div className="te-trace-step">
                <div className="te-step-num">3</div>
                <div className="te-step-body">
                  <div className="te-step-title">Royalty Pool for Track</div>
                  <div className="te-step-row">
                    <span>Available royalty pool</span>
                    <span>{penniesToPoundsString(computed.trackTotalPennies)}</span>
                  </div>
                </div>
              </div>

              <div className="te-trace-step">
                <div className="te-step-num">4</div>
                <div className="te-step-body">
                  <div className="te-step-title">Contributor Split Distribution</div>
                  <div className="te-step-row">
                    <span>Total distributed to contributors</span>
                    <span>{penniesToPoundsString(computed.trackTotalPennies)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="te-card">
            <h2 className="te-card-title">Contributor Splits</h2>
            <p className="te-muted">How earnings are distributed among all contributors.</p>

            <div className="te-table-wrap">
              <table className="te-table">
                <thead>
                  <tr>
                    <th>Contributor</th>
                    <th>Role</th>
                    <th>Split %</th>
                    <th>Earnings (£)</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.contributors || []).map((c) => (
                    <tr key={`${c.name}||${c.role}`}>
                      <td>
                        <div className="te-contrib">
                          <div className="te-avatar" aria-hidden="true">
                            <svg className="te-icon" viewBox="0 0 24 24" aria-hidden="true">
                              <circle cx="12" cy="8" r="4" />
                              <path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7" />
                            </svg>
                          </div>
                          <div>
                            <div className="te-contrib-name">
                              {c.name} {c.isYou ? <span className="te-you">You</span> : null}
                            </div>
                            {c.email ? <div className="te-muted te-small">{c.email}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td>{c.role}</td>
                      <td>{typeof c.sharePercent === "number" ? `${c.sharePercent.toFixed(1)}%` : `${c.sharePercent}%`}</td>
                      <td>{penniesToPoundsString(parsePennies(c.earningsPennies))}</td>
                    </tr>
                  ))}
                  {(data.contributors || []).length === 0 && (
                    <tr>
                      <td colSpan="4">No contributors found for this track.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
