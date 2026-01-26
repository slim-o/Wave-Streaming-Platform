import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import { Routes, Route, Link } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import RegisterTrack from "./pages/RegisterTrack.jsx";
import Royalties from "./pages/Royalties.jsx";
import MyImpact from "./pages/MyImpact.jsx";
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>

      <nav style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Link to="/">Dashboard</Link>
        <Link to="/register-track">Register Track</Link>
        <Link to="/royalties">Royalties</Link>
        <Link to="/my-impact">My Impact</Link>
      </nav>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/register-track" element={<RegisterTrack />} />
        <Route path="/royalties" element={<Royalties />} />
        <Route path="/my-impact" element={<MyImpact />} />
      </Routes>
      

      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.jsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
