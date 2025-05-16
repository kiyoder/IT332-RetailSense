import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext'; // Assuming AuthContext.jsx is in the same directory or adjust path

const PrivateRoute = ({ allowedRoles }) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // You might want to show a loading spinner here
    return <div>Authenticating...</div>;
  }

  if (!user) {
    // User not logged in, redirect to login page
    // Pass the current location so we can redirect back after login
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check for profile completion if the route requires it (e.g., not /profile/complete itself)
  if (profile && !profile.is_profile_complete && location.pathname !== '/profile/complete') {
    // If profile is not complete, redirect to the complete profile page
    // unless they are already trying to access it.
    return <Navigate to="/profile/complete" state={{ from: location }} replace />;
  }


  // Check if the route requires specific roles
  if (allowedRoles) {
    if (!profile || !profile.role) {
        // If roles are required but profile or role is missing, deny access
        // This could also be a redirect to login or an unauthorized page
        alert("You do not have the necessary profile information to access this page.");
        return <Navigate to="/login" state={{ from: location }} replace />;
    }
    if (!allowedRoles.includes(profile.role)) {
      // User does not have the required role, redirect to a generic page or show an unauthorized message
      // For example, redirect to dashboard or show a specific "Unauthorized" component
      alert("You are not authorized to access this page.");
      return <Navigate to="/dashboard" state={{ from: location }} replace />;
    }
  }

  // If all checks pass, render the child component
  return <Outlet />;
};

export default PrivateRoute;

