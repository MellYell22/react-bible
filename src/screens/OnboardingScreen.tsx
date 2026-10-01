import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Search, MessageCircle, Mic, BookOpen, ChevronRight, Check } from 'lucide-react';
import { supabase } from '../services/supabase';
import { BibleTranslation } from '../types';
import { FullScreenBackground } from '../components/FullScreenBackground';

const STEPS = [
  {
    id: 'welcome',
    title: 'Find Scripture for what you’re feeling.',
    subtitle: 'Your AI Scripture Companion',
    description: 'Search by mood, reflect on Scripture, and talk with David when you want a calm faith-centered companion.',
    icon: BookOpen,
  },
  {
    id: 'mood',
    title: 'Mood Search',
    subtitle: 'Scripture for every emotion',
    description: 'Find comfort, joy, or strength by searching for verses that match how you feel right now.',
    icon: Search,
  },
  {
    id: 'chat',
    title: 'Meet David',
    subtitle: 'Try David free',
    description: 'Your account includes 25 introductory messages with David. No payment method is required to try him.',
    icon: MessageCircle,
  },
  {
    id: 'voice',
    title: 'Voice with David',
    subtitle: '60 voice minutes included',
    description: 'Try a real spoken conversation with David for up to 60 introductory voice minutes. Upgrade only if you want to keep going after your free time is used.',
    icon: Mic,
  },
  {
    id: 'setup',
    title: 'Initial Setup',
    subtitle: 'Choose your Bible translation',
    description: 'Pick the translation you prefer. These translation choices are not locked behind a paid tier.',
    icon: Check,
  },
];

// Keep launch onboarding focused on the three translations the app is actively
// presenting to users. More translations can be added later once a licensed
// Bible-text source is connected and verified.
const TRANSLATIONS: BibleTranslation[] = ['KJV', 'NKJV', 'NIV'];

const TRANSLATION_DETAILS: Partial<Record<BibleTranslation, string>> = {
  KJV: 'King James Version — classic, traditional language.',
  NKJV: 'New King James Version — classic style with more modern wording.',
  NIV: 'New International Version — modern and easy to read.',
};

