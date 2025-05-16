import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import PrivateRoute from './PrivateRoute';
import './index.css';
import Layout from "./components/layout.jsx";

import LoginPage from './pages/UserManagement/LoginPage.jsx';
import RegisterPage from "./pages/UserManagement/RegisterPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import ProfilePage from "./pages/UserManagement/ProfilePage.jsx";
import CompleteProfilePage from "./pages/UserManagement/CompleteProfilePage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import OverviewPage from "./pages/Dashboard/Main.jsx";
import HeatmapPage from "./pages/HeatmapGeneration/Heatmap.jsx";
import AnalyticsPage from "./pages/Dashboard/Analytics.jsx";
import ReportsPage from "./pages/ReportHistory/Reports.jsx";
import SettingsPage from "./pages/UserManagement/Settings.jsx";
import FloorplanPage from "./pages/HeatmapGeneration/Floorplan.jsx";


function AppContent() {
  const { loading } = useAuth();

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected Routes */}
      <Route element={<PrivateRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/complete" element={<CompleteProfilePage />} />
          <Route path="/heatmap" element={<HeatmapPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/floorplan" element={<FloorplanPage />} />
        </Route>
      </Route>

      {/* Admin Protected Route */}
      <Route element={<PrivateRoute allowedRoles={["admin"]} />}>
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      
      <Route path="/" element={<Navigate to="/overview" />} /> 
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;

