import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform, ActivityIndicator } from 'react-native';
import { Analytics } from '@vercel/analytics/react';
import { UserProvider, useUser } from './UserContext';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import HomeScreen from './screens/HomeScreen';
import MoodScreen from './screens/MoodScreen';
import ChatScreen from './screens/ChatScreen';
import VoiceScreen from './screens/VoiceScreen';
import ReflectionScreen from './screens/ReflectionScreen';
import BibleBrowserScreen from './screens/BibleBrowserScreen';
import ProfileScreen from './screens/ProfileScreen';

type AppRoute = 'Home' | 'Mood' | 'Chat' | 'Voice' | 'Reflection' | 'Bible' | 'Profile';

type RouteState = {
  name: AppRoute;
  params?: Record<string, any>;
};

const TEST_QUERY_KEYS = ['test', 'preview', 'app'];

function isHiddenTestMode() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  const hasQueryUnlock = TEST_QUERY_KEYS.some((key) => params.get(key) === '1' || params.get(key) === 'true');
  const hasPathUnlock = window.location.pathname.replace(/\/$/, '') === '/app';

  return hasQueryUnlock || hasPathUnlock;
}

function ComingSoonPage() {
  const openEmail = () => {
    Linking.openURL('mailto:aadesigns87@gmail.com?subject=Bible%20Mood%20Search%20Waitlist');
  };

  return (
    <View style={styles.page}>
      <Analytics />

      <View style={styles.backgroundGlowBlue} />
      <View style={styles.backgroundGlowRed} />

      <View style={styles.card}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>COMING SOON</Text>
        </View>

        <Text style={styles.title}>Bible Mood Search</Text>

        <Text style={styles.subtitle}>
          A faith-centered AI companion built to help you find Bible verses, reflection prompts, and encouragement based on your mood.
        </Text>

        <View style={styles.divider} />

        <Text style={styles.bodyText}>
          We are preparing something meaningful. The full experience is being polished now, and the public launch is on the way.
        </Text>

        <TouchableOpacity style={styles.button} onPress={openEmail} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Join the waitlist</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>Built with purpose. Launching soon.</Text>
      </View>
    </View>
  );
}

function TestAppShell() {
  const { session, profile, loading, signOut } = useUser();
  const [route, setRoute] = useState<RouteState>({ name: 'Home' });

  const navigation = useMemo(() => ({
    navigate: (name: AppRoute, params?: Record<string, any>) => setRoute({ name, params }),
    goBack: () => setRoute({ name: 'Home' }),
  }), []);

  if (loading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color="#d4af37" size="large" />
        <Text style={styles.loadingText}>Opening Bible Mood Search…</Text>
      </View>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (profile && !profile.has_completed_onboarding) {
    return <OnboardingScreen onComplete={() => setRoute({ name: 'Home' })} />;
  }

  const screenProps = { navigation, route: { name: route.name, params: route.params || {} } };

  return (
    <View style={styles.appShell}>
      <View style={styles.testBanner}>
        <Text style={styles.testBannerText}>PRIVATE TEST MODE</Text>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.screenWrap}>
        {route.name === 'Home' && <HomeScreen navigation={navigation} />}
        {route.name === 'Mood' && <MoodScreen {...screenProps} />}
        {route.name === 'Chat' && <ChatScreen {...screenProps} />}
        {route.name === 'Voice' && <VoiceScreen {...screenProps} />}
        {route.name === 'Reflection' && <ReflectionScreen {...screenProps} />}
        {route.name === 'Bible' && <BibleBrowserScreen {...screenProps} />}
        {route.name === 'Profile' && <ProfileScreen {...screenProps} />}
      </View>

      <View style={styles.tabBar}>
        {(['Home', 'Mood', 'Chat', 'Voice', 'Bible', 'Profile'] as AppRoute[]).map((item) => (
          <TouchableOpacity key={item} style={styles.tabButton} onPress={() => setRoute({ name: item })}>
            <Text style={[styles.tabText, route.name === item && styles.tabTextActive]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  if (!isHiddenTestMode()) {
    return <ComingSoonPage />;
  }

  return (
    <UserProvider>
      <Analytics />
      <TestAppShell />
    </UserProvider>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? '100vh' : undefined,
    backgroundColor: '#0B1E3D',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflow: 'hidden',
  },
  backgroundGlowBlue: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(30, 64, 175, 0.35)',
    top: -120,
    right: -120,
  },
  backgroundGlowRed: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(185, 28, 28, 0.3)',
    bottom: -110,
    left: -100,
  },
  card: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 32,
    padding: Platform.OS === 'web' ? 44 : 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  badge: {
    backgroundColor: '#B91C1C',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 22,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    color: '#0B1E3D',
    fontSize: Platform.OS === 'web' ? 64 : 46,
    lineHeight: Platform.OS === 'web' ? 72 : 52,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -1.5,
  },
  subtitle: {
    color: '#1F2937',
    fontSize: Platform.OS === 'web' ? 22 : 18,
    lineHeight: Platform.OS === 'web' ? 34 : 28,
    textAlign: 'center',
    marginTop: 20,
    maxWidth: 610,
    fontWeight: '500',
  },
  divider: {
    width: 88,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D4AF37',
    marginTop: 30,
    marginBottom: 28,
  },
  bodyText: {
    color: '#374151',
    fontSize: 17,
    lineHeight: 28,
    textAlign: 'center',
    maxWidth: 560,
  },
  button: {
    marginTop: 34,
    backgroundColor: '#0B1E3D',
    paddingHorizontal: 30,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#B91C1C',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  footerText: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  loadingPage: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? '100vh' : undefined,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: '#f5d77a',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  appShell: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? '100vh' : undefined,
    backgroundColor: '#0b1e3d',
  },
  testBanner: {
    backgroundColor: '#B91C1C',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  testBannerText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1.6,
  },
  signOutText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  screenWrap: {
    flex: 1,
    minHeight: 0,
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    backgroundColor: '#051020',
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.25)',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tabButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tabText: {
    color: 'rgba(245, 215, 122, 0.62)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tabTextActive: {
    color: '#d4af37',
  },
});
