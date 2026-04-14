import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { getTrackSplits, proposeSplitChange, respondSplitChange } from "../services/api.js";
import "./TrackSplits.css";

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeTotal(shares) {
  return shares.reduce((sum, s) => sum + toNumber(s.sharePercent), 0);
}

function normalizeDraftShare(s) {
  return {
    name: String(s?.name || "").trim(),
    role: String(s?.role || "").trim() || "Artist",
    sharePercent: String(s?.sharePercent ?? ""),
    email: String(s?.email || "").trim()
  };
}

export default function TrackSplits() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [draftShares, setDraftShares] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [responding, setResponding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setErr("");
      const r = await getTrackSplits(id);
      setData(r);
    } catch (e) {
      setErr(e.message || "Failed to load splits");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canPropose = Boolean(data?.viewer?.isOwner || data?.viewer?.role === "ADMIN");
  const viewerEmail = (data?.viewer?.email || "").toLowerCase();

  const pending = data?.pending;
  const pendingApprovals = pending?.approvals || [];
  const isApprover = pendingApprovals.some((a) => String(a.approver_email || "").toLowerCase() === viewerEmail);
  const viewerApproval = pendingApprovals.find((a) => String(a.approver_email || "").toLowerCase() === viewerEmail) || null;
  const canRespond = Boolean(
    pending &&
    (
      data?.viewer?.role === "ADMIN" ||
      (isApprover && !viewerApproval?.decision)
    )
  );

  const draftTotal = useMemo(() => computeTotal(draftShares.map((s) => ({ sharePercent: s.sharePercent }))), [draftShares]);

  function openProposeModal() {
    const activeShares = (data?.active?.shares || []).map((s) => normalizeDraftShare({
      name: s.contributor_name,
      role: s.contributor_role,
      sharePercent: s.share_percent,
      email: s.contributor_email || ""
    }));
    setDraftShares(activeShares.length > 0 ? activeShares : [normalizeDraftShare({})]);
    setShowModal(true);
  }

  async function onSubmitProposal() {
    const shares = draftShares.map((s) => ({
      name: String(s.name || "").trim(),
      role: String(s.role || "").trim() || "Artist",
      sharePercent: Number(s.sharePercent),
      email: String(s.email || "").trim() || null
    }));

    if (shares.length === 0) {
      setErr("At least one share is required");
      return;
    }

    for (const s of shares) {
      if (!s.name) return setErr("Each share must have a contributor name");
      if (!Number.isFinite(s.sharePercent) || s.sharePercent < 0 || s.sharePercent > 100) {
        return setErr("Each share percent must be between 0 and 100");
      }
    }

    const total = shares.reduce((sum, s) => sum + s.sharePercent, 0);
    if (Math.abs(total - 100) > 0.0001) {
      setErr(`Split total must equal 100. Current total: ${total}`);
      return;
    }

    setSubmitting(true);
    try {
      setErr("");
      await proposeSplitChange(id, shares);
      setShowModal(false);
      await load();
    } catch (e) {
      setErr(e.message || "Failed to propose split change");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRespond(decision) {
    if (!pending?.requestId) return;
    setResponding(true);
    try {
      setErr("");
      await respondSplitChange(pending.requestId, decision);
      await load();
    } catch (e) {
      setErr(e.message || "Failed to respond");
    } finally {
      setResponding(false);
    }
  }

  return (
    <div className="ts-page">
      <div className="ts-header">
        <div>
          <Link className="ts-back" to="/tracks">
            &larr; Back to My Tracks
          </Link>
          <h1 className="ts-title">{data?.track?.title ? `Contributors & Splits - ${data.track.title}` : "Contributors & Splits"}</h1>
          <p className="ts-subtitle">Active shares and split-change approvals for this track.</p>
        </div>

        {canPropose && (
          <button className="ts-btn" type="button" onClick={openProposeModal} disabled={submitting || Boolean(pending)}>
            {pending ? "Split Change Pending" : "Propose Split Change"}
          </button>
        )}
      </div>

      <div className="ts-tabs" role="tablist" aria-label="Track navigation">
        <NavLink to=".." relative="path" className={({ isActive }) => (isActive ? "ts-tab active" : "ts-tab")}>
          Overview & Earnings
        </NavLink>
        <NavLink end to="." relative="path" className={({ isActive }) => (isActive ? "ts-tab active" : "ts-tab")}>
          Contributors & Splits
        </NavLink>
      </div>

      {loading && <p>Loading…</p>}
      {err && <p className="ts-error">{err}</p>}

      {!loading && !err && data && (
        <>
          <div className="ts-card">
            <div className="ts-card-title">Active Splits</div>
            <div className="ts-table-wrap">
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>Contributor</th>
                    <th>Role</th>
                    <th>Split %</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.active.shares || []).length === 0 ? (
                    <tr><td colSpan="4">No active split shares found.</td></tr>
                  ) : (
                    data.active.shares.map((s) => (
                      <tr key={`${s.contributor_name}||${s.contributor_role}||${s.contributor_email || ""}`}>
                        <td>{s.contributor_name}</td>
                        <td>{s.contributor_role}</td>
                        <td>{toNumber(s.share_percent).toFixed(2)}%</td>
                        <td>{s.contributor_email || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ts-card">
            <div className="ts-card-title">Split Change Status</div>
            {!pending ? (
              <p className="ts-muted">No pending split change request.</p>
            ) : (
              <>
                <div className="ts-status-row">
                  <span className="ts-badge pending">PENDING</span>
                  <span className="ts-muted">Request ID: {pending.requestId}</span>
                </div>

                <div className="ts-subsection">
                  <div className="ts-subtitle2">Proposed Shares</div>
                  <div className="ts-table-wrap">
                    <table className="ts-table">
                      <thead>
                        <tr>
                          <th>Contributor</th>
                          <th>Role</th>
                          <th>Split %</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(pending.shares || []).map((s) => (
                          <tr key={`${s.contributor_name}||${s.contributor_role}||${s.contributor_email || ""}`}>
                            <td>{s.contributor_name}</td>
                            <td>{s.contributor_role}</td>
                            <td>{toNumber(s.share_percent).toFixed(2)}%</td>
                            <td>{s.contributor_email || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="ts-subsection">
                  <div className="ts-subtitle2">Approvals</div>
                  <div className="ts-table-wrap">
                    <table className="ts-table">
                      <thead>
                        <tr>
                          <th>Approver Email</th>
                          <th>Decision</th>
                          <th>Decided At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingApprovals.length === 0 ? (
                          <tr><td colSpan="3">No approvers matched (contributors must have accounts).</td></tr>
                        ) : (
                          pendingApprovals.map((a) => (
                            <tr key={a.id}>
                              <td>{a.approver_email}</td>
                              <td>{a.decision || "PENDING"}</td>
                              <td>{a.decided_at ? new Date(a.decided_at).toLocaleString() : "-"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {canRespond && (
                    <div className="ts-actions">
                      <button className="ts-btn-outline" type="button" disabled={responding} onClick={() => onRespond("REJECTED")}>
                        Reject
                      </button>
                      <button className="ts-btn" type="button" disabled={responding} onClick={() => onRespond("APPROVED")}>
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {showModal && (
        <div className="ts-overlay" role="presentation" onClick={() => setShowModal(false)}>
          <div className="ts-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="ts-modal-head">
              <div>
                <div className="ts-modal-title">Propose Split Change</div>
                <div className="ts-muted">Total must equal 100%.</div>
              </div>
              <button className="ts-close" type="button" onClick={() => setShowModal(false)} aria-label="Close">x</button>
            </div>

            <div className="ts-modal-body">
              <div className="ts-total">
                <span>Total</span>
                <span className={Math.abs(draftTotal - 100) < 0.0001 ? "ts-ok" : "ts-bad"}>{draftTotal.toFixed(2)}%</span>
              </div>

              <div className="ts-rows">
                {draftShares.map((s, idx) => (
                  <div className="ts-row" key={idx}>
                    <input
                      className="ts-input"
                      placeholder="Name"
                      value={s.name}
                      onChange={(e) => {
                        const next = [...draftShares];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setDraftShares(next);
                      }}
                    />
                    <input
                      className="ts-input"
                      placeholder="Role"
                      value={s.role}
                      onChange={(e) => {
                        const next = [...draftShares];
                        next[idx] = { ...next[idx], role: e.target.value };
                        setDraftShares(next);
                      }}
                    />
                    <input
                      className="ts-input"
                      placeholder="Share %"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={s.sharePercent}
                      onChange={(e) => {
                        const next = [...draftShares];
                        next[idx] = { ...next[idx], sharePercent: e.target.value };
                        setDraftShares(next);
                      }}
                    />
                    <input
                      className="ts-input"
                      placeholder="Email (optional)"
                      value={s.email}
                      onChange={(e) => {
                        const next = [...draftShares];
                        next[idx] = { ...next[idx], email: e.target.value };
                        setDraftShares(next);
                      }}
                    />
                    <button
                      className="ts-mini"
                      type="button"
                      onClick={() => setDraftShares(draftShares.filter((_, i) => i !== idx))}
                      disabled={draftShares.length <= 1}
                      title="Remove"
                    >
                      -
                    </button>
                  </div>
                ))}
              </div>

              <div className="ts-modal-actions">
                <button className="ts-btn-outline" type="button" onClick={() => setDraftShares([...draftShares, normalizeDraftShare({})])}>
                  Add contributor
                </button>
                <button className="ts-btn" type="button" onClick={onSubmitProposal} disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit proposal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
