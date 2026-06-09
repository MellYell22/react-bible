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
import { Lock, PhoneCall, PhoneOff, Send, Sparkles } from 'lucide-react';

import { generateSpeech, getDavidVoiceResponse, transcribeAudio } from '../services/ai';
import { useUser } from '../UserContext';
import { hasProAccess, OWNER_EMAIL } from '../utils/tier';
import { humanizeForTts, prepareDavidTtsPayload } from '../utils/davidSpeechDelivery';
import { detectMoodKeyFromMessages } from '../utils/davidMoodContext';

const IDLE_VOICE_LEVELS = [0.18, 0.26, 0.2, 0.3, 0.22, 0.34, 0.24, 0.31, 0.2];

type ScreenPhase =
  | 'checking'
  | 'ready'
  | 'ended'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

const cleanVerseMarker = (text: string): string =>
  text.replace(/\n?\[VERSE USED:\s*[^\]]+\]\s*$/i, '').trim();

const extractVerseMarker = (text: string): string | null => {
  const match = text.match(/\[VERSE USED:\s*([^\]]+)\]/i);
  return match?.[1]?.trim() || null;
};

const getUsedVersesStorageKey = (userId?: string | null): string =>
  `david_used_verses_${userId || 'guest'}`;

const readUsedVersesByMood = (userId?: string | null): Record<string, string[]> => {
  if (typeof localStorage === 'undefined') return {};

  try {
    const raw = localStorage.getItem(getUsedVersesStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeUsedVersesByMood = (
  userId: string | null | undefined,
  nextUsedVerses: Record<string, string[]>,
) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(getUsedVersesStorageKey(userId), JSON.stringify(nextUsedVerses));
};

const updateUsedVerseForMood = (input: {
  userId?: string | null;
  moodKey?: string | null;
  verseReference?: string | null;
  resetUsedVerses?: boolean;
}) => {
  if (!input.moodKey || !input.verseReference) return;

  const moodKey = input.moodKey.toUpperCase();
  const current = readUsedVersesByMood(input.userId);
  const existing = Array.isArray(current[moodKey]) ? current[moodKey] : [];
  const nextMoodPool = input.resetUsedVerses
    ? [input.verseReference]
    : Array.from(new Set([...existing, input.verseReference]));

  writeUsedVersesByMood(input.userId, {
    ...current,
    [moodKey]: nextMoodPool,
  });
};

export default function VoiceScreen() {
  const { profile, session, loading: userContextLoading } = useUser();

  const [phase, setPhase] = useState<ScreenPhase>('checking');
  const [textInput, setTextInput] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [lastResponseText, setLastResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(IDLE_VOICE_LEVELS);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const discardRecordingRef = useRef(false);
  const recordingMimeTypeRef = useRef('audio/webm');
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const voiceActivityFrameRef = useRef<number | null>(null);
  const voiceLevelsRef = useRef<number[]>(IDLE_VOICE_LEVELS);
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
      stopListening(true);
      stopVoiceActivity();
      stopCurrentAudio();
    };
  }, []);

  useEffect(() => {
    if (userContextLoading) return;
    if (!hasVoiceAccess) return;

    setPhase(currentPhase => currentPhase === 'checking' ? 'ready' : currentPhase);
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

  const stopVoiceActivity = () => {
    if (voiceActivityFrameRef.current !== null) {
      cancelAnimationFrame(voiceActivityFrameRef.current);
      voiceActivityFrameRef.current = null;
    }

    try {
      audioContextRef.current?.close();
    } catch {
      // Ignore audio context cleanup errors.
    }

    audioContextRef.current = null;
    analyserRef.current = null;
    voiceLevelsRef.current = IDLE_VOICE_LEVELS;
    setVoiceLevels(IDLE_VOICE_LEVELS);
  };

  const startVoiceActivity = (stream: MediaStream) => {
    stopVoiceActivity();

    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) return;

      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      const timeData = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const tick = () => {
        if (!analyserRef.current || !mountedRef.current) return;

        analyserRef.current.getByteTimeDomainData(timeData);

        let sumSquares = 0;
        for (let index = 0; index < timeData.length; index += 1) {
          const centered = (timeData[index] - 128) / 128;
          sumSquares += centered * centered;
        }

        const rms = Math.sqrt(sumSquares / timeData.length);
        const normalizedVolume = Math.max(0, Math.min(1, (rms - 0.012) / 0.18));
        const now = performance.now();

        const nextLevels = IDLE_VOICE_LEVELS.map((idleLevel, index) => {
          const movement =
            0.5 +
            Math.abs(Math.sin(now / 175 + index * 0.82)) * 0.34 +
            Math.abs(Math.cos(now / 260 + index * 0.53)) * 0.16;
          const target = Math.max(0.12, Math.min(1, idleLevel + normalizedVolume * movement));
          const previous = voiceLevelsRef.current[index] || idleLevel;
          const smoothing = normalizedVolume > 0.04 ? 0.36 : 0.12;

          return previous + (target - previous) * smoothing;
        });

        voiceLevelsRef.current = nextLevels;
        setVoiceLevels(nextLevels);
        voiceActivityFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      voiceLevelsRef.current = IDLE_VOICE_LEVELS;
      setVoiceLevels(IDLE_VOICE_LEVELS);
    }
  };

  const stopListening = (discard = false) => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== 'inactive') {
      discardRecordingRef.current = discard;
      if (discard) audioChunksRef.current = [];
      stopVoiceActivity();
      recorder.stop();
      return;
    }

    stopVoiceActivity();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  };

  const getRecordingMimeType = () => {
    if (typeof MediaRecorder === 'undefined') return '';

    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      return 'audio/webm;codecs=opus';
    }

    if (MediaRecorder.isTypeSupported('audio/webm')) {
      return 'audio/webm';
    }

    return '';
  };

  const startListening = async () => {
    if (Platform.OS !== 'web') {
      setError('Microphone input is available in the web preview.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser does not support microphone recording. Use Chrome or Edge and allow microphone access.');
      return;
    }

    stopCurrentAudio();
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      startVoiceActivity(stream);

      audioChunksRef.current = [];
      discardRecordingRef.current = false;
      recordingMimeTypeRef.current = mimeType || recorder.mimeType || 'audio/webm';
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        if (!mountedRef.current) return;
        stopVoiceActivity();
        setError('David had trouble accessing the microphone. Check microphone permissions and try again.');
        setPhase('ready');
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        if (!mountedRef.current || !chunks.length) {
          if (mountedRef.current && !discardRecordingRef.current) {
            setError("David couldn't hear enough audio. Try holding the mic a little longer.");
            setPhase('ready');
          }
          return;
        }

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          return;
        }

        setPhase('transcribing');

        try {
          const audioBlob = new Blob(chunks, {
            type: recordingMimeTypeRef.current || 'audio/webm',
          });
          const result = await transcribeAudio(audioBlob);
          const transcript = result.transcript.trim();

          if (!transcript) {
            const reason = result.reason === 'audio_too_small'
              ? 'Try holding the mic a little longer before tapping stop.'
              : 'Try speaking a little closer to the microphone.';
            setError(`David couldn't catch that. ${reason}`);
            setPhase('ready');
            return;
          }

          setTextInput(transcript);
          await submitUserText(transcript);
        } catch (err: any) {
          if (!mountedRef.current) return;
          setError(err?.message || "David couldn't transcribe that audio.");
          setPhase('ready');
        }
      };

      recorder.start();
      setPhase('listening');
    } catch (err: any) {
      if (!mountedRef.current) return;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      setError(
        denied
          ? 'Microphone access is blocked. Allow the microphone for localhost in the browser, then try again.'
          : 'David could not start listening. Check that your microphone is available.',
      );
      setPhase('ready');
    }
  };

  const handleStartConversation = () => {
    if (phase === 'ready' || phase === 'error' || phase === 'ended') {
      void startListening();
    }
  };

  const handleEndConversation = () => {
    stopListening(true);
    stopCurrentAudio();
    setTextInput('');
    setError(null);
    setPhase('ended');
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
      }).speechText;
      const audioUrl = await generateSpeech(preparedText, { alreadyPrepared: true });

      if (!audioUrl || Platform.OS !== 'web') {
        if (mountedRef.current) {
          setError("David's text response is ready, but the audio could not be generated right now.");
        }
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
        audio.onerror = () => {
          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // Ignore revoke errors.
          }
          reject(new Error("David's voice audio was returned, but the browser could not play it."));
        };
        audio.play().catch(reject);
      });
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'David had trouble speaking that response.');
      setPhase('ready');
    }
  };

  const submitUserText = async (rawText: string) => {
    const userText = rawText.trim();
    if (!userText || phase === 'thinking' || phase === 'speaking') return;

    setTextInput('');
    setError(null);
    setPhase('thinking');

    const nextMessages: ChatTurn[] = [...messages, { role: 'user', content: userText }];
    setMessages(nextMessages);

    try {
      const detectedMoodKey = detectMoodKeyFromMessages(nextMessages) || undefined;
      const userId = session?.user?.id || profile?.id || 'guest';
      const usedVersesByMood = readUsedVersesByMood(userId);
      const usedVerses = detectedMoodKey ? usedVersesByMood[detectedMoodKey] || [] : [];
      const response = await getDavidVoiceResponse(nextMessages, {
        responseLength: 'medium',
        moodKey: detectedMoodKey,
        usedVerses,
      });
      const verseReference = response.verseUsed || extractVerseMarker(response.text);
      const cleanedResponse = cleanVerseMarker(response.text);

      updateUsedVerseForMood({
        userId,
        moodKey: response.moodKey || detectedMoodKey,
        verseReference,
        resetUsedVerses: response.resetUsedVerses,
      });

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

  const handleTextSubmit = async () => {
    await submitUserText(textInput);
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

  const inputIsVisible = phase === 'ready' || phase === 'error' || phase === 'ended';
  const inputIsDisabled =
    phase === 'thinking' ||
    phase === 'speaking' ||
    phase === 'listening' ||
    phase === 'transcribing';
  const callIsActive =
    phase === 'listening' ||
    phase === 'transcribing' ||
    phase === 'thinking' ||
    phase === 'speaking';
  const callButtonIsEnabled = phase !== 'checking';
  const voiceActivityIsVisible = phase === 'listening';

  const handleCallButtonPress = () => {
    if (!callButtonIsEnabled) return;

    if (phase === 'listening') {
      stopListening(false);
      return;
    }

    if (callIsActive) {
      handleEndConversation();
      return;
    }

    handleStartConversation();
  };

  return (
    <View style={styles.outerContainer}>
      <TouchableOpacity
        style={[
          styles.floatingCallButton,
          callIsActive ? styles.floatingEndButton : styles.floatingStartButton,
          !callButtonIsEnabled && styles.floatingCallButtonDisabled,
        ]}
        onPress={handleCallButtonPress}
        disabled={!callButtonIsEnabled}
        accessibilityRole="button"
        accessibilityLabel={callIsActive ? 'End conversation with David' : 'Start conversation with David'}
      >
        {callIsActive ? (
          <PhoneOff color="#ffffff" size={24} />
        ) : (
          <PhoneCall color="#ffffff" size={24} />
        )}
      </TouchableOpacity>

      {voiceActivityIsVisible && (
        <View style={styles.voiceActivityIndicator} pointerEvents="none">
          {voiceLevels.map((level, index) => (
            <View
              key={index}
              style={[
                styles.voiceActivityBar,
                {
                  height: 5 + level * 24,
                  opacity: 0.52 + level * 0.48,
                },
              ]}
            />
          ))}
        </View>
      )}

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Sparkles color="#4F46E5" size={24} />
          <Text style={styles.title}>Voice with David</Text>
          <Text style={styles.subtitle}>A calm spiritual companion</Text>
        </View>

        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {phase === 'checking'
              ? 'Getting David ready...'
              : phase === 'ended'
                ? 'Call ended. Start again when you are ready.'
                : phase === 'thinking'
                  ? 'David is reflecting...'
                  : phase === 'listening'
                    ? 'David is listening... tap the red button when you finish.'
                    : phase === 'transcribing'
                      ? 'David is hearing what you said...'
                      : phase === 'speaking'
                        ? 'David is speaking...'
                        : "Tap the green phone to start."}
          </Text>
        </View>

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
                placeholder="Tell David how you're feeling..."
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
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#07162b',
    position: 'relative',
  },
  scrollArea: {
    flex: 1,
  },
  floatingCallButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 10,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  floatingStartButton: {
    backgroundColor: '#16a34a',
    shadowColor: '#22c55e',
  },
  floatingEndButton: {
    backgroundColor: '#dc2626',
    shadowColor: '#ef4444',
  },
  floatingCallButtonDisabled: {
    opacity: 0.45,
    shadowOpacity: 0.08,
  },
  voiceActivityIndicator: {
    position: 'absolute',
    top: 78,
    right: 19,
    zIndex: 9,
    width: 52,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  voiceActivityBar: {
    width: 3,
    borderRadius: 999,
    backgroundColor: '#d4af37',
    shadowColor: '#d4af37',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  container: {
    minHeight: '100%',
    alignItems: 'center',
    paddingTop: 92,
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
