import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useUser } from '../UserContext';

const GOLD = '#d4af37';
const SOFT_GOLD = '#f5d77a';
const NAVY = '#0b1e3d';
const DARK_NAVY = '#051020';

// Mood buttons configuration
const MOODS = [
  { key: 'SAD', label: 'SAD' },
  { key: 'ANXIOUS', label: 'ANXIOUS' },
  { key: 'LONELY', label: 'LONELY' },
  { key: 'GRATEFUL', label: 'GRATEFUL' },
  { key: 'ANGRY', label: 'ANGRY' },
  { key: 'HOPEFUL', label: 'HOPEFUL' },
];

// Sample verses of the day
const VERSES_OF_THE_DAY = [
  {
    text: '"Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty."',
    reference: 'PSALM 91:1',
    date: 'MONDAY, MARCH 2',
  },
  {
    text: '"For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope."',
    reference: 'JEREMIAH 29:11',
    date: 'TUESDAY, MARCH 3',
  },
  {
    text: '"Cast all your anxiety on him because he cares for you."',
    reference: '1 PETER 5:7',
    date: 'WEDNESDAY, MARCH 4',
  },
];

export default function HomeScreen({ navigation }: any) {
  const { profile } = useUser();
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verseIndex, setVerseIndex] = useState(0);

  const currentVerse = VERSES_OF_THE_DAY[verseIndex];

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      setVerseIndex((prev) => (prev + 1) % VERSES_OF_THE_DAY.length);
    }, 1000);
  }, []);

  const handleMoodSelect = (mood: string) => {
    setSelectedMood(mood);
    // Navigate to mood-based scripture or chat
    navigation.navigate('Mood', { mood });
  };

  const handleTalkWithDavid = () => {
    navigation.navigate('Voice');
  };

  const handleReflection = () => {
    navigation.navigate('Reflection');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Mood Selection Section */}
      <View style={styles.moodSection}>
        <View style={styles.moodGrid}>
          {MOODS.map((mood, index) => (
            <TouchableOpacity
              key={mood.key}
              style={[
                styles.moodButton,
                selectedMood === mood.key && styles.moodButtonActive,
                index >= 3 && styles.moodButtonSecondRow,
              ]}
              onPress={() => handleMoodSelect(mood.key)}
            >
              <Text
                style={[
                  styles.moodButtonText,
                  selectedMood === mood.key && styles.moodButtonTextActive,
                ]}
              >
                {mood.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Verse of the Day Section */}
      <View style={styles.verseSection}>
        <View style={styles.verseBorder}>
          <Text style={styles.verseLabel}>VERSE OF THE DAY</Text>
          <Text style={styles.verseDate}>{currentVerse.date}</Text>

          <Text style={styles.verseText}>{currentVerse.text}</Text>

          <Text style={styles.verseReference}>— {currentVerse.reference}</Text>

          <TouchableOpacity onPress={handleReflection}>
            <Text style={styles.reflectionLink}>TAP FOR DAVID'S REFLECTION</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Talk with David Section */}
      <View style={styles.actionSection}>
        <TouchableOpacity
          style={styles.talkButton}
          onPress={handleTalkWithDavid}
        >
          <Text style={styles.talkButtonText}>TALK WITH DAVID</Text>
        </TouchableOpacity>

        <Text style={styles.actionSubtitle}>PERSONAL DIALOGUE WITH YOUR BIBLICAL COMPANION</Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>CREATED BY AA DESIGNS</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingVertical: 32,
  },

  // Mood Section
  moodSection: {
    marginBottom: 48,
    alignItems: 'center',
  },

  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },

  moodButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(212, 175, 55, 0.4)',
    borderRadius: 20,
    backgroundColor: 'transparent',
    marginBottom: 6,
  },

  moodButtonActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  moodButtonSecondRow: {
    marginTop: 8,
  },

  moodButtonText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(212, 175, 55, 0.6)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },

  moodButtonTextActive: {
    color: DARK_NAVY,
  },

  // Verse of the Day Section
  verseSection: {
    marginBottom: 48,
    alignItems: 'center',
  },

  verseBorder: {
    width: '100%',
    maxWidth: 500,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    borderRadius: 8,
    alignItems: 'center',
  },

  verseLabel: {
    fontSize: 8,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
    fontFamily: 'Cinzel',
  },

  verseDate: {
    fontSize: 7,
    color: 'rgba(212, 175, 55, 0.5)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 18,
    fontFamily: 'Cinzel',
  },

  verseText: {
    fontSize: 17,
    color: '#ffffff',
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 14,
    fontFamily: 'Playfair Display',
    fontWeight: '400',
  },

  verseReference: {
    fontSize: 9,
    color: GOLD,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 16,
    fontFamily: 'Cinzel',
  },

  reflectionLink: {
    fontSize: 8,
    color: 'rgba(212, 175, 55, 0.6)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontWeight: '600',
    fontFamily: 'Cinzel',
  },

  // Action Section
  actionSection: {
    alignItems: 'center',
    marginBottom: 48,
  },

  talkButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: GOLD,
    borderRadius: 4,
    backgroundColor: 'transparent',
    marginBottom: 12,
  },

  talkButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },

  actionSubtitle: {
    fontSize: 7.5,
    color: 'rgba(212, 175, 55, 0.5)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontWeight: '600',
    fontFamily: 'Cinzel',
  },

  // Footer
  footer: {
    alignItems: 'center',
    marginTop: 32,
    paddingBottom: 16,
  },

  footerText: {
    fontSize: 7,
    color: 'rgba(212, 175, 55, 0.3)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '700',
    fontFamily: 'Cinzel',
  },
});
