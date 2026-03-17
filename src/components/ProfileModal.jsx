import { useEffect } from "react";
import "./profileModal.css";

export default function ProfileModal({ open, onClose, user, onLogout }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const displayName = user?.display_name || "User";
  const email = user?.email || "No email available";

  return (
    <div className="pm-overlay" role="presentation" onClick={onClose}>
      <div
        className="pm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pm-header">
          <h2>Profile</h2>
          <button className="pm-close" type="button" aria-label="Close profile modal" onClick={onClose}>
            x
          </button>
        </div>

        <div className="pm-user">
          <div className="pm-avatar">
            <svg className="pm-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7" />
            </svg>
          </div>
          <div>
            <div className="pm-name">{displayName}</div>
            <div className="pm-email">{email}</div>
          </div>
        </div>

        <p className="pm-note">
          Profile image is currently a generic icon. Image upload can be added in a later sprint.
        </p>

        <div className="pm-actions">
          <button className="pm-logout" type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
