import { useState } from 'react'
import CreatorLayout from "./layout/CreatorLayout.jsx";

import { Routes, Route, Link, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import MyTracks from "./pages/MyTracks.jsx";
import Analytics from "./pages/Analytics.jsx";
import Royalties from "./pages/Royalties.jsx";
import Collaborators from "./pages/Collaborators.jsx";
import Settings from "./pages/Settings.jsx";
import RegisterTrack from "./pages/RegisterTrack.jsx";
import Login from "./pages/Login.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import RequireRole from "./components/RequireRole.jsx";
import ListenerLayout from "./layout/ListenerLayout.jsx";
import ListenerHome from "./pages/ListenerHome.jsx";
import ListenerSearch from "./pages/ListenerSearch.jsx";
import ListenerLibrary from "./pages/ListenerLibrary.jsx";
import MyImpact from "./pages/MyImpact.jsx";
import TrackEarnings from "./pages/TrackEarnings.jsx";
import AdminRoyalties from "./pages/AdminRoyalties.jsx";
import TrackSplits from "./pages/TrackSplits.jsx";
//import MyImpact from "./pages/MyImpact.jsx";

//import './App.css'

function App() {
  return (

      <Routes>
      {/* will add login filter for creators / users later */}
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <RequireAuth>
          <RequireRole allowed={["CREATOR", "ADMIN"]}>
            <CreatorLayout />
          </RequireRole>
        </RequireAuth>
      }>
        <Route index element={<Dashboard />} />
        <Route path="tracks" element={<MyTracks />} />
        <Route path="tracks/new" element={<RegisterTrack />} />
        <Route path="tracks/:id" element={<TrackEarnings />} />
        <Route path="tracks/:id/splits" element={<TrackSplits />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="royalties" element={<Royalties />} />
        <Route path="admin/royalties" element={<AdminRoyalties />} />
        <Route path="collaborators" element={<Collaborators />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="/listener" element={
        <RequireAuth>
          <RequireRole allowed={["LISTENER", "ADMIN"]}>
            <ListenerLayout />
          </RequireRole>
        </RequireAuth>
      }>
        <Route index element={<ListenerHome />} />
        <Route path="search" element={<ListenerSearch />} />
        <Route path="library" element={<ListenerLibrary />} />
        <Route path="impact" element={<MyImpact />} />
      </Route>
    </Routes>
    
  )
}

export default App
