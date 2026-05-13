import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, TextInput } from 'react-native';
import { motion } from 'motion/react';
import { getMoodScriptures, generateSpeech } from '../services/ai';

const MotionView = motion(View);
import { MoodResponse } from '../types';
import { Sparkles, Search, Volume2, Frown, Wind, User, Heart, Flame, Sun, HelpCircle, Layers, Cloud, X, ThumbsUp, ThumbsDown, Bookmark, Check } from 'lucide-react';
import { supabase, saveAIFeedback, saveScripture } from '../services/supabase';
import { Profile } from '../types';
import { MOODS_DATA, MoodData } from '../constants/moods';
import { MessageCircle } from 'lucide-react';

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

const MOOD_CONFIG = [
  { key: 'ANXIOUS', label: 'Anxious', icon: Wind },
  { key: 'SAD', label: 'Sad', icon: Frown },
  { key: 'LONELY', label: 'Lonely', icon: User },
  { key: 'STRESSED', label: 'Stressed', icon: Wind },
  { key: 'OVERWHELMED', label: 'Overwhelmed', icon: Layers },
  { key: 'HOPEFUL', label: 'Hopeful', icon: Sun },
  { key: 'GRATEFUL', label: 'Grateful', icon: Heart },
  { key: 'ANGRY', label: 'Angry', icon: Flame },
  { key: 'CONFUSED', label: 'Confused', icon: HelpCircle },
  { key: 'JOYFUL', label: 'Joyful', icon: Sun },
  { key: 'PEACEFUL', label: 'Peaceful', icon: Cloud },
];

const NT_BOOKS = [
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 
  'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', 
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', 
  '1 John', '2 John', '3 John', 'Jude', 'Revelation'
];

import { useUser } from '../UserContext';

