import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { Profile } from './types';

interface UserContextType {
  session: any;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
          setProfile(payload.new as Profile);
        }
      )
      .subscribe();

    return () => {
      supabase!.removeChannel(profileSubscription);
    };
  }, [session?.user?.id]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase!
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('[UserContext] Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (session?.user?.id) {
      setLoading(true);
      await fetchProfile(session.user.id);
    }
  };

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
