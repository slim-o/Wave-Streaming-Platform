import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, registerUser } from "../services/api.js";
import "./Login.css";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("CREATOR");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      let res;
      if (mode === "login") {
        res = await login(email, password);
      } else {
        res = await registerUser({ email, password, displayName, role });
      }
      localStorage.setItem("token", res.token);
      navigate("/", { replace: true });
    } catch (e2) {
      setErr(e2.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lg-page">
      <div className="lg-card">
        <div className="lg-header">
          <h1 className="lg-title">{mode === "login" ? "Login" : "Create Account"}</h1>
          <p className="lg-subtitle">Wave creator access</p>
        </div>

        <div className="lg-tabs">
          <button
            className={mode === "login" ? "lg-tab active" : "lg-tab"}
            onClick={() => setMode("login")}
            type="button"
          >
            Login
          </button>
          <button
            className={mode === "register" ? "lg-tab active" : "lg-tab"}
            onClick={() => setMode("register")}
            type="button"
          >
            Register
          </button>
        </div>

        {err && <p className="lg-error">{err}</p>}

        <form className="lg-form" onSubmit={onSubmit}>
          {mode === "register" && (
            <>
              <label className="lg-label">
                Display name
                <input
                  className="lg-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Artist Studio"
                />
              </label>
              <label className="lg-label">
                Role
                <select className="lg-input" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="CREATOR">CREATOR</option>
                  <option value="LISTENER">LISTENER</option>
                </select>
              </label>
            </>
          )}

          <label className="lg-label">
            Email
            <input
              className="lg-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="you@example.com"
            />
          </label>

          <label className="lg-label">
            Password
            <input
              className="lg-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>

          <button className="lg-btn" type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
