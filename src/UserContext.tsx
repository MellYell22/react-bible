import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { Profile } from './types';

interface UserContextType {
  session: any;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: (showLoading?: boolean) => Promise<Profile | null>;
  continueAsGuest: (preferredTranslation?: Profile['preferred_translation']) => void;
  signOut: () => Promise<void>;
}

const PROFILE_FETCH_TIMEOUT_MS = 4500;
const PROFILE_RETRY_DELAY_MS = 750;

const createGuestSession = () => ({
  user: {
    id: 'guest',
    email: 'guest@mybibleaicompanion.local',
    app_metadata: {},
    user_metadata: { name: 'Guest' },
    aud: 'authenticated',
    role: 'authenticated',
  },
});

const createGuestProfile = (preferredTranslation: Profile['preferred_translation'] = 'NIV'): Profile => ({
  id: 'guest',
  email: 'guest@mybibleaicompanion.local',
  subscription_tier: 'free',
  created_at: new Date().toISOString(),
  has_completed_onboarding: true,
  preferred_translation: preferredTranslation,
  preferred_response_length: 'medium',
  verse_of_the_day_enabled: false,
  verse_of_the_day_time: '08:00',
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Guest deep links -----------------------------------------------------
// Paid and shared traffic should land on the mood picker, not on a password
// form. A link such as https://www.mybibleaicompanion.com/?guest=1 (or /start)
// opens the app directly in guest mode.
const GUEST_LINK_PARAMS = ['guest', 'try', 'start'];
const GUEST_LINK_PATHS = /^\/(start|try)\/?$/i;

// Stripe sends people back with these; those trips need the real session and
// must never be downgraded to a guest session.
const hasStripeReturnParams = (params: URLSearchParams, pathname: string) =>
  params.get('success') === 'true' ||
  params.has('session_id') ||
  params.get('canceled') === 'true' ||
  params.get('showPricing') === 'true' ||
  pathname.includes('payment-success') ||
  pathname.includes('pricing');

const isTruthyParam = (value: string | null) =>
  value !== null && value !== '0' && value.toLowerCase() !== 'false';

/**
 * Returns true when this page load came from a guest deep link, and clears the
 * marker from the address bar so a later refresh or sign-up is not pinned to
 * guest mode. Safe to call once per load.
 */
const consumeGuestLinkIntent = (): boolean => {
  if (typeof window === 'undefined') return false;

  const { search, pathname, hash } = window.location;
  const params = new URLSearchParams(search);

  if (hasStripeReturnParams(params, pathname)) return false;

  const matchedParam = GUEST_LINK_PARAMS.some((key) => isTruthyParam(params.get(key)));
  const matchedPath = GUEST_LINK_PATHS.test(pathname);
  if (!matchedParam && !matchedPath) return false;

  try {
    GUEST_LINK_PARAMS.forEach((key) => params.delete(key));
    const nextSearch = params.toString();
    window.history.replaceState(
      {},
      '',
      `${matchedPath ? '/' : pathname}${nextSearch ? `?${nextSearch}` : ''}${hash || ''}`,
    );
  } catch {
    // Tidying the address bar is cosmetic — never block entry on it.
  }

  return true;
};

const withProfileTimeout = async <T,>(promise: Promise<T>, timeoutMs = PROFILE_FETCH_TIMEOUT_MS): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Profile fetch timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileFetchInFlightRef = useRef<Promise<Profile | null> | null>(null);
  // A guest session exists only in memory. Supabase still emits INITIAL_SESSION
  // with a null session on subscribe, which would otherwise evict the guest we
  // just let in via a deep link or the "continue as guest" button.
  const guestModeRef = useRef(false);

  // Safety net: ensure loading screen eventually disappears
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        console.warn('[UserContext] Loading safety timeout reached (8s). Forcing app to initialize.');
        setLoading(false);
      }, 8000); 
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const continueAsGuest = useCallback((preferredTranslation: Profile['preferred_translation'] = 'NIV') => {
    guestModeRef.current = true;
    setSession(createGuestSession());
    setProfile(createGuestProfile(preferredTranslation));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // No backend configured: a guest link should still open the app.
      if (consumeGuestLinkIntent()) continueAsGuest();
      setLoading(false);
      return;
    }

    // Get initial session
    supabase!.auth.getSession().then(({ data: { session } }) => {
      // A real signed-in session always wins over a guest deep link.
      if (!session && consumeGuestLinkIntent()) {
        continueAsGuest();
        return;
      }
      setSession(session);
      // Unblock UI immediately — profile loads in background (voice must not wait)
      setLoading(false);
      if (session?.user) {
        void fetchProfile(session.user.id);
      }
    });

    // Listen for auth changes
    const { data: { subscription: authSubscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      // "No Supabase user" is the normal state for a guest — ignore it rather
      // than throwing them back to the sign-in wall.
      if (!session && guestModeRef.current) return;

      guestModeRef.current = false;
      setSession(session);
      setLoading(false);
      if (session?.user) {
        void fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      authSubscription.unsubscribe();
    };
  }, []);

  // Real-time listener for profile changes
  useEffect(() => {
    if (!session?.user?.id || session.user.id === 'guest' || !isSupabaseConfigured) return;

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
          console.log(`[UserContext] Profile not found for ${userId}, retrying in ${PROFILE_RETRY_DELAY_MS}ms...`);
          await wait(PROFILE_RETRY_DELAY_MS);
          return withProfileTimeout(fetchProfile(userId, retries - 1));
        }
        console.error(`[UserContext] Profile not found after all retries for user ${userId}`);
        setProfile(null);
        return null;
      }

      const profileData = data as Profile;
      console.log(`[UserContext] Profile fetched success. Tier: ${profileData.subscription_tier}`);
      
      if (profileData && !profileData.preferred_response_length) {
        profileData.preferred_response_length = 'medium';
      }
      
      setProfile(profileData);
      return profileData;
      
    } catch (error) {
      console.error('[UserContext] Exception in fetchProfile:', error);
      if (retries === 0) {
        return null;
      } else {
        await wait(PROFILE_RETRY_DELAY_MS);
        return withProfileTimeout(fetchProfile(userId, retries - 1));
      }
    }
  };

  const refreshProfile = useCallback(async (showLoading = false): Promise<Profile | null> => {
    if (session?.user?.id) {
      console.log(`[UserContext] Profile refresh triggered (loading=${showLoading}) for user ${session.user.id}`);
      if (profileFetchInFlightRef.current && !showLoading) {
        return profileFetchInFlightRef.current;
      }
      if (showLoading) setLoading(true);
      
      // Refresh session first to ensure we have current metadata/claims if any
      await supabase!.auth.refreshSession();
      
      try {
        const request = withProfileTimeout(fetchProfile(session.user.id, 0));
        profileFetchInFlightRef.current = request;
        return await request;
      } finally {
        if (profileFetchInFlightRef.current) profileFetchInFlightRef.current = null;
        if (showLoading) setLoading(false);
      }
    } else {
      console.warn('[UserContext] refreshProfile called but no active session user ID found');
      // Fallback check: maybe we need to get current user ID manually
      const { data: { user } } = await supabase!.auth.getUser();
      if (user) {
        console.log(`[UserContext] Found user via getUser fallback: ${user.id}`);
        if (showLoading) setLoading(true);
        try {
          const request = withProfileTimeout(fetchProfile(user.id, 0));
          profileFetchInFlightRef.current = request;
          return await request;
        } finally {
          if (profileFetchInFlightRef.current) profileFetchInFlightRef.current = null;
          if (showLoading) setLoading(false);
        }
      }
      return null;
    }
  }, [session?.user?.id]);

  const signOut = async () => {
    try {
      if (session?.user?.id && session.user.id !== 'guest' && supabase) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) console.warn('[UserContext] Supabase sign out warning:', error.message);
      }
    } finally {
      guestModeRef.current = false;
      profileFetchInFlightRef.current = null;
      setSession(null);
      setProfile(null);
      setLoading(false);
    }
  };

  return (
    <UserContext.Provider value={{ session, profile, loading, refreshProfile, continueAsGuest, signOut }}>
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