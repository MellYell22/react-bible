import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { motion } from 'motion/react';
import { supabase } from '../services/supabase';

const MotionView = motion(View);
import { Profile, Scripture } from '../types';
import { Search, Globe, Sparkles, Frown, Wind, User, Heart, Flame, Sun, HelpCircle, Layers, Zap, Video, Mic, Bookmark, Check } from 'lucide-react';
import { OWNER_EMAIL } from '../utils/tier';
import { getVerseReflection } from '../services/gemini';
import { getVerseOfTheDay } from '../services/verseOfTheDay';
import { VideoGenerator } from '../components/VideoGenerator';
import { saveScripture } from '../services/supabase';

const MOOD_CONFIG = [
  { key: 'ANXIOUS', label: 'Anxious', icon: Wind },
  { key: 'SAD', label: 'Sad', icon: Frown },
  { key: 'LONELY', label: 'Lonely', icon: User },
  { key: 'STRESSED', label: 'Stressed', icon: Zap },
  { key: 'OVERWHELMED', label: 'Overwhelmed', icon: Layers },
  { key: 'HOPEFUL', label: 'Hopeful', icon: Sun },
  { key: 'GRATEFUL', label: 'Grateful', icon: Heart },
  { key: 'ANGRY', label: 'Angry', icon: Flame },
  { key: 'CONFUSED', label: 'Confused', icon: HelpCircle },
];
const TRANSLATIONS = ['NIV', 'KJV', 'NLT', 'ESV', 'NKJV', 'CSB'];

import { useUser } from '../UserContext';

