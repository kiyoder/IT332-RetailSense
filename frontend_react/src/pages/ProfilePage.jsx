import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext'; // Adjusted path
import { useNavigate } from 'react-router-dom';
import {supabase} from "../supabaseClient.js";

const ProfilePage = () => {
  const { user, profile, fetchProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || '');
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
    }
  }, [profile]);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!username || !firstName || !lastName) {
        setError('Username, First Name and Last Name are required.');
        setLoading(false);
        return;
    }

    try {
      // Assuming you have a supabase client instance available for direct updates
      // or an updateProfile function in AuthContext that handles this.
      // For this example, let's assume direct Supabase client usage or a dedicated function.
      // This part needs to be connected to Supabase update logic.
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({ username, first_name: firstName, last_name: lastName, is_profile_complete: true })
        .eq('id', user.id)
        .select()
        .single();

      if (updateError) {
        // Check for unique constraint violation for username
        if (updateError.message.includes('duplicate key value violates unique constraint "profiles_username_key"')) {
            throw new Error('Username already taken. Please choose another one.');
        } else {
            throw updateError;
        }
      }

      setSuccess('Profile updated successfully!');
      // Re-fetch profile to update context
      if (user) {
        await fetchProfile(user.id);
      }
    } catch (err) {
      setError(err.message || 'Failed to update profile.');
      console.error('Profile update error:', err);
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      setError('Failed to logout.');
      console.error('Logout error:', err);
    }
    setLoading(false);
  };

  if (!profile && !loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-100">Loading profile...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 py-12">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-lg">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Your Profile</h2>
        {error && <p className="bg-red-100 text-red-700 p-3 rounded mb-4 text-sm">{error}</p>}
        {success && <p className="bg-green-100 text-green-700 p-3 rounded mb-4 text-sm">{success}</p>}
        <form onSubmit={handleUpdateProfile}>
          <div className="mb-4">
            <label htmlFor="email_display" className="block text-sm font-medium text-gray-700 mb-1">Email (cannot be changed)</label>
            <input
              type="email"
              id="email_display"
              value={user?.email || ''}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-gray-500"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="your_username"
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
            {loading ? 'Updating...' : 'Update Profile'}
          </button>
        </form>
        <button
            onClick={handleLogout}
            disabled={loading}
            className="mt-4 w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? 'Logging out...' : 'Logout'}
          </button>
      </div>
    </div>
  );
};

export default ProfilePage;

