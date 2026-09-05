import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useUser } from '../UserContext';
import { getVerseOfTheDay } from '../services/ai';
import { Scripture } from '../types';
import { hasProAccess } from '../utils/tier';
import {
  NAVY,
  DARK_NAVY,
  GOLD,
  SOFT_GOLD,
  WHITE,
  gold,
  surfaces,
  fonts,
  fontSize,
  tracking,
  spacing,
  buttons,
  glow,
  TOUCH_TARGET,
  MAX_CONTENT_WIDTH,
} from '../theme';

const MOODS = [
  { key: 'SAD', label: 'SAD' },
  { key: 'ANXIOUS', label: 'ANXIOUS' },
  { key: 'LONELY', label: 'LONELY' },
  { key: 'GRATEFUL', label: 'GRATEFUL' },
  { key: 'ANGRY', label: 'ANGRY' },
  { key: 'HOPEFUL', label: 'HOPEFUL' },
];

const DAILY_FALLBACKS: Scripture[] = [
  {
    verse: 'The Lord is my shepherd; I shall not want.',
    reference: 'Psalm 23:1',
    explanation: 'A quiet reminder that you do not have to carry today by yourself.',
  },
  {
    verse: 'Be still, and know that I am God.',
    reference: 'Psalm 46:10',
    explanation: 'You are allowed to slow down and let the moment be quieter than the worry.',
  },
  {
    verse: 'Casting all your care upon him; for he careth for you.',
    reference: '1 Peter 5:7',
    explanation: 'What weighs on you matters to God; you do not have to hide it.',
  },
  {
    verse: 'Weeping may endure for a night, but joy cometh in the morning.',
    reference: 'Psalm 30:5',
    explanation: 'Hard seasons are real, but they are not promised the final word.',
  },
  {
    verse: 'I can do all things through Christ which strengtheneth me.',
    reference: 'Philippians 4:13',
    explanation: 'Strength does not have to mean doing everything alone.',
  },
  {
    verse: 'The Lord is nigh unto them that are of a broken heart.',
    reference: 'Psalm 34:18',
    explanation: 'Pain does not make you distant from God; Scripture says he draws near to it.',
  },
  {
    verse: 'This is the day which the Lord hath made; we will rejoice and be glad in it.',
    reference: 'Psalm 118:24',
    explanation: 'Today is worth meeting as its own day, without asking it to be yesterday or tomorrow.',
  },
];

const getLocalDayKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getFallbackVerseForDay = (dayKey: string): Scripture => {
  const dayNumber = Math.floor(new Date(`${dayKey}T00:00:00`).getTime() / 86_400_000);
  return DAILY_FALLBACKS[Math.abs(dayNumber) % DAILY_FALLBACKS.length];
};

