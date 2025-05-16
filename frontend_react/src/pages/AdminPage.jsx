import React from 'react';
import { useAuth } from '../AuthContext'; // Adjusted path
import { useNavigate } from 'react-router-dom';

const AdminPage = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to logout.');
    }
  };

  // This page should only be accessible if profile.role === 'admin'
  // PrivateRoute component should handle this, but an additional check here can be useful.
  if (profile?.role !== 'admin') {
    // Redirect to dashboard or show an unauthorized message
    // This is a fallback, PrivateRoute should be the primary guard
    navigate('/dashboard'); 
    return <div className="min-h-screen flex items-center justify-center bg-gray-100">Access Denied. Redirecting...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">
            Admin Panel
          </h1>
          <button
            onClick={handleLogout}
            className="ml-4 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Logout
          </button>
        </div>
      </header>
      <main>
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">
                Welcome to the Admin Area, {profile.first_name || profile.username}!
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                This is a restricted area for administrators only.
              </p>
              {/* Admin-specific content and tools would go here */}
              <div className="mt-4">
                <p className="text-gray-700">Admin functionalities (e.g., user management, site settings) would be implemented here.</p>
              </div>
               <div className="mt-6">
                <button 
                    onClick={() => navigate('/dashboard')}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline mr-2"
                >
                    Go to Dashboard
                </button>
            </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminPage;

