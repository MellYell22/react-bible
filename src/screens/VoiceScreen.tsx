import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Lock, Mic, Send, Sparkles, Volume2 } from 'lucide-react';

import { getChatResponse, generateSpeech } from '../services/ai';
import { useUser } from '../UserContext';
import { hasProAccess, OWNER_EMAIL } from '../utils/tier';
import { humanizeForTts, prepareDavidTtsPayload } from '../utils/davidSpeechDelivery';

const DAVID_GREETING_AUDIO_URL = '/audio/david-greeting.mp3';

type ScreenPhase =
  | 'checking'
  | 'greeting'
  | 'tapToBegin'
  | 'ready'
  | 'thinking'
  | 'speaking'
  | 'error';

type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

const cleanVerseMarker = (text: string): string =>
  text.replace(/\n?\[VERSE USED:\s*[^\]]+\]\s*$/i, '').trim();

export default function VoiceScreen() {
  const { profile, session, loading: userContextLoading } = useUser();

  const [phase, setPhase] = useState<ScreenPhase>('checking');
  const [textInput, setTextInput] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [lastResponseText, setLastResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const greetingStartedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);

  const hasVoiceAccess = useMemo(() => {
    if (profile && hasProAccess(profile)) return true;
    const email = session?.user?.email?.toLowerCase();
    return email === OWNER_EMAIL.toLowerCase();
  }, [profile, session?.user?.email]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCurrentAudio();
    };
  }, []);

  useEffect(() => {
    if (userContextLoading) return;
    if (!hasVoiceAccess) return;
    if (greetingStartedRef.current) return;

    greetingStartedRef.current = true;
    void playGreetingAudio();
  }, [hasVoiceAccess, userContextLoading]);

  const stopCurrentAudio = () => {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }
    } catch {
      // Ignore browser audio cleanup errors.
    } finally {
      currentAudioRef.current = null;
    }
  };

  const playGreetingAudio = async () => {
    if (Platform.OS !== 'web') {
      setPhase('ready');
      setError('David greeting audio is ready on web. Use text for now on this preview.');
      return;
    }

    stopCurrentAudio();
    setError(null);
    setPhase('greeting');

    const audio = new Audio(DAVID_GREETING_AUDIO_URL);
    currentAudioRef.current = audio;
    audio.preload = 'auto';

    audio.onended = () => {
      if (!mountedRef.current) return;
      currentAudioRef.current = null;
      setPhase('ready');
    };

    audio.onerror = () => {
      if (!mountedRef.current) return;
      currentAudioRef.current = null;
      setError('The David greeting audio could not be played. Check public/audio/david-greeting.mp3.');
      setPhase('ready');
    };

    try {
      await audio.play();
    } catch {
      if (!mountedRef.current) return;
      setPhase('tapToBegin');
    }
  };

  const handleTapToBegin = () => {
    void playGreetingAudio();
  };

  const playDavidResponseAudio = async (text: string) => {
    if (!text.trim()) {
      setPhase('ready');
      return;
    }

    setPhase('speaking');
    stopCurrentAudio();

    try {
      const preparedText = prepareDavidTtsPayload(humanizeForTts(text), {
        isGreeting: false,
      });
      const audioUrl = await generateSpeech(preparedText, { alreadyPrepared: true });

      if (!audioUrl || Platform.OS !== 'web') {
        setPhase('ready');
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;
        audio.preload = 'auto';
        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;
          if (!mountedRef.current) {
            resolve();
            return;
          }

          currentAudioRef.current = null;
          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // Ignore revoke errors.
          }
          setPhase('ready');
          resolve();
        };

        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(reject);
      });
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'David had trouble speaking that response.');
      setPhase('ready');
    }
  };

  const handleTextSubmit = async () => {
    const userText = textInput.trim();
    if (!userText || phase === 'thinking' || phase === 'speaking') return;

    setTextInput('');
    setError(null);
    setPhase('thinking');

    const nextMessages: ChatTurn[] = [...messages, { role: 'user', content: userText }];
    setMessages(nextMessages);

    try {
      const response = await getChatResponse(nextMessages, 'medium');
      const cleanedResponse = cleanVerseMarker(response);

      const finalMessages: ChatTurn[] = [
        ...nextMessages,
        { role: 'assistant', content: cleanedResponse },
      ];

      setMessages(finalMessages);
      setLastResponseText(cleanedResponse);
      await playDavidResponseAudio(cleanedResponse);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'David could not respond right now.');
      setPhase('ready');
    }
  };

  if (!userContextLoading && !hasVoiceAccess) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockCard}>
          <Lock color="#4F46E5" size={48} style={{ marginBottom: 20 }} />
          <Text style={styles.lockTitle}>Pro Feature</Text>
          <Text style={styles.lockText}>
            Voice with David is available for Pro users.
          </Text>
        </View>
      </View>
    );
  }

  const inputIsVisible = phase === 'ready' || phase === 'error';
  const inputIsDisabled = phase === 'thinking' || phase === 'speaking' || phase === 'greeting' || phase === 'tapToBegin';

  return (
    <ScrollView style={styles.outerContainer} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Sparkles color="#4F46E5" size={24} />
        <Text style={styles.title}>Voice with David</Text>
        <Text style={styles.subtitle}>A calm spiritual companion</Text>
      </View>

      <View style={styles.visualizerContainer}>
        <View
          style={[
            styles.mainCircle,
            (phase === 'greeting' || phase === 'speaking') && styles.mainSpeaking,
            phase === 'ready' && styles.mainReady,
          ]}
        >
          {phase === 'checking' || phase === 'thinking' ? (
            <ActivityIndicator color="#d4af37" size="large" />
          ) : phase === 'greeting' || phase === 'speaking' ? (
            <Volume2 color="#d4af37" size={42} />
          ) : (
            <Mic color="#ffffff" size={42} />
          )}
        </View>
      </View>

      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          {phase === 'checking'
            ? 'Getting David ready…'
            : phase === 'greeting'
              ? 'David is greeting you…'
              : phase === 'tapToBegin'
                ? 'Tap to begin so David can greet you.'
                : phase === 'thinking'
                  ? 'David is reflecting…'
                  : phase === 'speaking'
                    ? 'David is speaking…'
                    : 'Tell David how you’re feeling.'}
        </Text>
      </View>

      {phase === 'tapToBegin' && (
        <TouchableOpacity style={styles.tapButton} onPress={handleTapToBegin}>
          <Text style={styles.tapButtonText}>Tap to begin</Text>
        </TouchableOpacity>
      )}

      {lastResponseText.trim().length > 0 && (
        <View style={styles.responseCard}>
          <Text style={styles.responseLabel}>David says:</Text>
          <Text style={styles.responseText}>{lastResponseText}</Text>
        </View>
      )}

      {inputIsVisible && (
        <View style={styles.textInputContainer}>
          <Text style={styles.textInputLabel}>Share your mood with David</Text>
          <View style={styles.textInputRow}>
            <TextInput
              style={styles.textInputField}
              value={textInput}
              onChangeText={setTextInput}
              placeholder="Tell David how you’re feeling…"
              placeholderTextColor="rgba(212, 175, 55, 0.45)"
              onSubmitEditing={handleTextSubmit}
              returnKeyType="send"
              editable={!inputIsDisabled}
              multiline={false}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!textInput.trim() || inputIsDisabled) && styles.sendButtonDisabled,
              ]}
              onPress={handleTextSubmit}
              disabled={!textInput.trim() || inputIsDisabled}
            >
              <Send color="#0b1e3d" size={18} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Text style={styles.disclaimer}>
        David is a spiritual companion for encouragement and reflection. For emergencies or professional care, contact a trusted local support person or professional.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    minHeight: '100%',
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 28,
    paddingBottom: 44,
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#07162b',
  },
  lockCard: {
    width: '100%',
    maxWidth: 420,
    padding: 28,
    borderRadius: 24,
    backgroundColor: 'rgba(11, 30, 61, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.28)',
    alignItems: 'center',
  },
  lockTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#d4af37',
    marginBottom: 10,
  },
  lockText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#f5d77a',
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 34,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#d4af37',
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 12,
    color: '#f5d77a',
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  visualizerContainer: {
    width: 128,
    height: 128,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  mainCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#0b1e3d',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#d4af37',
    shadowColor: '#d4af37',
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  mainSpeaking: {
    backgroundColor: '#102d57',
    borderColor: '#f5d77a',
  },
  mainReady: {
    backgroundColor: '#0f2a52',
  },
  statusContainer: {
    marginBottom: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(11, 30, 61, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.22)',
  },
  statusText: {
    color: '#f5d77a',
    fontSize: 14,
    textAlign: 'center',
  },
  tapButton: {
    minWidth: 190,
    minHeight: 52,
    borderRadius: 999,
    backgroundColor: '#d4af37',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    paddingHorizontal: 24,
  },
  tapButtonText: {
    color: '#0b1e3d',
    fontSize: 16,
    fontWeight: '800',
  },
  responseCard: {
    width: '100%',
    maxWidth: 620,
    padding: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(11, 30, 61, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    marginBottom: 20,
  },
  responseLabel: {
    color: '#d4af37',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  responseText: {
    color: '#fff8dc',
    fontSize: 16,
    lineHeight: 24,
  },
  textInputContainer: {
    width: '100%',
    maxWidth: 620,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(11, 30, 61, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.28)',
    marginBottom: 18,
  },
  textInputLabel: {
    color: '#d4af37',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  textInputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  textInputField: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.32)',
    paddingHorizontal: 14,
    color: '#fff8dc',
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    fontSize: 15,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#d4af37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  errorBanner: {
    width: '100%',
    maxWidth: 620,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(127, 29, 29, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.45)',
    marginBottom: 18,
  },
  errorText: {
    color: '#fecaca',
    fontSize: 14,
    textAlign: 'center',
  },
  disclaimer: {
    width: '100%',
    maxWidth: 620,
    color: 'rgba(245, 215, 122, 0.72)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
});
