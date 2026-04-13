import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Home, Search, MessageCircle, Mic, User, Music, X } from 'lucide-react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { Profile } from './types';
import { AlertTriangle } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';

// Screens
import HomeScreen from './screens/HomeScreen';
import MoodScreen from './screens/MoodScreen';
import ChatScreen from './screens/ChatScreen';
import VoiceScreen from './screens/VoiceScreen';
import MusicScreen from './screens/MusicScreen';
import ProfileScreen from './screens/ProfileScreen';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';

import { Navbar } from './components/Navbar';
import { FullScreenBackground } from './components/FullScreenBackground';
import { Analytics } from "@vercel/analytics/react";
import { MusicProvider, useMusic } from './MusicContext';
import { MusicPlayer } from './components/MusicPlayer';
import { VerseOfTheDayModal } from './components/VerseOfTheDayModal';
import { getVerseOfTheDay } from './services/verseOfTheDay';
import { Scripture } from './types';

import { UserProvider, useUser } from './UserContext';

function AppContent() {
  const { session, profile, loading, refreshProfile } = useUser();
  const [currentRoute, setCurrentRoute] = useState('Home');
  const [routeParams, setRouteParams] = useState<any>(null);
  const [showVerseModal, setShowVerseModal] = useState(false);
  const [dailyVerse, setDailyVerse] = useState<Scripture | null>(null);
  const { currentSong, stopSong, nextSong, prevSong, setPlaybackError } = useMusic();

  useEffect(() => {
    // Handle initial route based on URL path
    const path = window.location.pathname;
    if (path === '/profile' || path === '/success' || path === '/cancel') {
      setCurrentRoute('Profile');
      if (path === '/success') {
        setRouteParams({ success: true });
      } else if (path === '/cancel') {
        setRouteParams({ canceled: true });
      }
    } else if (path === '/mood') {
      setCurrentRoute('Mood');
    } else if (path === '/chat') {
      setCurrentRoute('Chat');
    } else if (path === '/voice') {
      setCurrentRoute('Voice');
    }
  }, []);

  useEffect(() => {
    if (profile?.verse_of_the_day_enabled) {
      checkDailyVerse();
    }
  }, [profile]);

  const checkDailyVerse = async () => {
    if (!profile) return;

    const today = new Date().toISOString().split('T')[0];
    const lastShown = localStorage.getItem('last_verse_shown_date');
    
    if (lastShown === today) return;

    const now = new Date();
    const [hours, minutes] = (profile.verse_of_the_day_time || '08:00').split(':').map(Number);
    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    if (now >= scheduledTime) {
      try {
        const verse = await getVerseOfTheDay(profile.preferred_translation);
        setDailyVerse(verse);
        setShowVerseModal(true);
        localStorage.setItem('last_verse_shown_date', today);
      } catch (error) {
        console.error('Error fetching daily verse:', error);
      }
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <>
        <Analytics />
        <View style={styles.configErrorContainer}>
          <AlertTriangle color="#F59E0B" size={48} />
          <Text style={styles.configErrorTitle}>Configuration Required</Text>
          <Text style={styles.configErrorText}>
            Please set the following environment variables in the Secrets panel. 
            IMPORTANT: The URL must start with https://
          </Text>
          <View style={styles.configList}>
            <Text style={styles.configItem}>• VITE_SUPABASE_URL</Text>
            <Text style={styles.configItem}>• VITE_SUPABASE_ANON_KEY</Text>
          </View>
          <Text style={styles.configErrorHelp}>
            After adding these secrets, the app will refresh automatically.
          </Text>
        </View>
      </>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#d4af37" />
        <Text style={{ color: '#d4af37', marginTop: 20, letterSpacing: 2 }}>PREPARING SANCTUARY...</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <Analytics />
        <AuthScreen />
      </>
    );
  }

  if (profile && !profile.has_completed_onboarding) {
    return (
      <>
        <Analytics />
        <OnboardingScreen onComplete={refreshProfile} />
      </>
    );
  }

  const navigate = (name: string, params?: any) => {
    setCurrentRoute(name);
    setRouteParams(params);
  };

  const renderScreen = () => {
    const nav = { navigate };
    switch (currentRoute) {
      case 'Home': return <HomeScreen navigation={nav} />;
      case 'Mood': return <MoodScreen navigation={nav} route={{ params: routeParams }} />;
      case 'Chat': return <ChatScreen navigation={nav} />;
      case 'Voice': return <VoiceScreen navigation={nav} />;
      case 'Music': return <MusicScreen />;
      case 'Profile': return <ProfileScreen route={{ params: routeParams }} />;
      default: return <HomeScreen navigation={nav} />;
    }
  };

  const TabButton = ({ name, icon: Icon }: { name: string, icon: any }) => (
    <TouchableOpacity 
      style={styles.tabButton} 
      onPress={() => navigate(name)}
    >
      {currentRoute === name && <View style={styles.activeIndicator} />}
      <Icon 
        color={currentRoute === name ? '#d4af37' : 'rgba(255, 255, 255, 0.3)'} 
        size={22} 
      />
      <Text style={[
        styles.tabText, 
        { color: currentRoute === name ? '#d4af37' : 'rgba(255, 255, 255, 0.3)' }
      ]}>
        {name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Analytics />
      <Navbar onProfile={() => navigate('Profile')} />
      <FullScreenBackground>
        <View style={styles.screenContainer}>
          {renderScreen()}
        </View>
      </FullScreenBackground>

      <VerseOfTheDayModal 
        visible={showVerseModal} 
        onClose={() => setShowVerseModal(false)} 
        verse={dailyVerse} 
      />

      {currentSong && (
        <View style={styles.globalPlayerWrapper}>
          <TouchableOpacity style={styles.closePlayerButton} onPress={stopSong}>
            <X size={20} color="#ff4444" />
          </TouchableOpacity>
          <MusicPlayer 
            song={currentSong} 
            onNext={nextSong}
            onPrev={prevSong}
            onReady={() => setPlaybackError(null)}
            onError={(err) => setPlaybackError(err)}
          />
        </View>
      )}
      <View style={styles.tabBar}>
        <TabButton name="Home" icon={Home} />
        <TabButton name="Mood" icon={Search} />
        <TabButton name="Music" icon={Music} />
        <TabButton name="Chat" icon={MessageCircle} />
        <TabButton name="Voice" icon={Mic} />
        <TabButton name="Profile" icon={User} />
      </View>
      <Analytics />
    </View>
  );
}

export default function App() {
  return (
    <UserProvider>
      <MusicProvider>
        <AppContent />
      </MusicProvider>
    </UserProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1e3d',
  },
  screenContainer: {
    flex: 1,
    paddingTop: 60,
  },
  tabBar: {
    flexDirection: 'row',
    height: Platform.OS === 'ios' ? 90 : 70,
    backgroundColor: '#0b1e3d',
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.2)',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabText: {
    fontSize: 9,
    marginTop: 4,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    width: 20,
    height: 3,
    backgroundColor: '#d4af37',
    borderRadius: 2,
  },
  globalPlayerWrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 100 : 80,
    left: 10,
    right: 10,
    zIndex: 1000,
  },
  closePlayerButton: {
    position: 'absolute',
    top: -10,
    right: -10,
    zIndex: 1001,
    backgroundColor: '#0b1e3d',
    borderRadius: 15,
    padding: 5,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  configErrorContainer: {
    flex: 1,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  configErrorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400E',
    marginTop: 20,
    textAlign: 'center',
  },
  configErrorText: {
    fontSize: 16,
    color: '#B45309',
    marginTop: 15,
    textAlign: 'center',
    lineHeight: 24,
  },
  configList: {
    marginTop: 20,
    alignSelf: 'stretch',
    backgroundColor: '#FEF3C7',
    padding: 20,
    borderRadius: 12,
  },
  configItem: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#92400E',
    marginBottom: 5,
  },
  configErrorHelp: {
    fontSize: 12,
    color: '#D97706',
    marginTop: 30,
    textAlign: 'center',
  }
});