export default function HomeScreen({ navigation }: any) {
  const { profile } = useUser();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTranslations, setShowTranslations] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [loadingReflection, setLoadingReflection] = useState(false);
  const [showVideoGenerator, setShowVideoGenerator] = useState(false);
  const [dailyVerse, setDailyVerse] = useState<Scripture | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDailyVerse();
    setRefreshing(false);
  };

  const fetchDailyVerse = async () => {
    try {
      const verse = await getVerseOfTheDay(profile?.preferred_translation || 'KJV');
      setDailyVerse(verse);
      setHasSaved(false);
    } catch (error) {
      console.error('Error fetching daily verse:', error);
    }
  };

  const handleSave = async () => {
    if (!profile || !dailyVerse || isSaving || hasSaved) return;
    
    setIsSaving(true);
    try {
      await saveScripture(
        profile.id, 
        dailyVerse, 
        profile.preferred_translation || 'KJV',
        'Daily Verse'
      );
      setHasSaved(true);
    } catch (error) {
      console.error('Error saving scripture:', error);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    fetchDailyVerse();
  }, [profile?.preferred_translation]);

  const handleTranslationSelect = async (t: string) => {
    if (!profile) return;
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_translation: t })
      .eq('id', profile.id);
    if (!error) {
      setShowTranslations(false);
    }
  };

  const handleReflect = async () => {
    setLoadingReflection(true);
    try {
      const verse = dailyVerse?.verse || "Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty.";
      const ref = dailyVerse?.reference || "Psalm 91:1";
      const text = await getVerseReflection(verse, ref);
      setReflection(text);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingReflection(false);
    }
  };

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigation.navigate('Mood', { mood: searchQuery });
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Search Section */}
        <View style={styles.searchSection}>
          <View style={styles.heroHeader}>
            <Text style={styles.mainTitle}>Bible Mood Search</Text>
            <View style={styles.titleUnderline} />
          </View>
          
          <View style={styles.versionRow}>
            <Text style={styles.headerLabel}>SELECT TRANSLATION</Text>
            <TouchableOpacity 
              style={styles.translationSelector}
              onPress={() => setShowTranslations(!showTranslations)}
            ><Globe size={12} color="#d4af37" /><Text style={styles.translationText}>{profile?.preferred_translation || 'KJV'}</Text><Text style={styles.dropdownArrow}>▼</Text></TouchableOpacity>
            
            {showTranslations && (
              <View style={styles.translationDropdown}>
                <ScrollView style={{ maxHeight: 200 }}>
                  {TRANSLATIONS.map(t => (
                    <TouchableOpacity 
                      key={t} 
                      style={styles.dropdownItem}
                      onPress={() => handleTranslationSelect(t)}
                    >
                      <Text style={[
                        styles.dropdownText,
                        profile?.preferred_translation === t && styles.dropdownTextActive
                      ]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          <View style={styles.searchBar}>
            <View style={styles.searchIconContainer}>
              <Search size={16} color="#d4af37" />
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="I am feeling..."
              placeholderTextColor="rgba(255, 255, 255, 0.6)"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
            />
          </View>
          <View style={styles.moodPills}>
            {MOOD_CONFIG.map((m) => (
              <MotionView
                key={m.key}
                whileHover={{ scale: 1.02, backgroundColor: 'rgba(212, 175, 55, 0.05)' }}
                whileTap={{ scale: 0.98 }}
                style={{ width: '31.5%', marginBottom: 12 }}
              >
                <TouchableOpacity 
                  style={[styles.moodPill, { width: '100%', marginBottom: 0 }]}
                  onPress={() => navigation.navigate('Mood', { mood: m.key })}
                >
                  <m.icon size={16} color="#d4af37" style={{ marginBottom: 4 }} />
                  <Text style={styles.moodPillText}>{m.label}</Text>
                </TouchableOpacity>
              </MotionView>
            ))}
          </View>
        </View>
        <View style={styles.verseCard}>
          <Text style={styles.verseLabel}>VERSE OF THE DAY</Text>
          <Text style={styles.verseText}>
            {dailyVerse?.verse || "Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty."}
          </Text>
          <Text style={styles.verseReference}>— {dailyVerse?.reference || "PSALM 91:1"}</Text>
          
          <View style={styles.verseActions}>
            <TouchableOpacity 
              style={[styles.saveButton, hasSaved && styles.saveButtonActive]} 
              onPress={handleSave}
              disabled={isSaving || hasSaved}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#0b1e3d" />
              ) : hasSaved ? (
                <View style={styles.saveButtonContent}>
                  <Check size={14} color="#10B981" style={{ marginRight: 6 }} />
                  <Text style={[styles.saveButtonText, { color: '#10B981' }]}>SAVED</Text>
                </View>
              ) : (
                <View style={styles.saveButtonContent}>
                  <Bookmark size={14} color="#0b1e3d" style={{ marginRight: 6 }} />
                  <Text style={styles.saveButtonText}>SAVE TO MY LIST</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {showVideoGenerator ? (
            <VideoGenerator 
              title={dailyVerse?.reference || "Psalm 91:1"}
              prompt={`A cinematic, inspiring, and spiritually grounded visual accompaniment for the Bible verse: '${dailyVerse?.verse || "Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty."}' (${dailyVerse?.reference || "Psalm 91:1"}). High quality, peaceful, and reverent.`}
              onClose={() => setShowVideoGenerator(false)}
            />
          ) : (
            <TouchableOpacity 
              style={[styles.reflectionButton, { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#d4af37', marginBottom: 12 }]} 
              onPress={() => setShowVideoGenerator(true)}
            >
              <View style={styles.reflectionButtonContent}>
                <Video size={14} color="#d4af37" style={{ marginRight: 8 }} />
                <Text style={[styles.reflectionText, { color: '#d4af37' }]}>
                  GENERATE VISION
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {reflection ? (
            <MotionView
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ width: '100%' }}
            >
              <View style={styles.reflectionContainer}>
                <View style={styles.reflectionHeader}>
                  <Sparkles size={16} color="#d4af37" />
                  <Text style={styles.reflectionTitle}>DAVID'S REFLECTION</Text>
                </View>
                <Text style={styles.reflectionBody}>{reflection}</Text>
                <TouchableOpacity onPress={() => setReflection(null)} style={styles.closeReflection}>
                  <Text style={styles.closeReflectionText}>CLOSE</Text>
                </TouchableOpacity>
              </View>
            </MotionView>
          ) : (
            <TouchableOpacity 
              style={styles.reflectionButton} 
              onPress={handleReflect}
              disabled={loadingReflection}
            >
              <View style={styles.reflectionButtonContent}>
                <Sparkles size={14} color="#0b1e3d" style={{ marginRight: 8 }} />
                <Text style={styles.reflectionText}>
                  {"TAP FOR DAVID'S REFLECTION"}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Proactive Voice Card */}
        <MotionView
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          style={styles.voiceProactiveCard}
        >
          <View style={styles.voiceCardContent}>
            <View style={styles.voiceIconContainer}>
              <Mic size={24} color="#d4af37" />
            </View>
            <View style={styles.voiceTextContainer}>
              <Text style={styles.voiceCardTitle}>Want to talk?</Text>
              <Text style={styles.voiceCardSubtitle}>David is ready to listen and encourage you in real-time.</Text>
            </View>
            <TouchableOpacity 
              style={styles.voiceStartButton}
              onPress={() => navigation.navigate('Voice')}
            >
              <Text style={styles.voiceStartButtonText}>START VOICE</Text>
            </TouchableOpacity>
          </View>
        </MotionView>
        <View style={styles.footer}>
          {profile?.email === OWNER_EMAIL && (
            <Text style={styles.ownerBadge}>OWNER ACCOUNT</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  heroHeader: {
    alignItems: 'center',
    marginBottom: 8,
    width: '100%',
  },
  titleUnderline: {
    width: 40,
    height: 2,
    backgroundColor: '#d4af37',
    marginTop: 6,
    opacity: 0.5,
  },
  versionRow: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
    zIndex: 1000,
  },
  headerLabel: {
    fontSize: 8,
    color: 'rgba(212, 175, 55, 0.6)',
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  translationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  translationText: {
    color: '#d4af37',
    fontSize: 12,
    fontWeight: 'bold',
    marginHorizontal: 8,
    letterSpacing: 1,
  },
  dropdownArrow: {
    color: '#d4af37',
    fontSize: 8,
    opacity: 0.7,
  },
  translationDropdown: {
    position: 'absolute',
    top: 65,
    backgroundColor: '#0f2a52',
    borderRadius: 15,
    padding: 8,
    borderWidth: 1,
    borderColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
    width: 120,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.05)',
  },
  dropdownText: {
    color: 'rgba(212, 175, 55, 0.6)',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 1,
  },
  dropdownTextActive: {
    color: '#d4af37',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 10,
    paddingBottom: 20,
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%',
  },
  searchSection: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 0,
  },
  mainTitle: {
    fontSize: 26,
    color: '#d4af37',
    fontFamily: 'Playfair Display',
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  searchBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 25,
    paddingLeft: 14,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    marginBottom: 20,
    height: 46,
  },
  searchInput: {
    flex: 1,
    height: 46,
    color: '#ffffff',
    fontSize: 15,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    paddingLeft: 10,
  },
  searchIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  moodPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
  },
  moodPill: {
    backgroundColor: '#0b1e3d',
    paddingVertical: 12,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  moodPillText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  verseCard: {
    backgroundColor: '#0b1e3d',
    marginHorizontal: 20,
    borderRadius: 20,
    paddingVertical: 30,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 15,
    marginTop: 24,
  },
  verseLabel: {
    color: '#d4af37',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 16,
    opacity: 0.8,
  },
  verseText: {
    fontSize: 18,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 16,
  },
  verseReference: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 16,
  },
  verseActions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 12,
  },
  saveButton: {
    backgroundColor: '#d4af37',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 140,
    alignItems: 'center',
  },
  saveButtonActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderWidth: 1,
    borderColor: '#d4af37',
  },
  saveButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#0b1e3d',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  reflectionButton: {
    backgroundColor: '#d4af37',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  reflectionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reflectionText: {
    color: '#0b1e3d',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  reflectionContainer: {
    marginTop: 10,
    padding: 25,
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    width: '100%',
  },
  reflectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  reflectionTitle: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginLeft: 10,
  },
  reflectionBody: {
    color: '#f5d77a',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
  },
  closeReflection: {
    marginTop: 20,
    padding: 5,
  },
  closeReflectionText: {
    color: 'rgba(212, 175, 55, 0.4)',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  footer: {
    marginTop: 40,
    alignItems: 'center',
    paddingBottom: 20,
  },
  footerText: {
    color: 'rgba(212, 175, 55, 0.2)',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 3,
  },
  ownerBadge: {
    color: '#d4af37',
    fontSize: 7,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginTop: 8,
    textTransform: 'uppercase',
    opacity: 0.4,
  },
  voiceProactiveCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#0f2a52',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  voiceCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voiceIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  voiceTextContainer: {
    flex: 1,
  },
  voiceCardTitle: {
    color: '#d4af37',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Playfair Display',
  },
  voiceCardSubtitle: {
    color: '#f5d77a',
    fontSize: 11,
    opacity: 0.8,
    marginTop: 2,
  },
  voiceStartButton: {
    backgroundColor: '#d4af37',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 15,
  },
  voiceStartButtonText: {
    color: '#0b1e3d',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
