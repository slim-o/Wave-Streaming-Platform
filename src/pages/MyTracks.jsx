import { useEffect, useState } from "react";
import { Routes, Route, Link, useNavigate  } from "react-router-dom";
import { getHealth } from "../services/api.js";

export default function MyTracks() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  let navigate = useNavigate();

  useEffect(() => {
    getHealth()
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div>
      <h1>My Tracks</h1>

      <button onClick={() => navigate("/tracks/new")}>Upload New Track</button>
      
      {err && <p style={{ color: "red" }}>{err}</p>}
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p>Loading...</p>}

      
    </div>
  );
}