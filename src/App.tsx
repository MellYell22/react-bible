import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Home, Search, MessageCircle, Mic, User } from 'lucide-react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { Profile } from './types';
import { AlertTriangle } from 'lucide-react';

// Screens
import HomeScreen from './screens/HomeScreen';
import MoodScreen from './screens/MoodScreen';
import ChatScreen from './screens/ChatScreen';
import VoiceScreen from './screens/VoiceScreen';
import ProfileScreen from './screens/ProfileScreen';
import AuthScreen from './screens/AuthScreen';
import OnboardingScreen from './screens/OnboardingScreen';

import { FullScreenBackground } from './components/FullScreenBackground';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentRoute, setCurrentRoute] = useState('Home');
  const [routeParams, setRouteParams] = useState<any>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    supabase!.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.user && isSupabaseConfigured) {
      fetchProfile();
    } else {
      setProfile(null);
    }
  }, [session]);

  const fetchProfile = async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    
    if (data) setProfile(data);
  };

  if (!isSupabaseConfigured) {
    return (
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
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (profile && !profile.has_completed_onboarding) {
    return <OnboardingScreen onComplete={fetchProfile} />;
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
      case 'Profile': return <ProfileScreen />;
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
      <FullScreenBackground>
        <View style={styles.screenContainer}>
          {renderScreen()}
        </View>
      </FullScreenBackground>
      
      <View style={styles.tabBar}>
        <TabButton name="Home" icon={Home} />
        <TabButton name="Mood" icon={Search} />
        <TabButton name="Chat" icon={MessageCircle} />
        <TabButton name="Voice" icon={Mic} />
        <TabButton name="Profile" icon={User} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1e3d',
  },
  screenContainer: {
    flex: 1,
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
