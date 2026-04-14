// API client
// - Centralizes frontend -> backend requests
// - Automatically attaches JWT for protected routes
// - Throws errors for non-OK responses

// ----- Utilities -----

function getToken() {
  return localStorage.getItem("token");
}

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  return res;
}

// ----- Public Endpoints -----

// Health check (no auth required)
export async function getHealth() {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

// Authenticate user and receive JWT
export async function login(email, password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Login failed");
  }
  return res.json();
}

// Create new user account
export async function registerUser({ email, password, displayName, role }) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName, role })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Registration failed");
  }
  return res.json();
}

// ----- Protected Endpoints -----

// Fetch currently authenticated user
export async function getMe() {
  const res = await authFetch("/api/auth/me");
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load user");
  }
  return res.json();
}

// Fetch tracks owned by a user (default: current user)
export async function getTracks(createdBy = "me") {
  const query = createdBy ? `?createdBy=${encodeURIComponent(createdBy)}` : "";
  const res = await authFetch(`/api/tracks${query}`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load tracks");
  }
  return res.json();
}

// Fetch tracks where the current user is listed as a contributor (by contributor_email) on ACTIVE splits
// or on a currently PENDING split-change proposal.
export async function getCollaborationTracks() {
  const res = await authFetch(`/api/tracks?collaborations=me`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load collaborations");
  }
  return res.json();
}

// Fetch royalty allocations for a given month
export async function getRoyaltiesAllocations(month, createdBy = "me") {
  if (!month) throw new Error("Month is required (YYYY-MM-01)");
  const res = await authFetch(
    `/api/royalties/allocations?month=${encodeURIComponent(month)}&createdBy=${encodeURIComponent(createdBy)}`
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load allocations");
  }
  return res.json();
}

// Fetch aggregated dashboard metrics for logged-in user
export async function getDashboardSummary() {
  const res = await authFetch("/api/dashboard/summary");
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load dashboard");
  }
  return res.json();
}

// Fetch listener impact metrics for a month.
export async function getListenerImpact(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  const res = await authFetch(`/api/listener/impact${query}`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load listener impact");
  }
  return res.json();
}

// Record a listener play session
export async function postPlayEvent(payload, options = {}) {
  const res = await authFetch("/api/play-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: Boolean(options.keepalive)
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to record play event");
  }
  return res.json();
}

// Fetch a creator-scoped earnings breakdown for a specific track.
export async function getTrackEarnings(trackId, month) {
  if (!trackId) throw new Error("trackId is required");
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  const res = await authFetch(`/api/tracks/${encodeURIComponent(trackId)}/earnings${query}`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load track earnings");
  }
  return res.json();
}

// Admin: run monthly royalty settlement.
export async function runRoyalties(monthStart) {
  if (!monthStart) throw new Error("monthStart is required (YYYY-MM-01)");
  const res = await authFetch(`/api/royalties/run?month=${encodeURIComponent(monthStart)}`, {
    method: "POST"
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to run royalties");
  }
  return res.json();
}

// Admin: fetch recent royalty runs.
export async function getAdminRoyaltyRuns(limit = 6) {
  const res = await authFetch(`/api/admin/royalties/runs?limit=${encodeURIComponent(limit)}`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load runs");
  }
  return res.json();
}

// Admin: generate/overwrite subscriptions for all users for a month.
export async function adminGenerateSubscriptions({ monthStart, amountPennies }) {
  if (!monthStart) throw new Error("monthStart is required (YYYY-MM-01)");
  if (!Number.isInteger(amountPennies) || amountPennies < 0) {
    throw new Error("amountPennies must be an integer >= 0");
  }

  const res = await authFetch("/api/admin/subscriptions/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthStart, amountPennies })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to generate subscriptions");
  }
  return res.json();
}

function getFilenameFromContentDisposition(headerValue) {
  if (!headerValue) return null;
  const m = /filename="?([^"]+)"?/i.exec(headerValue);
  return m ? m[1] : null;
}

// Export monthly royalty allocations as a CSV download.
export async function exportRoyaltiesCsv(monthStart, scope = "me") {
  if (!monthStart) throw new Error("Month is required (YYYY-MM-01)");
  const url = `/api/royalties/export?month=${encodeURIComponent(monthStart)}&scope=${encodeURIComponent(scope)}`;
  const res = await authFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to export CSV");
  }
  const blob = await res.blob();
  const filename = getFilenameFromContentDisposition(res.headers.get("content-disposition"))
    || `royalties_${monthStart}_${scope}.csv`;
  return { blob, filename };
}

// Export a single track's allocations for a month as CSV.
export async function exportTrackEarningsCsv(trackId, monthStart) {
  if (!trackId) throw new Error("trackId is required");
  if (!monthStart) throw new Error("monthStart is required (YYYY-MM-01)");
  const url = `/api/tracks/${encodeURIComponent(trackId)}/export?month=${encodeURIComponent(monthStart)}`;
  const res = await authFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to export track CSV");
  }
  const blob = await res.blob();
  const filename = getFilenameFromContentDisposition(res.headers.get("content-disposition"))
    || `track_${trackId}_${monthStart}.csv`;
  return { blob, filename };
}

// Split changes (UC3)
export async function getTrackSplits(trackId) {
  if (!trackId) throw new Error("trackId is required");
  const res = await authFetch(`/api/tracks/${encodeURIComponent(trackId)}/splits`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load track splits");
  }
  return res.json();
}

export async function proposeSplitChange(trackId, shares) {
  if (!trackId) throw new Error("trackId is required");
  const res = await authFetch(`/api/tracks/${encodeURIComponent(trackId)}/split-changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shares })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to propose split change");
  }
  return res.json();
}

export async function respondSplitChange(requestId, decision) {
  if (!requestId) throw new Error("requestId is required");
  const res = await authFetch(`/api/split-changes/${encodeURIComponent(requestId)}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to respond to split change");
  }
  return res.json();
}

export async function getSplitInbox() {
  const res = await authFetch("/api/split-changes/inbox");
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || "Failed to load approvals inbox");
  }
  return res.json();
}