export default function MoodScreen({ route, navigation }: any) {
  const { profile } = useUser();
  const [mood, setMood] = useState(route?.params?.mood || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MoodResponse | null>(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [testamentFilter, setTestamentFilter] = useState<'all' | 'old' | 'new'>('all');
  
  const [readingMode, setReadingMode] = useState<ReadingMode>('sanctuary');
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [savingId, setSavingId] = useState<number | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);

  const theme = THEMES[readingMode];
  const fonts = FONT_SIZES[fontSize];

  React.useEffect(() => {
    if (route?.params?.mood) {
      handleInitialSearch(route.params.mood);
    }
  }, [route?.params?.mood]);

  const handleInitialSearch = async (initialMood: string) => {
    // Check if it's a predefined mood
    const staticMood = MOODS_DATA.find(m => m.key === initialMood.toUpperCase());
    
    if (staticMood) {
      setResult({
        scriptures: staticMood.scriptures.map(s => ({ ...s, explanation: 'Reflecting on God\'s word for your heart today.' })),
        encouragement: `I see you're feeling ${staticMood.label.toLowerCase()}. Remember that God is with you in every emotion.`
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await getMoodScriptures(
        initialMood, 
        profile?.preferred_translation || 'KJV',
        profile?.preferred_response_length || 'medium'
      );
      setResult(data);
      setFeedback(null);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    const query = (searchQuery || mood).trim();
    if (!query) return;

    // Check if it's a predefined mood
    const staticMood = MOODS_DATA.find(m => m.label.toLowerCase() === query.toLowerCase() || m.key === query.toUpperCase());
    if (staticMood) {
      setMood(staticMood.key);
      setResult({
        scriptures: staticMood.scriptures.map(s => ({ ...s, explanation: 'Reflecting on God\'s word for your heart today.' })),
        encouragement: `I see you're feeling ${staticMood.label.toLowerCase()}. Remember that God is with you in every emotion.`
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setMood(query);
    setTestamentFilter('all');
    setFeedback(null);
    try {
      const data = await getMoodScriptures(
        query, 
        profile?.preferred_translation || 'KJV',
        profile?.preferred_response_length || 'medium'
      );
      setResult(data);
    } catch (error) {
      alert('Failed to fetch scriptures. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredScriptures = result?.scriptures.filter(item => {
    if (testamentFilter === 'all') return true;
    const bookName = item.reference.split(' ')[0];
    // Handle cases like "1 Samuel" or "Song of Solomon"
    const fullBookName = item.reference.match(/^[1-3]?\s?[a-zA-Z\s]+(?=\s\d)/)?.[0] || bookName;
    const isNT = NT_BOOKS.includes(fullBookName.trim());
    return testamentFilter === 'new' ? isNT : !isNT;
  }) || [];

  const speakEncouragement = async () => {
    if (!result || isSpeaking) return;
    
    setIsSpeaking(true);
    try {
      // generateSpeech returns a blob URL — use HTML Audio directly (NOT base64/AudioContext)
      const audioUrl = await generateSpeech(result.encouragement);
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          console.error('[MoodScreen] Audio playback error');
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err: any) => {
            console.error('[MoodScreen] audio.play() blocked:', err?.message);
            setIsSpeaking(false);
          });
        }
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error("Speech error:", error);
      setIsSpeaking(false);
    }
  };

  const handleFeedback = async (type: 'up' | 'down') => {
    if (!result || !profile) return;
    
    const isHelpful = type === 'up';
    setFeedback(type);
    
    await saveAIFeedback(profile.id, 'mood', result.encouragement, isHelpful);
  };

  const handleSave = async (item: any, index: number) => {
    if (!profile || savingId !== null || savedIds.has(index)) return;
    
    setSavingId(index);
    try {
      await saveScripture(
        profile.id, 
        item, 
        profile.preferred_translation || 'KJV',
        mood || 'Search'
      );
      setSavedIds(prev => new Set(prev).add(index));
    } catch (error) {
      console.error('Error saving scripture:', error);
    } finally {
      setSavingId(null);
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
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <X size={14} color={theme.muted} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.moodPills}>
            {MOOD_CONFIG.map((m) => (
              <MotionView
                key={m.key}
                whileHover={{ scale: 1.02, backgroundColor: 'rgba(212, 175, 55, 0.05)' }}
                whileTap={{ scale: 0.98 }}
                style={{ width: '31%', marginBottom: 10 }}
              >
                <TouchableOpacity 
                  style={[
                    styles.moodPill, 
                    { 
                      borderColor: mood === m.key ? theme.accent : theme.border, 
                      width: '100%', 
                      marginBottom: 0,
                      backgroundColor: mood === m.key ? 'rgba(212, 175, 55, 0.1)' : 'transparent'
                    }
                  ]}
                  onPress={() => {
                    setSearchQuery('');
                    setMood(m.key);
                    handleInitialSearch(m.key);
                  }}
                >
                  <m.icon size={18} color={mood === m.key ? theme.accent : theme.muted} style={{ marginBottom: 6 }} />
                  <Text style={[styles.moodPillText, { color: mood === m.key ? theme.accent : theme.text }]}>{m.label}</Text>
                </TouchableOpacity>
              </MotionView>
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
          </View>
        )}

        {result && !loading && (
          <View style={styles.resultContainer}>
            <View style={[styles.encouragementCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Sparkles color={theme.accent} size={20} />
                  <Text style={{ color: theme.accent, fontSize: 10, fontWeight: 'bold', letterSpacing: 1 }}>DAVID'S GUIDANCE</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 15 }}>
                  <TouchableOpacity onPress={speakEncouragement} disabled={isSpeaking}>
                    {isSpeaking ? (
                      <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                      <Volume2 color={theme.accent} size={20} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => navigation.navigate('Voice', { mood: mood })}>
                    <MessageCircle color={theme.accent} size={20} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={[styles.encouragementText, { color: theme.text, fontSize: fonts.verse - 2, fontFamily: 'Playfair Display' }]}>
                {result.encouragement}
              </Text>
              
              <View style={styles.feedbackContainer}>
                <Text style={[styles.feedbackLabel, { color: theme.muted }]}>Was this helpful?</Text>
                <View style={styles.feedbackButtons}>
                  <TouchableOpacity 
                    onPress={() => handleFeedback('up')}
                    style={[styles.feedbackButton, feedback === 'up' && { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}
                  >
                    <ThumbsUp size={16} color={feedback === 'up' ? '#10B981' : theme.muted} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => handleFeedback('down')}
                    style={[styles.feedbackButton, feedback === 'down' && { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}
                  >
                    <ThumbsDown size={16} color={feedback === 'down' ? '#ef4444' : theme.muted} />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.chatButton, { borderColor: theme.accent }]}
                onPress={() => navigation.navigate('Voice', { mood: mood })}
              >
                <Text style={[styles.chatButtonText, { color: theme.accent }]}>CONTINUE WITH DAVID</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.filterContainer}>
              <TouchableOpacity 
                style={[styles.filterPill, testamentFilter === 'all' && { backgroundColor: theme.accent }]}
                onPress={() => setTestamentFilter('all')}
              >
                <Text style={[styles.filterText, testamentFilter === 'all' && { color: '#fff' }]}>ALL</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.filterPill, testamentFilter === 'old' && { backgroundColor: theme.accent }]}
                onPress={() => setTestamentFilter('old')}
              >
                <Text style={[styles.filterText, testamentFilter === 'old' && { color: '#fff' }]}>OLD TESTAMENT</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.filterPill, testamentFilter === 'new' && { backgroundColor: theme.accent }]}
                onPress={() => setTestamentFilter('new')}
              >
                <Text style={[styles.filterText, testamentFilter === 'new' && { color: '#fff' }]}>NEW TESTAMENT</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.muted }]}>
              {testamentFilter === 'all' ? 'Relevant Scriptures' : 
               testamentFilter === 'old' ? 'Old Testament Wisdom' : 'New Testament Hope'}
            </Text>


            {filteredScriptures.length === 0 ? (
              <View style={styles.noResults}>
                <Text style={[styles.noResultsText, { color: theme.muted }]}>
                  No scriptures found in this testament for your search.
                </Text>
              </View>
            ) : (
              filteredScriptures.map((item, index) => (
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
                  
                  <View style={styles.verseActions}>
                    <TouchableOpacity 
                      style={[styles.verseActionButton, { borderColor: theme.accent }, savedIds.has(index) && { opacity: 0.7 }]}
                      onPress={() => handleSave(item, index)}
                      disabled={savingId === index || savedIds.has(index)}
                    >
                      {savingId === index ? (
                        <ActivityIndicator size="small" color={theme.accent} />
                      ) : savedIds.has(index) ? (
                        <Check size={14} color="#10B981" />
                      ) : (
                        <Bookmark size={14} color={theme.accent} />
                      )}
                      <Text style={[styles.verseActionButtonText, { color: savedIds.has(index) ? '#10B981' : theme.accent }]}>
                        {savedIds.has(index) ? 'SAVED' : 'SAVE VERSE'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.explanationContainer}>
                    <Text style={[styles.explanationLabel, { color: theme.accent }]}>Reflection</Text>
                    <Text style={[styles.explanationText, { color: theme.muted, fontSize: fonts.exp - 2, textAlign: 'left' }]}>
                      {item.explanation}
                    </Text>
                  </View>
                </View>
              ))
            )}
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
    padding: 16,
    paddingTop: 40,
    paddingBottom: 24,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  searchSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  searchBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 18,
    paddingLeft: 13,
    paddingRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    height: 36,
    color: '#ffffff',
    fontSize: 13,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    paddingLeft: 8,
  },
  searchIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButton: {
    padding: 8,
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
    width: '31%',
    paddingVertical: 10,
    borderRadius: 14,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
    justifyContent: 'center',
  },
  moodPillText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.4,
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
    marginTop: 8,
  },
  encouragementCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  encouragementText: {
    lineHeight: 22,
    color: '#ffffff',
    fontWeight: '500',
    textAlign: 'center',
    fontStyle: 'italic',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#f5d77a',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  scriptureCard: {
    backgroundColor: '#163d73',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  verseText: {
    lineHeight: 22,
    color: '#ffffff',
    fontStyle: 'italic',
    fontSize: 14,
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
    fontSize: 13,
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
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
  },
  filterText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#d4af37',
    letterSpacing: 0.8,
  },
  noResults: {
    padding: 40,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  chatButton: {
    marginTop: 12,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'center',
  },
  chatButtonText: {
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 0.8,
  },
  feedbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  feedbackLabel: {
    fontSize: 9,
    fontStyle: 'italic',
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  feedbackButton: {
    padding: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  verseActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 15,
  },
  verseActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  verseActionButtonText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  floatingPlayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: '#0b1e3d',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.3)',
  },
  closePlayer: {
    alignItems: 'center',
    paddingVertical: 8,
    marginTop: 5,
  },
  closePlayerText: {
    color: '#d4af37',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  }
});
