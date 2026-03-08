import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { Search, MessageCircle, Mic, BookOpen, ChevronRight, Check } from 'lucide-react';
import { supabase } from '../services/supabase';
import { BibleTranslation } from '../types';
import { FullScreenBackground } from '../components/FullScreenBackground';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Sanctuary',
    subtitle: 'Your AI Scripture Companion',
    description: 'A space for peace, reflection, and spiritual growth guided by the wisdom of the Bible.',
    icon: BookOpen,
  },
  {
    id: 'mood',
    title: 'Mood Search',
    subtitle: 'Scripture for every emotion',
    description: 'Find comfort, joy, or strength by searching for verses that match exactly how you feel right now.',
    icon: Search,
  },
  {
    id: 'chat',
    title: 'Meet David',
    subtitle: 'Your Biblical Companion',
    description: 'Chat with David, our AI companion trained to provide compassionate, scripture-based encouragement.',
    icon: MessageCircle,
  },
  {
    id: 'voice',
    title: 'Voice with David',
    subtitle: 'Immersive Dialogue',
    description: 'Experience real-time spiritual conversations with a warm, thoughtful voice that listens and responds.',
    icon: Mic,
  },
  {
    id: 'setup',
    title: 'Initial Setup',
    subtitle: 'Personalize your experience',
    description: 'Choose your preferred Bible translation to begin your journey.',
    icon: Check,
  },
];

const TRANSLATIONS: BibleTranslation[] = ['KJV', 'NIV', 'ESV', 'NKJV', 'NASB'];

export default function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTranslation, setSelectedTranslation] = useState<BibleTranslation>('KJV');
  const [loading, setLoading] = useState(false);

  const step = STEPS[currentStep];
  const Icon = step.icon;

  const handleNext = async () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setLoading(true);
      try {
        const { data: { user } } = await supabase!.auth.getUser();
        if (user) {
          const { error } = await supabase!
            .from('profiles')
            .update({ 
              has_completed_onboarding: true,
              preferred_translation: selectedTranslation 
            })
            .eq('id', user.id);
          
          if (error) throw error;
          onComplete();
        }
      } catch (error: any) {
        console.error('Error completing onboarding:', error);
        alert(`Error: ${error.message || 'Failed to complete setup. Please ensure your database is updated.'}`);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <FullScreenBackground center>
      <View style={styles.container}>
        <View style={styles.progressContainer}>
          {STEPS.map((_, index) => (
            <View 
              key={index} 
              style={[
                styles.progressDot, 
                index <= currentStep && styles.progressDotActive,
                index === currentStep && styles.progressDotCurrent
              ]} 
            />
          ))}
        </View>

        <View style={styles.iconContainer}>
          <Icon color="#d4af37" size={64} strokeWidth={1.5} />
        </View>

        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.subtitle}>{step.subtitle}</Text>
        <Text style={styles.description}>{step.description}</Text>

        {step.id === 'setup' && (
          <View style={styles.translationContainer}>
            {TRANSLATIONS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.translationButton,
                  selectedTranslation === t && styles.translationButtonActive
                ]}
                onPress={() => setSelectedTranslation(t)}
              >
                <Text style={[
                  styles.translationText,
                  selectedTranslation === t && styles.translationTextActive
                ]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <TouchableOpacity 
            style={styles.nextButton} 
            onPress={handleNext}
            disabled={loading}
          >
            <Text style={styles.nextButtonText}>
              {currentStep === STEPS.length - 1 ? 'GET STARTED' : 'CONTINUE'}
            </Text>
            <ChevronRight color="#0b1e3d" size={20} />
          </TouchableOpacity>

          {currentStep < STEPS.length - 1 && (
            <TouchableOpacity style={styles.skipButton} onPress={() => setCurrentStep(STEPS.length - 1)}>
              <Text style={styles.skipButtonText}>SKIP</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.appFooter}>
          <Text style={styles.appFooterText}>CREATED BY AA DESIGNS</Text>
        </View>
      </View>
    </FullScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    marginBottom: 60,
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
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  title: {
    fontSize: 32,
    color: '#d4af37',
    fontFamily: 'Playfair Display',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 12,
    color: '#f5d77a',
    fontFamily: 'Cinzel',
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 30,
    opacity: 0.8,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 40,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
  },
  translationContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 40,
  },
  translationButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    margin: 6,
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
  footer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d4af37',
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 40,
    marginBottom: 20,
  },
  nextButtonText: {
    color: '#0b1e3d',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginRight: 8,
  },
  skipButton: {
    padding: 10,
  },
  skipButtonText: {
    color: 'rgba(212, 175, 55, 0.5)',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  appFooter: {
    marginTop: 40,
    paddingBottom: 20,
    alignItems: 'center',
  },
  appFooterText: {
    color: 'rgba(212, 175, 55, 0.3)',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 3,
  },
});
