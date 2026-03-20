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
