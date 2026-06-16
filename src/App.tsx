import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
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

function AppShell() {
  const { session, profile, loading } = useUser();
  const [route, setRoute] = useState<RouteState>({ name: 'Home' });

  const navigation = useMemo(() => ({
    navigate: (name: AppRoute, params?: Record<string, any>) => setRoute({ name, params }),
    goBack: () => setRoute({ name: 'Home' }),
  }), []);

  if (loading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color="#d4af37" size="large" />
        <Text style={styles.loadingText}>Opening Bible Mood Search...</Text>
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
      <View style={styles.screenWrap}>
        {route.name === 'Home' && <HomeScreen navigation={navigation} />}
        {route.name === 'Mood' && <MoodScreen {...screenProps} />}
        {route.name === 'Chat' && <ChatScreen {...screenProps} />}
        {route.name === 'Voice' && <VoiceScreen />}
        {route.name === 'Reflection' && <ReflectionScreen {...screenProps} />}
        {route.name === 'Bible' && <BibleBrowserScreen />}
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
    minHeight: Platform.OS === 'web' ? ('100vh' as any) : undefined,
    backgroundColor: '#0b1e3d',
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
