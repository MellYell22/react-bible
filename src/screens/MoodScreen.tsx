import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { motion } from 'motion/react';
import { getMoodScriptures } from '../services/gemini';
import { MoodResponse } from '../types';
import { Sparkles, Search } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Profile } from '../types';

type ReadingMode = 'sanctuary' | 'parchment' | 'midnight';
type FontSize = 'small' | 'medium' | 'large';

const THEMES = {
  sanctuary: {
    bg: 'transparent',
    card: '#0f2a52',
    scripture: '#163d73',
    text: '#ffffff',
    accent: '#d4af37',
    muted: '#f5d77a',
    border: 'rgba(212, 175, 55, 0.3)',
  },
  parchment: {
    bg: '#f4f1ea',
    card: '#ffffff',
    scripture: '#fffcf5',
    text: '#2c2c2c',
    accent: '#8b4513',
    muted: '#5d4037',
    border: 'rgba(139, 69, 19, 0.2)',
  },
  midnight: {
    bg: '#000000',
    card: '#121212',
    scripture: '#1a1a1a',
    text: '#e0e0e0',
    accent: '#d4af37',
    muted: '#a0a0a0',
    border: 'rgba(255, 255, 255, 0.1)',
  }
};

const FONT_SIZES = {
  small: { verse: 16, ref: 12, exp: 12 },
  medium: { verse: 18, ref: 14, exp: 14 },
  large: { verse: 22, ref: 16, exp: 16 },
};

const MOODS = ['SAD', 'ANXIOUS', 'LONELY', 'GRATEFUL', 'ANGRY', 'HOPEFUL'];

export default function MoodScreen({ route, navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mood, setMood] = useState(route?.params?.mood || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MoodResponse | null>(null);
  
  const [readingMode, setReadingMode] = useState<ReadingMode>('sanctuary');
  const [fontSize, setFontSize] = useState<FontSize>('medium');

  const theme = THEMES[readingMode];
  const fonts = FONT_SIZES[fontSize];

  React.useEffect(() => {
    fetchProfile();
    if (route?.params?.mood) {
      handleInitialSearch(route.params.mood);
    }
  }, [route?.params?.mood]);

  const handleInitialSearch = async (initialMood: string) => {
    setLoading(true);
    try {
      // We need the profile for translation, but it might not be loaded yet
      // So we fetch it first if needed
      let currentProfile = profile;
      if (!currentProfile) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
          currentProfile = data;
          setProfile(data);
        }
      }
      const data = await getMoodScriptures(initialMood, currentProfile?.preferred_translation || 'KJV');
      setResult(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) setProfile(data);
    }
  };

  const handleSearch = async () => {
    const query = searchQuery || mood;
    if (!query) return;
    setLoading(true);
    setMood(query);
    try {
      const data = await getMoodScriptures(query, profile?.preferred_translation || 'KJV');
      setResult(data);
    } catch (error) {
      alert('Failed to fetch scriptures. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollView 
        style={styles.scrollView} 
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerContainer}>
          <Text style={[styles.title, { color: theme.accent, fontFamily: 'Playfair Display' }]}>
            {mood ? `Reflections on ${mood}` : 'How are you feeling?'}
          </Text>
        </View>

        <View style={styles.searchSection}>
          <View style={[styles.searchBar, { borderColor: theme.border }]}>
            <View style={styles.searchIconContainer}>
              <Search size={16} color={theme.accent} />
            </View>
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="I am feeling..."
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
            />
          </View>

          <View style={styles.moodPills}>
            {MOODS.map((m) => (
              <motion.div
                key={m}
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(212, 175, 55, 0.1)' }}
                whileTap={{ scale: 0.95 }}
                style={{ width: '48%', marginBottom: 8 }}
              >
                <TouchableOpacity 
                  style={[styles.moodPill, { borderColor: theme.border, width: '100%', marginBottom: 0 }]}
                  onPress={() => {
                    setSearchQuery('');
                    setMood(m);
                    handleInitialSearch(m);
                  }}
                >
                  <Text style={[styles.moodPillText, { color: theme.text }]}>{m}</Text>
                </TouchableOpacity>
              </motion.div>
            ))}
          </View>
        </View>

        {!mood && !loading && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: theme.muted }]}>
              Enter how you're feeling above or select a mood on the Home screen to see scriptures.
            </Text>
          </View>
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={[styles.loadingText, { color: theme.muted }]}>Seeking wisdom...</Text>
          </View>
        )}

        {result && !loading && (
          <View style={styles.resultContainer}>
            <View style={[styles.encouragementCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Sparkles color={theme.accent} size={20} style={{ marginBottom: 10 }} />
              <Text style={[styles.encouragementText, { color: theme.text, fontSize: fonts.verse - 2, fontFamily: 'Playfair Display' }]}>
                {result.encouragement}
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.muted }]}>Relevant Scriptures</Text>
            {result.scriptures.map((item, index) => (
              <View key={index} style={[styles.scriptureCard, { backgroundColor: theme.scripture, borderColor: theme.border }]}>
                <View style={styles.verseHeader}>
                  <View style={[styles.verseNumber, { backgroundColor: theme.accent }]}>
                    <Text style={styles.verseNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={[styles.referenceText, { color: theme.accent, fontSize: fonts.ref - 2, marginTop: 0 }]}>{item.reference}</Text>
                </View>
                
                <Text style={[styles.verseText, { color: theme.text, fontSize: fonts.verse - 2, textAlign: 'left', fontFamily: 'Playfair Display' }]}>
                  "{item.verse}"
                </Text>
                
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                
                <View style={styles.explanationContainer}>
                  <Text style={[styles.explanationLabel, { color: theme.accent }]}>Reflection</Text>
                  <Text style={[styles.explanationText, { color: theme.muted, fontSize: fonts.exp - 2, textAlign: 'left' }]}>
                    {item.explanation}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 30,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  searchSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  searchBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 20,
    paddingLeft: 15,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    marginBottom: 15,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    paddingLeft: 10,
  },
  searchIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchIcon: {
    padding: 6,
  },
  moodPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
  },
  moodPill: {
    backgroundColor: '#0b1e3d',
    width: '48%',
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
  },
  moodPillText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  loadingContainer: {
    marginTop: 50,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  resultContainer: {
    marginTop: 10,
  },
  encouragementCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 20,
    padding: 20,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  encouragementText: {
    lineHeight: 24,
    color: '#ffffff',
    fontWeight: '500',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#f5d77a',
    marginBottom: 15,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  scriptureCard: {
    backgroundColor: '#163d73',
    borderRadius: 20,
    padding: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  verseText: {
    lineHeight: 24,
    color: '#ffffff',
    fontStyle: 'italic',
  },
  referenceText: {
    fontWeight: 'bold',
    color: '#d4af37',
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    marginVertical: 15,
  },
  explanationText: {
    color: '#f5d77a',
    lineHeight: 18,
  },
  emptyState: {
    marginTop: 100,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 1,
  },
  verseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  verseNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  verseNumberText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: 'bold',
  },
  explanationContainer: {
    marginTop: 5,
  },
  explanationLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  }
});
