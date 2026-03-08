import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { motion } from 'motion/react';
import { supabase } from '../services/supabase';
import { Profile } from '../types';
import { Search, Globe, Sparkles } from 'lucide-react';
import { OWNER_EMAIL } from '../utils/tier';
import { getVerseReflection } from '../services/gemini';

const MOODS = ['SAD', 'ANXIOUS', 'LONELY', 'GRATEFUL', 'ANGRY', 'HOPEFUL'];
const TRANSLATIONS = ['NIV', 'KJV', 'NLT', 'ESV', 'NKJV', 'CSB'];

export default function HomeScreen({ navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTranslations, setShowTranslations] = useState(false);
  const [reflection, setReflection] = useState<string | null>(null);
  const [loadingReflection, setLoadingReflection] = useState(false);

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

  useEffect(() => {
    fetchProfile();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  const handleTranslationSelect = async (t: string) => {
    if (!profile) return;
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_translation: t })
      .eq('id', profile.id);
    if (!error) {
      setProfile({ ...profile, preferred_translation: t as any });
      setShowTranslations(false);
    }
  };

  const handleReflect = async () => {
    setLoadingReflection(true);
    try {
      const verse = "Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty.";
      const ref = "Psalm 91:1";
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
          <View style={styles.headerRow}>
            <View style={styles.titleContainer}>
              <Text style={styles.mainTitle}>Bible Mood Search</Text>
            </View>
            
            <View style={styles.versionContainer}>
              <Text style={styles.headerLabel}>VERSION</Text>
              <TouchableOpacity 
                style={styles.translationSelector}
                onPress={() => setShowTranslations(!showTranslations)}
              >
                <Globe size={10} color="#d4af37" />
                <Text style={styles.translationText}>{profile?.preferred_translation || 'KJV'}</Text>
              </TouchableOpacity>
              
              {showTranslations && (
                <View style={styles.translationDropdown}>
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
                </View>
              )}
            </View>
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
            {MOODS.map((mood) => (
              <motion.div
                key={mood}
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(212, 175, 55, 0.1)' }}
                whileTap={{ scale: 0.95 }}
                style={{ width: '48%', marginBottom: 8 }}
              >
                <TouchableOpacity 
                  style={[styles.moodPill, { width: '100%', marginBottom: 0 }]}
                  onPress={() => navigation.navigate('Mood', { mood })}
                >
                  <Text style={styles.moodPillText}>{mood}</Text>
                </TouchableOpacity>
              </motion.div>
            ))}
          </View>
        </View>

        {/* Verse of the Day Card */}
        <View style={styles.verseCard}>
          <Text style={styles.verseLabel}>VERSE OF THE DAY</Text>
          
          <Text style={styles.verseText}>
            "Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty."
          </Text>
          
          <Text style={styles.verseReference}>— PSALM 91:1</Text>
          
          {reflection ? (
            <View style={styles.reflectionContainer}>
              <Sparkles size={14} color="#d4af37" style={{ marginBottom: 8 }} />
              <Text style={styles.reflectionBody}>{reflection}</Text>
            </View>
          ) : (
            <TouchableOpacity 
              style={styles.reflectionButton} 
              onPress={handleReflect}
              disabled={loadingReflection}
            >
              <Text style={styles.reflectionText}>
                {loadingReflection ? 'DAVID IS REFLECTING...' : "TAP FOR DAVID'S REFLECTION"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

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
  topHeader: {
    display: 'none',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    width: '90%',
    marginBottom: 15,
  },
  titleContainer: {
    flex: 1,
  },
  versionContainer: {
    alignItems: 'flex-end',
    zIndex: 1000,
  },
  headerLabel: {
    fontSize: 7,
    color: 'rgba(212, 175, 55, 0.4)',
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  translationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  translationText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 4,
    letterSpacing: 1,
  },
  translationDropdown: {
    position: 'absolute',
    top: 32,
    right: 0,
    backgroundColor: '#0f2a52',
    borderRadius: 10,
    padding: 6,
    borderWidth: 1,
    borderColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    width: 70,
  },
  dropdownItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dropdownText: {
    color: 'rgba(212, 175, 55, 0.6)',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  dropdownTextActive: {
    color: '#d4af37',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 60,
    paddingBottom: 20,
  },
  searchSection: {
    alignItems: 'center',
    paddingVertical: 10,
    marginHorizontal: 20,
    marginTop: 0,
  },
  mainTitle: {
    fontSize: 18,
    color: '#d4af37',
    fontFamily: 'Playfair Display',
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
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
    borderColor: 'rgba(212, 175, 55, 0.2)',
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
    paddingVertical: 10,
    borderRadius: 15,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
  },
  moodPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  verseCard: {
    backgroundColor: '#0b1e3d',
    marginHorizontal: 20,
    borderRadius: 20,
    paddingVertical: 35,
    paddingHorizontal: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
    marginTop: 15,
  },
  verseLabel: {
    color: '#d4af37',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 15,
  },
  verseText: {
    fontSize: 18,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 15,
  },
  verseReference: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 20,
  },
  reflectionButton: {
    padding: 10,
    marginTop: 10,
  },
  reflectionText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    opacity: 0.6,
  },
  reflectionContainer: {
    marginTop: 20,
    padding: 20,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  reflectionBody: {
    color: '#f5d77a',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
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
});
