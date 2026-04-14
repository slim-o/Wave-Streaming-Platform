import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getSplitInbox, respondSplitChange } from "../services/api.js";

export default function Collaborators() {
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState([]);
  const [responding, setResponding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setErr("");
      const r = await getSplitInbox();
      setInbox(r.inbox || []);
    } catch (e) {
      setErr(e.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ maxWidth: 1100, padding: 24 }}>
      <h1>Collaborator Approvals</h1>
      <p style={{ color: "#64748b", marginTop: 6 }}>Pending split-change approvals requiring action.</p>

      {err && <p style={{ color: "#b91c1c" }}>{err}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : inbox.length === 0 ? (
        <p style={{ color: "#64748b" }}>No pending approvals.</p>
      ) : (
        <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Track</th>
                <th style={th}>Proposed By</th>
                <th style={th}>Created</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {inbox.map((i) => (
                <tr key={i.request_id}>
                  <td style={td}>
                    <Link to={`/tracks/${i.track_id}/splits`}>{i.track_title}</Link>
                  </td>
                  <td style={td}>{i.proposed_by_display_name || i.proposed_by_email || "-"}</td>
                  <td style={td}>{i.created_at ? new Date(i.created_at).toLocaleString() : ""}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      type="button"
                      disabled={responding}
                      style={btnOutline}
                      onClick={async () => {
                        setResponding(true);
                        try {
                          setErr("");
                          await respondSplitChange(i.request_id, "REJECTED");
                          await load();
                        } catch (e) {
                          setErr(e.message || "Failed to reject");
                        } finally {
                          setResponding(false);
                        }
                      }}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={responding}
                      style={btn}
                      onClick={async () => {
                        setResponding(true);
                        try {
                          setErr("");
                          await respondSplitChange(i.request_id, "APPROVED");
                          await load();
                        } catch (e) {
                          setErr(e.message || "Failed to approve");
                        } finally {
                          setResponding(false);
                        }
                      }}
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e2e8f0",
  color: "#334155"
};

const td = {
  padding: "10px 8px",
  borderBottom: "1px solid #eef2f7"
};

const btn = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #0f172a",
  background: "#0f172a",
  color: "#fff",
  cursor: "pointer",
  marginLeft: 8
};

const btnOutline = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  cursor: "pointer"
};
