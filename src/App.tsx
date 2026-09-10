import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Analytics } from '@vercel/analytics/react';
import { initAnalytics, recordAppSession, trackEvent } from './services/analytics';
import { UserProvider, useUser } from './UserContext';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import MoodScreen from './screens/MoodScreen';
import ChatScreen from './screens/ChatScreen';
import VoiceScreen from './screens/VoiceScreen';
import ReflectionScreen from './screens/ReflectionScreen';
import BibleBrowserScreen from './screens/BibleBrowserScreen';
import ProfileScreen from './screens/ProfileScreen';
import PricingScreen from './screens/PricingScreen';
import AppNav from './components/AppNav';
import { APP_COLORS, APP_FONTS } from './designSystem';

type AppRoute = 'Home' | 'Mood' | 'Chat' | 'Voice' | 'Reflection' | 'Bible' | 'Profile' | 'Pricing';

type RouteState = {
  name: AppRoute;
  params?: Record<string, any>;
};

const getInitialRoute = (): RouteState => {
  if (typeof window === 'undefined') return { name: 'Mood' };

  const params = new URLSearchParams(window.location.search);
  const isStripeSuccess =
    params.get('success') === 'true' ||
    params.has('session_id') ||
    window.location.pathname.includes('payment-success');
  const isStripeCanceled =
    params.get('canceled') === 'true' ||
    params.get('showPricing') === 'true' ||
    window.location.pathname.includes('pricing');

  if (isStripeSuccess || isStripeCanceled) {
    return {
      name: 'Pricing',
      params: {
        success: isStripeSuccess,
        paymentSuccess: isStripeSuccess,
        canceled: isStripeCanceled,
        sessionId: params.get('session_id') || undefined,
      },
    };
  }

  return { name: 'Mood' };
};

function AppShell() {
  const { session, profile, loading, refreshProfile, signOut } = useUser();
  const [route, setRoute] = useState<RouteState>(() => getInitialRoute());
  const [onboardingCompletedLocally, setOnboardingCompletedLocally] = useState(false);
  const paidTracked = useRef(false);

  useEffect(() => {
    initAnalytics();
    if (paidTracked.current) return;
    if (route.name === 'Pricing' && route.params?.paymentSuccess) {
      paidTracked.current = true;
      trackEvent('checkout_completed');
    }
  }, [route.name, route.params?.paymentSuccess]);

  useEffect(() => {
    if (!loading) {
      recordAppSession(session?.user?.id);
    }
  }, [loading, session?.user?.id]);

  useEffect(() => {
    setOnboardingCompletedLocally(false);
  }, [session?.user?.id]);

  const navigation = useMemo(
    () => ({
      navigate: (name: AppRoute, params?: Record<string, any>) => setRoute({ name, params }),
      goBack: () => setRoute({ name: 'Mood' }),
      setParams: (params?: Record<string, any>) =>
        setRoute((current) => ({
          ...current,
          params: { ...(current.params || {}), ...(params || {}) },
        })),
    }),
    [],
  );

  if (loading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={APP_COLORS.gold} size="large" />
        <Text style={styles.loadingText}>Opening Bible Mood Search...</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View nativeID="auth-design-shell" style={styles.routeShell}>
        <AuthScreen />
      </View>
    );
  }

  if (profile && !profile.has_completed_onboarding && !onboardingCompletedLocally) {
    return (
      <OnboardingScreen
        onComplete={async () => {
          setOnboardingCompletedLocally(true);
          setRoute({ name: 'Mood' });
          try {
            await refreshProfile(false);
          } catch (error) {
            console.warn('[App] Onboarding was saved, but the refreshed profile was delayed:', error);
          }
        }}
      />
    );
  }

  const screenProps = { navigation, route: { name: route.name, params: route.params || {} } };

  return (
    <View style={styles.appShell}>
      <AppNav current={route.name} navigation={navigation} onLogout={() => void signOut()} />
      <View style={styles.screenWrap}>
        {(route.name === 'Home' || route.name === 'Mood') && (
          <View nativeID="mood-design-shell" style={styles.routeShell}>
            <MoodScreen {...screenProps} />
          </View>
        )}
        {route.name === 'Chat' && (
          <View nativeID="chat-design-shell" style={styles.routeShell}>
            <ChatScreen {...screenProps} />
          </View>
        )}
        {route.name === 'Voice' && (
          <View nativeID="voice-design-shell" style={styles.routeShell}>
            <VoiceScreen />
          </View>
        )}
        {route.name === 'Reflection' && (
          <View nativeID="reflection-design-shell" style={styles.routeShell}>
            <ReflectionScreen {...screenProps} />
          </View>
        )}
        {route.name === 'Bible' && (
          <View nativeID="bible-design-shell" style={styles.routeShell}>
            <BibleBrowserScreen />
          </View>
        )}
        {route.name === 'Profile' && (
          <View nativeID="profile-design-shell" style={styles.routeShell}>
            <ProfileScreen {...screenProps} />
          </View>
        )}
        {route.name === 'Pricing' && (
          <View nativeID="pricing-design-shell" style={styles.routeShell}>
            <PricingScreen {...screenProps} />
          </View>
        )}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <UserProvider>
      <Analytics />
      <AppShell />
    </UserProvider>
  );
}

const styles = StyleSheet.create({
  loadingPage: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? ('100vh' as any) : undefined,
    backgroundColor: APP_COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: APP_COLORS.goldSoft,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: APP_FONTS.serif,
  },
  appShell: {
    flex: 1,
    height: Platform.OS === 'web' ? ('100dvh' as any) : undefined,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: APP_COLORS.navy,
  },
  screenWrap: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: APP_COLORS.navy,
  },
  routeShell: {
    flex: 1,
    minHeight: 0,
    backgroundColor: APP_COLORS.navy,
  },
});
