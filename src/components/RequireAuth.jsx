import { Navigate, useLocation } from "react-router-dom";

// Route guard: redirects to /login if no JWT is present
export default function RequireAuth({ children }) {
  const token = localStorage.getItem("token");
  const location = useLocation();

  // Preserve intended route so user can be redirected back after login
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
