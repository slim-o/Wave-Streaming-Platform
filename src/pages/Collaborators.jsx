import { useEffect, useState } from "react";
import { getHealth } from "../services/api.js";

export default function Collaborators() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    getHealth()
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  return (
    <div>
      <h1>Collaborators</h1>
      {err && <p style={{ color: "red" }}>{err}</p>}
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p>Loading...</p>}
    </div>
  );
}