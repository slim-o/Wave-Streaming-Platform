import { useEffect, useMemo, useState } from "react";
import { getListenerImpact } from "../services/api.js";
import "./MyImpact.css";

export default function MyImpact() {
  const [data, setData] = useState(null);
  const [monthInput, setMonthInput] = useState(getCurrentMonth());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setErr("");
        setLoading(true);
        const month = `${monthInput}-01`;
        const res = await getListenerImpact(month);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load impact data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [monthInput]);

  const summary = useMemo(() => {
    const subscriptionPennies = Number(data?.subscriptionPennies || 0);
    const allocatedPennies = Number(data?.allocatedPennies || 0);
    const totalListeningMs = Number(data?.totalListeningMs || 0);
    return {
      subscriptionPennies,
      allocatedPennies,
      totalListeningHours: totalListeningMs / (1000 * 60 * 60),
      totalPlayEvents: Number(data?.totalPlayEvents || 0),
      distinctTracks: Number(data?.distinctTracks || 0)
    };
  }, [data]);

  return (
    <div className="mi-page">
      <div className="mi-header">
        <div>
          <h1 className="mi-title">My Impact</h1>
          <p className="mi-subtitle">Where your listening and subscription support goes.</p>
        </div>
        <div className="mi-controls">
          <label className="mi-label" htmlFor="impact-month">Month</label>
          <input
            id="impact-month"
            className="mi-input"
            type="month"
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
          />
        </div>
      </div>

      {err && <p className="mi-error">{err}</p>}

      <div className="mi-stats">
        <article className="mi-stat-card">
          <h3>Subscription</h3>
          <p>{formatMoney(summary.subscriptionPennies)}</p>
        </article>
        <article className="mi-stat-card">
          <h3>To Artists</h3>
          <p>{formatMoney(summary.allocatedPennies)}</p>
        </article>
        <article className="mi-stat-card">
          <h3>Listening Time</h3>
          <p>{summary.totalListeningHours.toFixed(1)} hrs</p>
        </article>
        <article className="mi-stat-card">
          <h3>Tracks Played</h3>
          <p>{summary.totalPlayEvents}</p>
          <small>{summary.distinctTracks} unique tracks</small>
        </article>
      </div>

      <div className="mi-grid">
        <section className="mi-card">
          <div className="mi-card-header">
            <h2>Top Tracks</h2>
          </div>
          {loading ? (
            <p>Loading...</p>
          ) : data?.topTracks?.length ? (
            <div className="mi-list">
              {data.topTracks.map((track, idx) => (
                <div key={track.trackId} className="mi-list-row">
                  <div className="mi-rank">{idx + 1}</div>
                  <div className="mi-item-main">
                    <div className="mi-item-title">{track.title}</div>
                    <div className="mi-item-sub">{track.primaryArtistName}</div>
                  </div>
                  <div className="mi-item-meta">
                    <div>{track.sharePercent}%</div>
                    <small>{formatMoney(Number(track.allocatedPennies || 0))}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No listening data for this month.</p>
          )}
        </section>

        <section className="mi-card">
          <div className="mi-card-header">
            <h2>Top Artist Support</h2>
          </div>
          {loading ? (
            <p>Loading...</p>
          ) : data?.topArtists?.length ? (
            <div className="mi-list">
              {data.topArtists.map((artist, idx) => (
                <div key={`${artist.name}-${idx}`} className="mi-list-row">
                  <div className="mi-rank">{idx + 1}</div>
                  <div className="mi-item-main">
                    <div className="mi-item-title">{artist.name}</div>
                    <div className="mi-item-sub">{artist.sharePercent}% of artist share</div>
                  </div>
                  <div className="mi-item-meta">
                    <div>{formatMoney(Number(artist.amountPennies || 0))}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p>No artist support data for this month.</p>
          )}
        </section>
      </div>

      <section className="mi-card">
        <div className="mi-card-header">
          <h2>Monthly Comparison</h2>
        </div>
        {loading ? (
          <p>Loading...</p>
        ) : data?.history?.length ? (
          <div className="mi-table-wrap">
            <table className="mi-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Subscription</th>
                  <th>To Artists</th>
                  <th>Listening Time</th>
                  <th>Tracks</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.monthStart}>
                    <td>{formatMonth(row.monthStart)}</td>
                    <td>{formatMoney(Number(row.subscriptionPennies || 0))}</td>
                    <td>{formatMoney(Number(row.allocatedPennies || 0))}</td>
                    <td>{(Number(row.listenedMs || 0) / (1000 * 60 * 60)).toFixed(1)} hrs</td>
                    <td>{row.distinctTracks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No monthly history found.</p>
        )}
      </section>
    </div>
  );
}

function getCurrentMonth() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function formatMonth(monthStart) {
  if (!monthStart) return "-";
  const d = new Date(monthStart);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function formatMoney(pennies) {
  const value = (Number(pennies || 0) / 100);
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}
