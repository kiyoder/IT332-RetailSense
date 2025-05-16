import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext.jsx'; // Adjusted path
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient.js'; // Import supabase client

const CompleteProfilePage = () => {
  const { user, profile, fetchProfile } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // If the profile is already complete, redirect to dashboard
    if (profile?.is_profile_complete) {
      navigate('/dashboard');
    }
    // Pre-fill if some data exists but profile is not complete
    if (profile) {
        setUsername(profile.username || '');
        setFirstName(profile.first_name || '');
        setLastName(profile.last_name || '');
    }
  }, [profile, navigate]);

  const handleCompleteProfile = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!username || !firstName || !lastName) {
      setError('All fields (Username, First Name, Last Name) are required.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          username,
          first_name: firstName,
          last_name: lastName,
          is_profile_complete: true,
        })
        .eq('id', user.id)
        .select()
        .single();

      if (updateError) {
        if (updateError.message.includes('duplicate key value violates unique constraint "profiles_username_key"')) {
            throw new Error('Username already taken. Please choose another one.');
        } else {
            throw updateError;
        }
      }

      setSuccess('Profile completed successfully! Redirecting...');
      await fetchProfile(user.id); // Re-fetch profile to update context
      setTimeout(() => navigate('/dashboard'), 2000); // Redirect after a short delay

    } catch (err) {
      setError(err.message || 'Failed to complete profile.');
      console.error('Profile completion error:', err);
    }
    setLoading(false);
  };

  if (!user) {
    // Should be handled by PrivateRoute, but as a fallback
    navigate('/login');
    return null;
  }
  
  // Show loading if profile is being fetched initially by AuthContext
  // or if profile is null and user exists (edge case, should be handled by AuthContext redirect)
  if (profile === undefined) { // AuthContext loading state might be more reliable here
      return <div className="min-h-screen flex items-center justify-center bg-gray-100">Loading user data...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 py-12">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-lg">
        <h2 className="text-2xl font-bold mb-2 text-center text-gray-800">Complete Your Profile</h2>
        <p className="text-sm text-gray-600 mb-6 text-center">Welcome! Please complete your profile to continue.</p>
        {error && <p className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</p>}
        {success && <p className="bg-green-100 text-green-700 p-3 rounded mb-4 text-sm">{success}</p>}
        <form onSubmit={handleCompleteProfile}>
          <div className="mb-4">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Your Username"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
            <input
              type="text"
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Your First Name"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
            <input
              type="text"
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Your Last Name"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Complete Profile'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CompleteProfilePage;