export default function HomeScreen({ navigation }: any) {
  const { profile } = useUser();
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [emotionalEntry, setEmotionalEntry] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [dayKey, setDayKey] = useState(getLocalDayKey);
  const [dailyVerse, setDailyVerse] = useState<Scripture>(() => getFallbackVerseForDay(getLocalDayKey()));
  const [verseLoading, setVerseLoading] = useState(true);
  const [verseError, setVerseError] = useState(false);

  const translation = profile?.preferred_translation || 'KJV';
  const voiceIncluded = hasProAccess(profile);

  // On desktop the offset deliberately drops the experience toward the middle of
  // a tall window. On a phone that same 20% was spending a fifth of the first
  // screen on empty navy and pushing the mood grid — the thing that makes people
  // stay — below the fold, so phones get a much tighter offset.
  const isPhone = viewportWidth < 700;
  const contentTopPadding = isPhone
    ? Math.max(24, Math.min(56, Math.round(viewportHeight * 0.05)))
    : Math.max(110, Math.min(190, Math.round(viewportHeight * 0.2)));

  const loadDailyVerse = React.useCallback(async () => {
    setVerseLoading(true);
    setVerseError(false);

    try {
      const verse = await getVerseOfTheDay(translation);
      if (!verse?.verse || !verse?.reference) {
        throw new Error('Verse of the day response was incomplete.');
      }
      setDailyVerse(verse);
    } catch (error) {
      console.error('[Home] Verse of the day could not load:', error);
      setDailyVerse(getFallbackVerseForDay(dayKey));
      setVerseError(true);
    } finally {
      setVerseLoading(false);
    }
  }, [translation, dayKey]);

  React.useEffect(() => {
    void loadDailyVerse();
  }, [loadDailyVerse]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      const currentDay = getLocalDayKey();
      setDayKey(previousDay => (previousDay === currentDay ? previousDay : currentDay));
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  const formattedDate = new Date()
    .toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    .toUpperCase();

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDailyVerse();
    } finally {
      setRefreshing(false);
    }
  }, [loadDailyVerse]);

  const handleMoodSelect = (mood: string) => {
    setSelectedMood(mood);
    navigation.navigate('Mood', { mood });
  };

  const handleEmotionalEntrySubmit = () => {
    const prompt = emotionalEntry.trim();
    if (!prompt) return;

    setEmotionalEntry('');
    navigation.navigate('Chat', {
      initialPrompt: prompt,
      source: 'home-emotional-search',
      submittedAt: Date.now(),
    });
  };

  const handleChatWithDavid = () => navigation.navigate('Chat');
  const handleTalkWithDavid = () => navigation.navigate('Voice');

  const handleReflection = () => {
    navigation.navigate('Reflection', {
      verse: dailyVerse.verse,
      reference: dailyVerse.reference,
      explanation: dailyVerse.explanation,
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingTop: contentTopPadding }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.contentStack}>
        <View style={styles.searchSection}>
          <Text style={styles.freeChatLabel} role="heading" aria-level={2}>TEXT CHAT WITH DAVID · FREE</Text>
          <View style={[styles.searchShell, searchFocused && styles.searchShellFocused]}>
            <TextInput
              value={emotionalEntry}
              onChangeText={setEmotionalEntry}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onSubmitEditing={handleEmotionalEntrySubmit}
              placeholder="I am feeling…"
              placeholderTextColor="rgba(245, 215, 122, 0.46)"
              returnKeyType="send"
              style={styles.searchInput}
              multiline={false}
              accessibilityLabel="Tell David how you are feeling"
            />
            <Pressable
              style={[styles.searchSubmit, !emotionalEntry.trim() && styles.searchSubmitDisabled]}
              onPress={handleEmotionalEntrySubmit}
              disabled={!emotionalEntry.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send to David"
            >
              <Text style={styles.searchSubmitText}>SEND</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.moodSection}>
          <Text style={styles.sectionLabel} role="heading" aria-level={2}>HOW ARE YOU FEELING</Text>
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
                accessibilityRole="button"
                accessibilityLabel={mood.label}
                accessibilityState={{ selected: selectedMood === mood.key }}
                activeOpacity={0.75}
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

        <View style={styles.verseSection}>
          <View style={styles.verseBorder}>
            <Text style={styles.verseLabel} role="heading" aria-level={2}>VERSE OF THE DAY</Text>
            <Text style={styles.verseDate}>{formattedDate}</Text>

            {verseLoading ? (
              <View style={styles.verseLoading}>
                <ActivityIndicator color={GOLD} size="small" />
                <Text style={styles.verseLoadingText}>Finding today's verse…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.verseText}>“{dailyVerse.verse}”</Text>
                <Text style={styles.verseReference}>— {dailyVerse.reference}</Text>
                {verseError && (
                  <Text style={styles.verseFallbackText}>Showing today's offline verse.</Text>
                )}
                <TouchableOpacity
                  onPress={handleReflection}
                  style={styles.reflectionTap}
                  accessibilityRole="button"
                  accessibilityLabel="Read David's reflection on this verse"
                  activeOpacity={0.75}
                >
                  <Text style={styles.reflectionLink}>TAP FOR DAVID'S REFLECTION</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <View style={styles.actionSection}>
          <Text style={styles.actionHeading}>CHOOSE HOW TO TALK WITH DAVID</Text>
          <Text style={styles.actionExplainer}>Text chat is free. Live voice is optional and Pro.</Text>

          <TouchableOpacity
            style={styles.chatButton}
            onPress={handleChatWithDavid}
            accessibilityRole="button"
            accessibilityLabel="Chat with David for free"
            activeOpacity={0.75}
          >
            <Text style={styles.chatButtonText}>CHAT WITH DAVID</Text>
            <Text style={styles.freeBadge}>FREE</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.talkButton}
            onPress={handleTalkWithDavid}
            accessibilityRole="button"
            accessibilityLabel="Voice with David"
            activeOpacity={0.75}
          >
            <Text style={styles.talkButtonText}>VOICE WITH DAVID</Text>
            <Text style={styles.proBadge}>{voiceIncluded ? 'INCLUDED' : 'PRO'}</Text>
          </TouchableOpacity>
        </View>
      </View>

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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: 'center',
  },

  contentStack: {
    width: '100%',
    alignItems: 'center',
  },

  searchSection: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignItems: 'center',
    marginBottom: spacing.section,
  },

  freeChatLabel: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
  },

  searchShell: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: gold.a30,
    borderRadius: 18,
    backgroundColor: surfaces.sunken,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    ...glow,
  },

  searchShellFocused: {
    borderColor: gold.a70,
    backgroundColor: 'rgba(5, 16, 32, 0.82)',
    boxShadow: '0 0 24px rgba(212, 175, 55, 0.34)',
  },

  searchInput: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    color: '#fff8df',
    fontSize: 16,
    fontStyle: 'italic',
    fontFamily: fonts.display,
    letterSpacing: 0.3,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },

  searchSubmit: {
    minWidth: 82,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
  },

  searchSubmitDisabled: {
    ...buttons.disabled,
  },

  searchSubmitText: {
    fontFamily: fonts.ui,
    fontSize: fontSize.button,
    fontWeight: '700',
    color: DARK_NAVY,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
  },

  sectionLabel: {
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    fontWeight: '700',
    color: gold.a60,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
  },

  moodSection: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    marginBottom: spacing.section,
  },

  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  moodButton: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: gold.a30,
    borderRadius: 16,
    backgroundColor: surfaces.input,
  },

  moodButtonSecondRow: {},

  moodButtonActive: {
    borderColor: GOLD,
    backgroundColor: gold.a10,
    ...glow,
  },

  moodButtonText: {
    fontFamily: fonts.ui,
    fontSize: fontSize.tiny,
    fontWeight: '700',
    color: gold.a60,
    letterSpacing: tracking.normal,
    textTransform: 'uppercase',
  },

  moodButtonTextActive: {
    color: SOFT_GOLD,
  },

  verseSection: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    marginBottom: spacing.section,
  },

  verseBorder: {
    borderWidth: 1,
    borderColor: gold.a30,
    borderRadius: 24,
    backgroundColor: surfaces.input,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },

  verseLabel: {
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },

  verseDate: {
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    color: gold.a50,
    letterSpacing: tracking.normal,
    textTransform: 'uppercase',
    marginBottom: spacing.xl,
  },

  verseLoading: {
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },

  verseLoadingText: {
    fontFamily: fonts.display,
    color: gold.a60,
    fontSize: 13,
  },

  verseText: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 28,
    fontStyle: 'italic',
    color: WHITE,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  verseReference: {
    fontFamily: fonts.ui,
    fontSize: fontSize.tiny,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },

  verseFallbackText: {
    fontFamily: fonts.display,
    color: gold.a40,
    fontSize: 11,
    marginBottom: spacing.md,
  },

  reflectionTap: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },

  reflectionLink: {
    fontFamily: fonts.ui,
    fontSize: fontSize.tiny,
    fontWeight: '600',
    color: gold.a50,
    letterSpacing: tracking.tight,
    textTransform: 'uppercase',
  },

  actionSection: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },

  actionHeading: {
    alignSelf: 'flex-start',
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
  },

  actionExplainer: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    fontFamily: fonts.display,
    fontSize: 13,
    color: gold.a50,
  },

  chatButton: {
    ...buttons.primary,
    borderRadius: 18,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },

  chatButtonText: {
    ...buttons.primaryText,
  },

  talkButton: {
    ...buttons.secondary,
    borderRadius: 18,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },

  talkButtonText: {
    ...buttons.secondaryText,
  },

  freeBadge: {
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    fontWeight: '800',
    color: DARK_NAVY,
    letterSpacing: tracking.normal,
  },

  proBadge: {
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    fontWeight: '800',
    color: GOLD,
    letterSpacing: tracking.normal,
  },

  footer: {
    width: '100%',
    marginTop: 'auto',
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },

  footerText: {
    fontFamily: fonts.ui,
    fontSize: fontSize.micro,
    color: gold.a30,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
  },
});