type OnboardingScreenProps = {
  onComplete: () => void | Promise<void>;
};

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTranslation, setSelectedTranslation] = useState<BibleTranslation>('KJV');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const step = STEPS[currentStep];
  const Icon = step.icon;
  const isFinalStep = currentStep === STEPS.length - 1;

  const handleNext = async () => {
    if (!isFinalStep) {
      setSubmitError(null);
      setCurrentStep((previousStep) => previousStep + 1);
      return;
    }

    if (isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      if (!supabase) {
        throw new Error('The app connection is unavailable. Please refresh and try again.');
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      const userId = sessionData.session?.user?.id;
      if (!userId) {
        throw new Error('Your sign-in session expired. Please sign in again.');
      }

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          has_completed_onboarding: true,
          preferred_translation: selectedTranslation,
          preferred_response_length: 'medium',
          verse_of_the_day_enabled: true,
          verse_of_the_day_time: '08:00',
        })
        .eq('id', userId)
        .select('id, has_completed_onboarding')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedProfile?.has_completed_onboarding) {
        throw new Error('Your setup could not be saved. Please try again.');
      }

      await onComplete();
    } catch (error: any) {
      console.error('[Onboarding] Could not complete setup:', error);
      setSubmitError(error?.message || 'Setup could not be completed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FullScreenBackground center={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mainContent}>
          <View style={styles.progressContainer}>
            {STEPS.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.progressDot,
                  index <= currentStep && styles.progressDotActive,
                  index === currentStep && styles.progressDotCurrent,
                ]}
              />
            ))}
          </View>

          <View style={styles.iconContainer}>
            <Icon color="#d4af37" size={54} strokeWidth={1.5} />
          </View>

          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.subtitle}>{step.subtitle}</Text>
          <Text style={styles.description}>{step.description}</Text>

          {step.id === 'setup' && (
            <View style={styles.setupWrapper}>
              <View style={styles.translationContainer}>
                {TRANSLATIONS.map((translation) => (
                  <TouchableOpacity
                    key={translation}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedTranslation === translation }}
                    style={[
                      styles.translationButton,
                      selectedTranslation === translation && styles.translationButtonActive,
                    ]}
                    onPress={() => setSelectedTranslation(translation)}
                    disabled={isSubmitting}
                  >
                    <Text
                      style={[
                        styles.translationText,
                        selectedTranslation === translation && styles.translationTextActive,
                      ]}
                    >
                      {translation}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.detailCard}>
                <Text style={styles.detailText}>
                  {TRANSLATION_DETAILS[selectedTranslation] || selectedTranslation}
                </Text>
              </View>
            </View>
          )}

          {submitError && (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {submitError}
            </Text>
          )}

          <View style={styles.footer}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isFinalStep ? 'Get started' : 'Continue'}
              accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
              style={[styles.nextButton, isSubmitting && styles.nextButtonDisabled]}
              onPress={() => void handleNext()}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <ActivityIndicator color="#0b1e3d" size="small" />
                  <Text style={[styles.nextButtonText, styles.submittingText]}>SAVING...</Text>
                </>
              ) : (
                <>
                  <Text style={styles.nextButtonText}>{isFinalStep ? 'GET STARTED' : 'CONTINUE'}</Text>
                  <ChevronRight color="#0b1e3d" size={20} />
                </>
              )}
            </TouchableOpacity>

            {!isFinalStep && (
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.skipButton}
                onPress={() => setCurrentStep(STEPS.length - 1)}
              >
                <Text style={styles.skipButtonText}>SKIP</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isFinalStep && (
          <View style={styles.appFooter}>
            <Text style={styles.appFooterText}>CREATED BY AA DESIGNS</Text>
          </View>
        )}
      </ScrollView>
    </FullScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    width: '100%',
  },
  container: {
    flexGrow: 1,
    minHeight: '100%',
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 10,
    alignItems: 'center',
  },
  mainContent: {
    width: '100%',
    maxWidth: 520,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    marginBottom: 32,
  },
  progressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    marginHorizontal: 4,
  },
  progressDotActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.5)',
  },
  progressDotCurrent: {
    backgroundColor: '#d4af37',
    width: 20,
  },
  iconContainer: {
    width: 98,
    height: 98,
    borderRadius: 49,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  title: {
    fontSize: 28,
    color: '#d4af37',
    fontFamily: 'Playfair Display',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 10,
    color: '#f5d77a',
    fontFamily: 'Cinzel',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 20,
    opacity: 0.8,
  },
  description: {
    maxWidth: 440,
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.72)',
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: 28,
    fontFamily: 'Playfair Display',
  },
  translationContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 18,
  },
  translationButton: {
    minWidth: 82,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    margin: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.02)',
  },
  translationButtonActive: {
    backgroundColor: '#d4af37',
    borderColor: '#d4af37',
  },
  translationText: {
    color: '#d4af37',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  translationTextActive: {
    color: '#0b1e3d',
  },
  setupWrapper: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailCard: {
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
    width: '100%',
    maxWidth: 430,
  },
  detailText: {
    color: '#f5d77a',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
  },
  errorText: {
    color: '#ffb4b4',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  footer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 14,
  },
  nextButton: {
    minWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d4af37',
    paddingHorizontal: 36,
    paddingVertical: 15,
    borderRadius: 32,
    marginBottom: 10,
  },
  nextButtonDisabled: {
    opacity: 0.65,
  },
  nextButtonText: {
    color: '#0b1e3d',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginRight: 8,
  },
  submittingText: {
    marginLeft: 10,
    marginRight: 0,
  },
  skipButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  skipButtonText: {
    color: 'rgba(212, 175, 55, 0.5)',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  appFooter: {
    marginTop: 'auto',
    paddingTop: 18,
    paddingBottom: 2,
    alignItems: 'center',
  },
  appFooterText: {
    color: 'rgba(212, 175, 55, 0.3)',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 3,
  },
});
