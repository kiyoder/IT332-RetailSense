import React, {createContext, useContext, useState, useEffect, useMemo, useCallback} from 'react';
import { createAuthApiClient} from "@/AuthApiClient.jsx";
import { supabase } from './supabaseClient'; // Ensure this path is correct

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true); // Unified loading state
  const [session, setSession] = useState(true);

  const apiClient = useMemo(() => {
    return createAuthApiClient(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    });
  }, []);

  const fetchUserProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      // console.log('AuthContext: fetchUserProfile - No userId provided, setting profile to null.');
      return null;
    }
    // console.log(`AuthContext: fetchUserProfile - TRYING for user ID: ${userId}`);
    try {
      const { data, error, status } = await supabase
          .from('profiles')
          .select('username, first_name, last_name, role, is_profile_complete')
          .eq('id', userId)
          .single();

      if (error && status !== 406) {
        // console.error('AuthContext: fetchUserProfile - Error fetching profile:', error.message);
        setProfile(null);
        return null;
      }
      // console.log('AuthContext: fetchUserProfile - Profile data fetched:', data);
      setProfile(data || null);
      return data || null;
    } catch (error) {
      // console.error('AuthContext: fetchUserProfile - CATCH - Exception fetching profile:', error.message);
      setProfile(null);
      return null;
    } finally {
      // console.log(`AuthContext: fetchUserProfile - FINALLY for user ID: ${userId}`);
    }
  }, []); // Empty dependency array: function reference is stable

  const getSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    return session;
  }, []); // Empty dependency array: function reference is stable

  useEffect(() => {
    let isMounted = true;
    // console.log('AuthContext: useEffect - Mounting and setting up auth listener.');
    setLoading(true); // Explicitly set loading to true when the effect runs

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (!isMounted) {
            // console.log('AuthContext: onAuthStateChange - Component unmounted, aborting.');
            return;
          }
          // console.log(`AuthContext: onAuthStateChange event: ${event}`, session);
          try {
            setUser(session?.user ?? null);
            if (session?.user) {
              // Fetch profile, but don't necessarily wait for it to set loading to false
              fetchUserProfile(session.user.id);
            } else {
              setProfile(null);
            }
          } catch (error) {
            // console.error("AuthContext: onAuthStateChange - CATCH - Error during state update or profile fetch:", error.message);
          } finally {
            if (isMounted) {
              // console.log('AuthContext: onAuthStateChange - FINALLY - Setting loading to false.');
              setLoading(false); // Set loading to false once auth state is known
            }
          }
        }
    );

    return () => {
      isMounted = false;
      if (authListener?.subscription) {
        authListener.subscription.unsubscribe();
        // console.log('AuthContext: useEffect cleanup - Unsubscribed from auth state changes.');
      }
    };
  }, []);

  const value = {
    user,
    profile,
    loading,
    session,
    apiClient,
    getSession,
    fetchProfile: fetchUserProfile,
    signIn: (options) => supabase.auth.signInWithPassword(options),
    signUp: (options) => supabase.auth.signUp(options),
    signOut: async () => {
      // console.log('AuthContext: signOut - Attempting to sign out.');
      setLoading(true);
      const { error } = await supabase.auth.signOut();
      setSession(null);
      // if (error) console.error("AuthContext: signOut - Sign out error:", error.message);
      // onAuthStateChange will handle setting user/profile to null and loading to false
      return { error };
    },
    signInWithGoogle: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
  };

  return (
      <AuthContext.Provider value={value}>
        {children}
      </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
