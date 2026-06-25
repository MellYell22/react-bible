import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Lock, Mic, Send, Sparkles, Square } from 'lucide-react';

import { generateSpeech, getDavidVoiceResponse, transcribeAudio } from '../services/ai';
import { useUser } from '../UserContext';
import { hasProAccess, OWNER_EMAIL } from '../utils/tier';
import { humanizeForTts, prepareDavidTtsPayload } from '../utils/davidSpeechDelivery';
import { detectMoodKeyFromMessages } from '../utils/davidMoodContext';
import { getVoiceSessionGreeting } from '../constants/persona';

const IDLE_VOICE_LEVELS = [0.18, 0.26, 0.2, 0.3, 0.22, 0.34, 0.24, 0.31, 0.2];

const SPEECH_VOLUME_THRESHOLD = 0.11;
const SILENCE_STOP_MS = 1100;
const MIN_RECORDING_MS = 850;
const HARD_MAX_RECORDING_MS = 45000;

type ScreenPhase =
  | 'checking'
  | 'idle'
  | 'ended'
  | 'greeting'
  | 'starting'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

type PlayDavidAudioOptions = {
  conversationId: number;
  requestId?: number;
  isGreeting?: boolean;
  resumeListening?: boolean;
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

const normalizeTranscript = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const isMeaningfulUserText = (value: string): boolean => {
  const text = normalizeTranscript(value);
  if (!text) return false;

  const lowered = text.toLowerCase();
  const junkPatterns = [
    /^[\s.…,!?*-]+$/,
    /^(okay|ok|um+|uh+|hmm+|mm+|mhm+|ah+|oh+|bye|goodbye)[.!?\s]*$/i,
    /^(music|applause|\[silence\]|\[music\]|\[inaudible\])$/i,
  ];

  if (junkPatterns.some(pattern => pattern.test(lowered))) return false;

  const words = text.split(/\s+/).filter(Boolean);
  const letters = text.replace(/[^a-zA-Z]/g, '');
  return words.length >= 2 && letters.length >= 4;
};

export default function VoiceScreen() {
  const { profile, session, loading: userContextLoading } = useUser();

  const [phase, setPhaseState] = useState<ScreenPhase>('checking');
  const [textInput, setTextInput] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [lastResponseText, setLastResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(IDLE_VOICE_LEVELS);

  const phaseRef = useRef<ScreenPhase>('checking');
  const messagesRef = useRef<ChatTurn[]>([]);
  const conversationActiveRef = useRef(false);
  const conversationIdRef = useRef(0);
  const requestIdRef = useRef(0);
  const listenSessionIdRef = useRef(0);
  const processingRef = useRef(false);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const audioStopResolverRef = useRef<(() => void) | null>(null);
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

  const recordingStartedAtRef = useRef(0);
  const speechDetectedRef = useRef(false);
  const lastSpeechAtRef = useRef<number | null>(null);
  const autoStopTriggeredRef = useRef(false);

  const transcribeAbortControllerRef = useRef<AbortController | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const speechAbortControllerRef = useRef<AbortController | null>(null);

  const hasVoiceAccess = useMemo(() => {
    if (profile && hasProAccess(profile)) return true;
    const email = session?.user?.email?.toLowerCase();
    return email === OWNER_EMAIL.toLowerCase();
  }, [profile, session?.user?.email]);

  const setPhase = (next: ScreenPhase | ((current: ScreenPhase) => ScreenPhase)) => {
    const resolved = typeof next === 'function' ? next(phaseRef.current) : next;
    phaseRef.current = resolved;
    setPhaseState(resolved);
  };

  const commitMessages = (nextMessages: ChatTurn[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
  };

  const isCurrentConversation = (conversationId: number, requestId?: number): boolean => {
    if (!mountedRef.current) return false;
    if (!conversationActiveRef.current) return false;
    if (conversationIdRef.current !== conversationId) return false;
    if (requestId !== undefined && requestIdRef.current !== requestId) return false;
    return true;
  };

  const clearAbortController = (ref: React.MutableRefObject<AbortController | null>) => {
    ref.current = null;
  };

  const abortPendingRequests = () => {
    transcribeAbortControllerRef.current?.abort();
    chatAbortControllerRef.current?.abort();
    speechAbortControllerRef.current?.abort();

    transcribeAbortControllerRef.current = null;
    chatAbortControllerRef.current = null;
    speechAbortControllerRef.current = null;
  };

  const stopCurrentAudio = () => {
    const audio = currentAudioRef.current;
    const stopResolver = audioStopResolverRef.current;
    const audioUrl = currentAudioUrlRef.current;

    currentAudioRef.current = null;
    audioStopResolverRef.current = null;
    currentAudioUrlRef.current = null;

    try {
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.currentTime = 0;
      }
    } catch {
      // Ignore browser audio cleanup errors.
    }

    try {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    } catch {
      // Ignore revoke errors.
    }

    stopResolver?.();
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

  const startSyntheticVoiceActivity = () => {
    stopVoiceActivity();

    const tick = () => {
      if (!mountedRef.current) return;

      const now = performance.now();
      const nextLevels = IDLE_VOICE_LEVELS.map((idleLevel, index) => {
        const rise =
          Math.abs(Math.sin(now / 185 + index * 0.76)) * 0.36 +
          Math.abs(Math.cos(now / 295 + index * 0.47)) * 0.18;
        const target = Math.max(0.18, Math.min(0.86, idleLevel + rise));
        const previous = voiceLevelsRef.current[index] || idleLevel;

        return previous + (target - previous) * 0.22;
      });

      voiceLevelsRef.current = nextLevels;
      setVoiceLevels(nextLevels);
      voiceActivityFrameRef.current = requestAnimationFrame(tick);
    };

    tick();
  };

  const stopListening = (discard = false) => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== 'inactive') {
      discardRecordingRef.current = discard;
      if (discard) audioChunksRef.current = [];
      autoStopTriggeredRef.current = true;
      stopVoiceActivity();

      try {
        recorder.stop();
      } catch {
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
      }
      return;
    }

    stopVoiceActivity();
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  };

  const startVoiceActivity = (
    stream: MediaStream,
    options: {
      monitorSilence?: boolean;
      conversationId?: number;
      listenSessionId?: number;
    } = {},
  ) => {
    stopVoiceActivity();

    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextCtor) {
        startSyntheticVoiceActivity();
        return;
      }

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
          const ambientPulse =
            Math.abs(Math.sin(now / 210 + index * 0.74)) * 0.13 +
            Math.abs(Math.cos(now / 310 + index * 0.41)) * 0.08;
          const movement =
            0.5 +
            Math.abs(Math.sin(now / 175 + index * 0.82)) * 0.34 +
            Math.abs(Math.cos(now / 260 + index * 0.53)) * 0.16;
          const target = Math.max(
            0.16,
            Math.min(1, idleLevel + ambientPulse + normalizedVolume * movement * 0.68),
          );
          const previous = voiceLevelsRef.current[index] || idleLevel;
          const smoothing = 0.2 + normalizedVolume * 0.18;

          return previous + (target - previous) * smoothing;
        });

        voiceLevelsRef.current = nextLevels;
        setVoiceLevels(nextLevels);

        if (options.monitorSilence && options.conversationId && options.listenSessionId) {
          const recorder = mediaRecorderRef.current;
          const isStillCurrent =
            conversationActiveRef.current &&
            conversationIdRef.current === options.conversationId &&
            listenSessionIdRef.current === options.listenSessionId &&
            recorder?.state === 'recording';

          if (isStillCurrent) {
            if (normalizedVolume >= SPEECH_VOLUME_THRESHOLD) {
              speechDetectedRef.current = true;
              lastSpeechAtRef.current = now;
            }

            const startedAt = recordingStartedAtRef.current || now;
            const hasRecordingMinimum = now - startedAt >= MIN_RECORDING_MS;
            const silenceHasSettled =
              speechDetectedRef.current &&
              lastSpeechAtRef.current !== null &&
              now - lastSpeechAtRef.current >= SILENCE_STOP_MS;
            const hitHardMaximum = speechDetectedRef.current && now - startedAt >= HARD_MAX_RECORDING_MS;

            if (
              !autoStopTriggeredRef.current &&
              hasRecordingMinimum &&
              (silenceHasSettled || hitHardMaximum)
            ) {
              autoStopTriggeredRef.current = true;
              stopListening(false);
              return;
            }
          }
        }

        voiceActivityFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      startSyntheticVoiceActivity();
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conversationActiveRef.current = false;
      conversationIdRef.current += 1;
      requestIdRef.current += 1;
      listenSessionIdRef.current += 1;
      processingRef.current = false;
      abortPendingRequests();
      stopListening(true);
      stopVoiceActivity();
      stopCurrentAudio();
    };
  }, []);

  useEffect(() => {
    if (userContextLoading) return;
    if (!hasVoiceAccess) return;

    setPhase(currentPhase => currentPhase === 'checking' ? 'idle' : currentPhase);
  }, [hasVoiceAccess, userContextLoading]);

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

  const startListening = async (conversationId = conversationIdRef.current) => {
    if (!isCurrentConversation(conversationId)) return;

    if (Platform.OS !== 'web') {
      setError('Microphone input is available in the web preview.');
      setPhase('error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser does not support microphone recording. Use Chrome, Edge, or Safari and allow microphone access.');
      setPhase('error');
      return;
    }

    stopCurrentAudio();
    stopListening(true);
    setError(null);
    setPhase('starting');
    startSyntheticVoiceActivity();

    const listenSessionId = listenSessionIdRef.current + 1;
    listenSessionIdRef.current = listenSessionId;

    let pendingStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingStream = stream;

      if (!isCurrentConversation(conversationId) || listenSessionIdRef.current !== listenSessionId) {
        pendingStream.getTracks().forEach(track => track.stop());
        return;
      }

      const mimeType = getRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      pendingStream = null;
      audioChunksRef.current = [];
      discardRecordingRef.current = false;
      recordingMimeTypeRef.current = mimeType || recorder.mimeType || 'audio/webm';
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = performance.now();
      speechDetectedRef.current = false;
      lastSpeechAtRef.current = null;
      autoStopTriggeredRef.current = false;

      startVoiceActivity(stream, {
        monitorSilence: true,
        conversationId,
        listenSessionId,
      });

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        if (!mountedRef.current) return;
        stopVoiceActivity();
        if (isCurrentConversation(conversationId)) {
          setError('David had trouble accessing the microphone. Allow microphone access, then try again.');
          setPhase('error');
        }
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        const shouldDiscard = discardRecordingRef.current;
        audioChunksRef.current = [];
        discardRecordingRef.current = false;

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        if (
          shouldDiscard ||
          !isCurrentConversation(conversationId) ||
          listenSessionIdRef.current !== listenSessionId
        ) {
          return;
        }

        if (!chunks.length || !speechDetectedRef.current) {
          if (isCurrentConversation(conversationId)) {
            setError("David couldn't hear enough audio yet. Try speaking a little closer to the microphone.");
            void startListening(conversationId);
          }
          return;
        }

        setPhase('transcribing');

        const transcribeController = new AbortController();
        transcribeAbortControllerRef.current?.abort();
        transcribeAbortControllerRef.current = transcribeController;

        try {
          const audioBlob = new Blob(chunks, {
            type: recordingMimeTypeRef.current || 'audio/webm',
          });
          const result = await transcribeAudio(audioBlob, {
            signal: transcribeController.signal,
          });

          if (transcribeAbortControllerRef.current === transcribeController) {
            clearAbortController(transcribeAbortControllerRef);
          }

          if (!isCurrentConversation(conversationId) || listenSessionIdRef.current !== listenSessionId) {
            return;
          }

          const transcript = normalizeTranscript(result.transcript);

          console.log('[David Voice] Final transcript accepted for review:', transcript);

          if (!transcript || result.rejected || !isMeaningfulUserText(transcript)) {
            const reason = result.reason === 'audio_too_small'
              ? 'Try holding the mic a little longer before pausing.'
              : 'Try speaking a little closer to the microphone.';
            setError(`David couldn't catch that. ${reason}`);
            void startListening(conversationId);
            return;
          }

          setTextInput('');
          await submitUserText(transcript, {
            conversationId,
            resumeListening: true,
          });
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          if (!mountedRef.current) return;
          if (!isCurrentConversation(conversationId)) return;

          setError(err?.message || "David couldn't transcribe that audio.");
          setPhase('error');
        } finally {
          if (transcribeAbortControllerRef.current === transcribeController) {
            clearAbortController(transcribeAbortControllerRef);
          }
        }
      };

      recorder.start();
      if (isCurrentConversation(conversationId) && listenSessionIdRef.current === listenSessionId) {
        setPhase('listening');
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      pendingStream?.getTracks().forEach(track => track.stop());
      stopVoiceActivity();

      if (!isCurrentConversation(conversationId)) return;

      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      setError(
        denied
          ? 'Microphone access is blocked. Allow microphone access for this site, then tap Start Conversation again.'
          : 'David could not start listening. Check that your microphone is available.',
      );
      setPhase('error');
    }
  };

  const playDavidResponseAudio = async (
    text: string,
    options: PlayDavidAudioOptions,
  ) => {
    const cleanText = text.trim();

    if (!cleanText) {
      if (options.resumeListening && isCurrentConversation(options.conversationId, options.requestId)) {
        await startListening(options.conversationId);
      } else if (isCurrentConversation(options.conversationId, options.requestId)) {
        setPhase('idle');
      }
      return;
    }

    if (!isCurrentConversation(options.conversationId, options.requestId)) return;

    setPhase('speaking');
    stopListening(true);
    stopCurrentAudio();
    startSyntheticVoiceActivity();

    const speechController = new AbortController();
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = speechController;

    try {
      const preparedText = prepareDavidTtsPayload(humanizeForTts(cleanText), {
        isGreeting: Boolean(options.isGreeting),
      }).speechText;
      const audioUrl = await generateSpeech(preparedText, {
        alreadyPrepared: true,
        isGreeting: Boolean(options.isGreeting),
        signal: speechController.signal,
      });

      if (speechAbortControllerRef.current === speechController) {
        clearAbortController(speechAbortControllerRef);
      }

      if (!isCurrentConversation(options.conversationId, options.requestId)) {
        if (audioUrl) {
          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // Ignore revoke errors.
          }
        }
        return;
      }

      if (!audioUrl || Platform.OS !== 'web') {
        setError("David's text response is ready, but the voice audio could not be generated right now.");
        stopVoiceActivity();

        if (options.resumeListening && isCurrentConversation(options.conversationId, options.requestId)) {
          await startListening(options.conversationId);
        } else if (isCurrentConversation(options.conversationId, options.requestId)) {
          setPhase('idle');
        }
        return;
      }

      const audioResult = await new Promise<'ended' | 'stopped'>((resolve, reject) => {
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;
        currentAudioUrlRef.current = audioUrl;
        audio.preload = 'auto';
        let finished = false;

        const finish = (result: 'ended' | 'stopped') => {
          if (finished) return;
          finished = true;

          if (currentAudioRef.current === audio) {
            currentAudioRef.current = null;
          }
          if (currentAudioUrlRef.current === audioUrl) {
            currentAudioUrlRef.current = null;
          }
          if (audioStopResolverRef.current) {
            audioStopResolverRef.current = null;
          }

          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // Ignore revoke errors.
          }

          resolve(result);
        };

        audioStopResolverRef.current = () => finish('stopped');
        audio.onended = () => finish('ended');
        audio.onerror = () => {
          if (finished) return;
          finished = true;

          if (currentAudioRef.current === audio) {
            currentAudioRef.current = null;
          }
          if (currentAudioUrlRef.current === audioUrl) {
            currentAudioUrlRef.current = null;
          }
          audioStopResolverRef.current = null;

          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // Ignore revoke errors.
          }

          reject(new Error("David's voice audio was returned, but the browser could not play it."));
        };
        audio.play().catch(reject);
      });

      stopVoiceActivity();

      if (audioResult === 'ended' && options.resumeListening && isCurrentConversation(options.conversationId, options.requestId)) {
        await startListening(options.conversationId);
      } else if (audioResult === 'ended' && isCurrentConversation(options.conversationId, options.requestId)) {
        setPhase('idle');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!mountedRef.current) return;
      if (!isCurrentConversation(options.conversationId, options.requestId)) return;

      stopVoiceActivity();
      setError(err?.message || 'David had trouble speaking that response.');
      setPhase('error');
    } finally {
      if (speechAbortControllerRef.current === speechController) {
        clearAbortController(speechAbortControllerRef);
      }
    }
  };

  const submitUserText = async (
    rawText: string,
    options: {
      conversationId?: number;
      resumeListening?: boolean;
    } = {},
  ) => {
    const userText = normalizeTranscript(rawText);
    if (!isMeaningfulUserText(userText)) {
      setError("David couldn't catch enough words to respond yet.");
      return;
    }

    if (processingRef.current) return;

    const localConversationId = options.conversationId ?? conversationIdRef.current;
    const shouldResumeListening = Boolean(options.resumeListening);

    if (!conversationActiveRef.current) {
      conversationActiveRef.current = true;
      conversationIdRef.current = localConversationId || conversationIdRef.current + 1;
    }

    if (!isCurrentConversation(localConversationId)) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    processingRef.current = true;

    setTextInput('');
    setError(null);
    setPhase('thinking');

    const nextMessages: ChatTurn[] = [...messagesRef.current, { role: 'user', content: userText }];
    commitMessages(nextMessages);

    const chatController = new AbortController();
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = chatController;

    try {
      const detectedMoodKey = detectMoodKeyFromMessages(nextMessages) || undefined;
      const userId = session?.user?.id || profile?.id || 'guest';
      const usedVersesByMood = readUsedVersesByMood(userId);
      const usedVerses = detectedMoodKey ? usedVersesByMood[detectedMoodKey] || [] : [];

      console.log('[David Voice] Sending exact latest user words:', userText);

      const response = await getDavidVoiceResponse(nextMessages, {
        responseLength: 'medium',
        moodKey: detectedMoodKey,
        usedVerses,
        userId,
        signal: chatController.signal,
      });

      if (chatAbortControllerRef.current === chatController) {
        clearAbortController(chatAbortControllerRef);
      }

      if (!isCurrentConversation(localConversationId, requestId)) return;

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

      commitMessages(finalMessages);
      setLastResponseText(cleanedResponse);

      await playDavidResponseAudio(cleanedResponse, {
        conversationId: localConversationId,
        requestId,
        isGreeting: false,
        resumeListening: shouldResumeListening,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!mountedRef.current) return;
      if (!isCurrentConversation(localConversationId, requestId)) return;

      setError(err?.message || 'David could not respond right now.');
      setPhase('error');
    } finally {
      if (chatAbortControllerRef.current === chatController) {
        clearAbortController(chatAbortControllerRef);
      }

      if (requestIdRef.current === requestId) {
        processingRef.current = false;
      }
    }
  };

  const handleStartConversation = async () => {
    if (!(phaseRef.current === 'idle' || phaseRef.current === 'error' || phaseRef.current === 'ended')) {
      return;
    }

    const nextConversationId = conversationIdRef.current + 1;
    conversationIdRef.current = nextConversationId;
    requestIdRef.current += 1;
    listenSessionIdRef.current += 1;
    conversationActiveRef.current = true;
    processingRef.current = false;

    abortPendingRequests();
    stopListening(true);
    stopCurrentAudio();
    stopVoiceActivity();

    commitMessages([]);
    setTextInput('');
    setLastResponseText('');
    setError(null);
    setPhase('greeting');

    const firstName =
      session?.user?.user_metadata?.full_name ||
      session?.user?.user_metadata?.name ||
      session?.user?.email?.split('@')?.[0];

    const greeting = getVoiceSessionGreeting(firstName);
    setLastResponseText(greeting);

    await playDavidResponseAudio(greeting, {
      conversationId: nextConversationId,
      isGreeting: true,
      resumeListening: true,
    });
  };

  const handleEndConversation = () => {
    if (phaseRef.current === 'checking' || phaseRef.current === 'idle' || phaseRef.current === 'ended') {
      return;
    }

    conversationActiveRef.current = false;
    conversationIdRef.current += 1;
    requestIdRef.current += 1;
    listenSessionIdRef.current += 1;
    processingRef.current = false;

    setError(null);
    abortPendingRequests();
    stopListening(true);
    stopCurrentAudio();
    stopVoiceActivity();
    setTextInput('');
    setPhase('ended');
  };

  const handleTextSubmit = async () => {
    const manualText = textInput;

    if (!manualText.trim()) return;

    if (!conversationActiveRef.current) {
      const manualConversationId = conversationIdRef.current + 1;
      conversationIdRef.current = manualConversationId;
      conversationActiveRef.current = true;
      commitMessages([]);
      setLastResponseText('');
    }

    await submitUserText(manualText, {
      conversationId: conversationIdRef.current,
      resumeListening: false,
    });

    if (conversationActiveRef.current && phaseRef.current !== 'error') {
      conversationActiveRef.current = false;
      setPhase('idle');
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

  const inputIsVisible = phase === 'idle' || phase === 'error' || phase === 'ended';
  const inputIsDisabled =
    phase === 'thinking' ||
    phase === 'speaking' ||
    phase === 'starting' ||
    phase === 'listening' ||
    phase === 'transcribing' ||
    phase === 'greeting';
  const voiceWaveIsActive = phase === 'starting' || phase === 'listening' || phase === 'speaking' || phase === 'greeting';
  const startConversationIsEnabled = phase === 'idle' || phase === 'error' || phase === 'ended';
  const endConversationIsEnabled =
    phase === 'greeting' ||
    phase === 'starting' ||
    phase === 'listening' ||
    phase === 'transcribing' ||
    phase === 'thinking' ||
    phase === 'speaking';
  const voiceWaveLabel =
    phase === 'starting'
      ? 'Opening microphone'
      : phase === 'listening'
        ? 'Listening'
        : phase === 'greeting'
          ? 'David starting'
          : phase === 'speaking'
            ? 'David speaking'
            : 'Voice ready';

  return (
    <View style={styles.outerContainer}>
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
                : phase === 'greeting'
                  ? 'David is starting the conversation...'
                  : phase === 'thinking'
                    ? 'David is reflecting...'
                    : phase === 'starting'
                      ? 'Opening your microphone...'
                    : phase === 'listening'
                      ? 'David is listening...'
                    : phase === 'transcribing'
                      ? 'Sending your words to David...'
                    : phase === 'speaking'
                      ? 'David is speaking...'
                    : phase === 'error'
                      ? 'Something needs attention before David can continue.'
                      : 'Tap Start Conversation when you are ready to speak.'}
          </Text>
        </View>

        <View
          style={[
            styles.voiceWavePanel,
            voiceWaveIsActive && styles.voiceWavePanelActive,
          ]}
          accessibilityRole="image"
          accessibilityLabel={voiceWaveIsActive ? 'Active voice wave' : 'Inactive voice wave'}
        >
          <View style={styles.voiceWaveHeader}>
            <View
              style={[
                styles.voiceWaveDot,
                voiceWaveIsActive && styles.voiceWaveDotActive,
              ]}
            />
            <Text style={styles.voiceWaveLabel}>{voiceWaveLabel}</Text>
          </View>
          <View style={styles.voiceWave}>
            {voiceLevels.map((level, index) => (
              <View
                key={index}
                style={[
                  styles.voiceWaveBar,
                  voiceWaveIsActive && styles.voiceWaveBarActive,
                  {
                    height: voiceWaveIsActive ? 14 + level * 64 : 10 + level * 22,
                    opacity: voiceWaveIsActive ? 0.58 + level * 0.42 : 0.28 + level * 0.2,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.conversationControls}>
          <TouchableOpacity
            style={[
              styles.conversationButton,
              styles.startConversationButton,
              !startConversationIsEnabled && styles.conversationButtonDisabled,
            ]}
            onPress={handleStartConversation}
            disabled={!startConversationIsEnabled}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Start Conversation"
            accessibilityState={{ disabled: !startConversationIsEnabled }}
          >
            <Mic color={startConversationIsEnabled ? '#0b1e3d' : 'rgba(11, 30, 61, 0.42)'} size={18} />
            <Text
              style={[
                styles.conversationButtonText,
                !startConversationIsEnabled && styles.conversationButtonTextDisabled,
              ]}
            >
              Start Conversation
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.conversationButton,
              styles.endConversationButton,
              !endConversationIsEnabled && styles.conversationButtonDisabled,
            ]}
            onPress={handleEndConversation}
            disabled={!endConversationIsEnabled}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="End Conversation"
            accessibilityState={{ disabled: !endConversationIsEnabled }}
          >
            <Square
              color={endConversationIsEnabled ? '#fff8dc' : 'rgba(255, 248, 220, 0.38)'}
              fill={endConversationIsEnabled ? '#fff8dc' : 'rgba(255, 248, 220, 0.16)'}
              size={15}
            />
            <Text
              style={[
                styles.conversationButtonText,
                styles.endConversationButtonText,
                !endConversationIsEnabled && styles.endConversationButtonTextDisabled,
              ]}
            >
              End Conversation
            </Text>
          </TouchableOpacity>
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
  container: {
    minHeight: '100%',
    alignItems: 'center',
    paddingTop: 58,
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
    marginBottom: 18,
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
  voiceWavePanel: {
    width: '100%',
    maxWidth: 620,
    minHeight: 132,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.22)',
    backgroundColor: 'rgba(5, 16, 32, 0.48)',
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 18,
  },
  voiceWavePanelActive: {
    borderColor: 'rgba(245, 215, 122, 0.62)',
    backgroundColor: 'rgba(11, 30, 61, 0.78)',
    shadowColor: '#d4af37',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  voiceWaveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  voiceWaveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(245, 215, 122, 0.28)',
  },
  voiceWaveDotActive: {
    backgroundColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  voiceWaveLabel: {
    color: '#f5d77a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  voiceWave: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  voiceWaveBar: {
    width: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(245, 215, 122, 0.7)',
  },
  voiceWaveBarActive: {
    backgroundColor: '#d4af37',
    shadowColor: '#d4af37',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  conversationControls: {
    width: '100%',
    maxWidth: 620,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  conversationButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  startConversationButton: {
    backgroundColor: '#d4af37',
    borderColor: 'rgba(245, 215, 122, 0.95)',
  },
  endConversationButton: {
    backgroundColor: '#b91c1c',
    borderColor: 'rgba(248, 113, 113, 0.82)',
  },
  conversationButtonDisabled: {
    opacity: 0.46,
  },
  conversationButtonText: {
    color: '#0b1e3d',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  conversationButtonTextDisabled: {
    color: 'rgba(11, 30, 61, 0.42)',
  },
  endConversationButtonText: {
    color: '#fff8dc',
  },
  endConversationButtonTextDisabled: {
    color: 'rgba(255, 248, 220, 0.38)',
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
