
UserContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { Profile } from './types';

interface UserContextType {
  session: any;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: (showLoading?: boolean) => Promise<Profile | null>;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Safety net: ensure loading screen eventually disappears
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        console.warn('[UserContext] Loading safety timeout reached (12s). Forcing app to initialize.');
        setLoading(false);
      }, 12000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase!.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription: authSubscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      authSubscription.unsubscribe();
    };
  }, []);

  // Real-time listener for profile changes
  useEffect(() => {
    if (!session?.user?.id || !isSupabaseConfigured) return;

    const profileSubscription = supabase!
      .channel(`public:profiles:id=eq.${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${session.user.id}`,
        },
        (payload) => {
          console.log('[UserContext] Profile changed in real-time:', payload.new);
          const updatedProfile = payload.new as Profile;
          if (updatedProfile && !updatedProfile.preferred_response_length) {
            updatedProfile.preferred_response_length = 'medium';
          }
          setProfile(updatedProfile);
        }
      )
      .subscribe();

    return () => {
      supabase!.removeChannel(profileSubscription);
    };
  }, [session?.user?.id]);

  const fetchProfile = async (userId: string, retries = 3): Promise<Profile | null> => {
    try {
      console.log(`[UserContext] Fetching profile for ${userId}... (${retries} retries left)`);

      // Force bypass cache for immediate read after webhook
      const { data, error } = await supabase!
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error(`[UserContext] Supabase profile fetch error:`, error);
        throw error;
      };

      if (!data) {
        if (retries > 0) {
          console.log(`[UserContext] Profile not found for ${userId}, retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return fetchProfile(userId, retries - 1);
        }
        console.error(`[UserContext] Profile not found after all retries for user ${userId}`);
        setProfile(null);
        setLoading(false);
        return null;
      }

      const profileData = data as Profile;
      console.log(`[UserContext] Profile fetched success. Tier: ${profileData.subscription_tier}`);

      if (profileData && !profileData.preferred_response_length) {
        profileData.preferred_response_length = 'medium';
      }

      setProfile(profileData);
      setLoading(false);
      return profileData;

    } catch (error) {
      console.error('[UserContext] Exception in fetchProfile:', error);
      if (retries === 0) {
        setLoading(false);
        return null;
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return fetchProfile(userId, retries - 1);
      }
    }
  };

  const refreshProfile = useCallback(async (showLoading = false): Promise<Profile | null> => {
    if (session?.user?.id) {
      console.log(`[UserContext] Profile refresh triggered (loading=${showLoading}) for user ${session.user.id}`);
      if (showLoading) setLoading(true);

      // Refresh session first to ensure we have current metadata/claims if any
      await supabase!.auth.refreshSession();

      // Fetch latest profile data from DB and return it directly
      return await fetchProfile(session.user.id, 0); // No retries on manual refresh to avoid blocking
    } else {
      console.warn('[UserContext] refreshProfile called but no active session user ID found');
      // Fallback check: maybe we need to get current user ID manually
      const { data: { user } } = await supabase!.auth.getUser();
      if (user) {
        console.log(`[UserContext] Found user via getUser fallback: ${user.id}`);
        return await fetchProfile(user.id, 0);
      } else {
        setLoading(false);
        return null;
      }
    }
  }, [session?.user?.id]);

  const signOut = async () => {
    await supabase!.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  return (
    <UserContext.Provider value={{ session, profile, loading, refreshProfile, signOut }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}