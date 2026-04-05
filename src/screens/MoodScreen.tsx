import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, TextInput, Image } from 'react-native';
import { motion } from 'motion/react';
import { getMoodScriptures, generateSpeech } from '../services/gemini';

const MotionView = motion(View);
import { MoodResponse } from '../types';
import { Sparkles, Search, Volume2, Music, Play, Pause, Frown, Wind, User, Heart, Flame, Sun, HelpCircle, Layers, Cloud, X } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Profile } from '../types';
import { MOODS_DATA, MoodData } from '../constants/moods';
import { WORSHIP_SONGS, Song } from '../constants/songs';
import { MessageCircle } from 'lucide-react';
import { MusicProvider, useMusic } from '../MusicContext';
import { MusicPlayer } from '../components/MusicPlayer';
import { VideoGenerator } from '../components/VideoGenerator';
import { Video } from 'lucide-react';

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

export default function MoodScreen({ route, navigation }: any) {
  const { playSong, currentSong, isPlaying } = useMusic();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mood, setMood] = useState(route?.params?.mood || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MoodResponse | null>(null);
  const [testamentFilter, setTestamentFilter] = useState<'all' | 'old' | 'new'>('all');
  
  const [readingMode, setReadingMode] = useState<ReadingMode>('sanctuary');
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedVerseForVideo, setSelectedVerseForVideo] = useState<{ verse: string, reference: string } | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);

  const theme = THEMES[readingMode];
  const fonts = FONT_SIZES[fontSize];

  React.useEffect(() => {
    fetchProfile();
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
    try {
      const data = await getMoodScriptures(query, profile?.preferred_translation || 'KJV');
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
      const base64Audio = await generateSpeech(result.encouragement);
      if (base64Audio) {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const context = audioContextRef.current;
        if (context.state === 'suspended') {
          await context.resume();
        }

        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        const pcmData = new Int16Array(bytes.buffer.slice(0, bytes.buffer.byteLength - (bytes.buffer.byteLength % 2)));
        const float32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          float32Data[i] = pcmData[i] / 32768.0;
        }
        
        const audioBuffer = context.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);
        
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error("Speech error:", error);
      setIsSpeaking(false);
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
              <TouchableOpacity 
                style={[styles.chatButton, { borderColor: theme.accent }]}
                onPress={() => navigation.navigate('Voice', { mood: mood })}
              >
                <Text style={[styles.chatButtonText, { color: theme.accent }]}>CONTINUE WITH DAVID</Text>
              </TouchableOpacity>
            </View>

            {/* Mood-based Worship Recommendations */}
            <View style={styles.musicSection}>
              <View style={styles.musicHeader}>
                <Music size={16} color={theme.accent} />
                <Text style={[styles.musicTitle, { color: theme.accent }]}>Worship for this Mood</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.musicScroll}>
                {WORSHIP_SONGS.filter(s => s.moods.includes(mood.toUpperCase())).map((song) => (
                  <TouchableOpacity 
                    key={song.id} 
                    style={[
                      styles.musicCard, 
                      { backgroundColor: theme.card, borderColor: theme.border },
                      currentSong?.id === song.id && { borderColor: theme.accent, borderWidth: 2 }
                    ]}
                    onPress={() => playSong(song)}
                  >
                    <Image source={{ uri: song.coverUrl }} style={styles.musicCover} />
                    <View style={styles.musicCardDetails}>
                      <Text style={[styles.musicCardTitle, { color: theme.text }]} numberOfLines={1}>{song.title}</Text>
                      <Text style={[styles.musicCardArtist, { color: theme.muted }]} numberOfLines={1}>{song.artist}</Text>
                    </View>
                    <View style={[styles.musicPlayButton, { backgroundColor: theme.accent }]}>
                      {currentSong?.id === song.id && isPlaying ? (
                        <Pause size={12} color={readingMode === 'parchment' ? '#fff' : '#0b1e3d'} fill={readingMode === 'parchment' ? '#fff' : '#0b1e3d'} />
                      ) : (
                        <Play size={12} color={readingMode === 'parchment' ? '#fff' : '#0b1e3d'} fill={readingMode === 'parchment' ? '#fff' : '#0b1e3d'} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
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
            
            {selectedVerseForVideo && (
              <VideoGenerator 
                title={selectedVerseForVideo.reference}
                prompt={`A cinematic, inspiring, and spiritually grounded visual accompaniment for the Bible verse: "${selectedVerseForVideo.verse}". The mood is ${mood}. High quality, peaceful, and reverent.`}
                onClose={() => setSelectedVerseForVideo(null)}
              />
            )}

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
                      style={[styles.verseActionButton, { borderColor: theme.accent }]}
                      onPress={() => setSelectedVerseForVideo({ verse: item.verse, reference: item.reference })}
                    >
                      <Video size={14} color={theme.accent} />
                      <Text style={[styles.verseActionButtonText, { color: theme.accent }]}>GENERATE VISION</Text>
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
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
    justifyContent: 'center',
  },
  moodPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
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
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
  },
  filterText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#d4af37',
    letterSpacing: 1,
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
    marginTop: 15,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'center',
  },
  chatButtonText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
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
  musicSection: {
    marginBottom: 25,
  },
  musicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  musicTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  musicScroll: {
    flexDirection: 'row',
  },
  musicCard: {
    width: 160,
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  musicCover: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  musicCardDetails: {
    flex: 1,
    marginLeft: 10,
  },
  musicCardTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'Playfair Display',
  },
  musicCardArtist: {
    fontSize: 10,
    marginTop: 2,
  },
  musicPlayButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
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
