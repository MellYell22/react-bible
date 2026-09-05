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

import {
  generateSpeech,
  getDavidVoiceResponse,
  transcribeAudio,
  setVoiceModeActive,
  SPEECH_VOICE_MODE,
} from '../services/ai';
import { useUser } from '../UserContext';
import { createCheckoutSession } from '../services/stripe';
import { trackEvent } from '../services/analytics';
import { hasProAccess, OWNER_EMAIL } from '../utils/tier';
import { prepareDavidTtsPayload } from '../utils/davidSpeechDelivery';
import { detectMoodKeyFromMessages } from '../utils/davidMoodContext';
import { getVoiceSessionGreeting } from '../constants/persona';
import { PLANS } from '../constants';

const IDLE_VOICE_LEVELS = [0.18, 0.26, 0.2, 0.3, 0.22, 0.34, 0.24, 0.31, 0.2];

// Keep the listener sensitive enough for normal laptop/phone microphones.
// The previous threshold could leave the recorder running forever on quieter mics,
// which made David appear to ignore the user after his greeting.
const SPEECH_VOLUME_THRESHOLD = 0.09;
/** Voiced audio must persist this long (cumulative) before it counts as the user
 * actually speaking — a stray TV syllable or clatter no longer arms the recorder. */
const SPEECH_SUSTAIN_MS = 300;
// How long the mic waits after the last voiced audio before deciding the user is
// done. This is pure dead air at the front of every reply, so it is the single
// biggest latency win available without rebuilding the voice pipeline.
//
// 650ms sits just above a normal mid-sentence breath (~300-500ms), so David stops
// stalling without cutting people off. SPEECH_SUSTAIN_MS and MIN_RECORDING_MS
// still guard against a stray noise arming or ending a turn early.
const SILENCE_STOP_MS = 650;
const MIN_RECORDING_MS = 700;
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
  /** Fired when audio actually starts (or when voice is unavailable) so text appears with the voice, not before it. */
  onPlaybackStart?: () => void;
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

const isMeaningfulUserText = (value: string, source: 'voice' | 'typed' = 'voice'): boolean => {
  const text = normalizeTranscript(value);
  if (!text) return false;

  // Typed text is always intentional — the noise filter below exists only to
  // keep mic artifacts (coughs, TV, room tone) from becoming a turn.
  if (source === 'typed') return /[a-zA-Z0-9]/.test(text);

  const lowered = text.toLowerCase();
  // Short conversational replies ("yeah", "okay", "not really", "thanks",
  // "I'm tired") are real turns and must reach David. Only pure filler
  // vocalizations and nonverbal noise are filtered here.
  const junkPatterns = [
    /^[\s.…,!?*-]+$/,
    /^(um+|uh+|mm+|mhm+|ah+|er+)[.!?\s]*$/i,
    /^(music|applause|\[silence\]|\[music\]|\[inaudible\])$/i,
    /^(cough|coughing|sniff|sniffle|sniffling|sneeze|sneezing|achoo|ahem|yawn|yawning)[.!?\s]*$/i,
    /^(laugh|laughing|laughter|giggle|giggling|chuckle|chuckling)[.!?\s]*$/i,
    /^(clear(?:s|ed|ing)? throat|throat clear(?:ing)?|sigh|sighing|breath|breathing|inhale|exhale)[.!?\s]*$/i,
    /^(background noise|room noise|noise|static|television|tv)[.!?\s]*$/i,
  ];

  if (junkPatterns.some(pattern => pattern.test(lowered))) return false;

  // One meaningful word is enough in a live conversation. Requiring two words
  // caused perfectly valid replies such as "hello", "sad", and "help" to be
  // discarded, which made David look unresponsive.
  const letters = text.replace(/[^a-zA-Z]/g, '');
  return letters.length >= 2;
};

export default function VoiceScreen() {
  const { profile, session, loading: userContextLoading } = useUser();

  const [phase, setPhaseState] = useState<ScreenPhase>('checking');
  const [textInput, setTextInput] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [lastResponseText, setLastResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(IDLE_VOICE_LEVELS);
  const [upgradeLoading, setUpgradeLoading] = useState(false);

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
  const voicedMsRef = useRef(0);
  const lastVadTickAtRef = useRef<number | null>(null);

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

        if (options.monitorSilence && conversationActiveRef.current) {
          const lastTickAt = lastVadTickAtRef.current;
          const deltaMs = lastTickAt === null ? 0 : Math.min(now - lastTickAt, 100);
          lastVadTickAtRef.current = now;

          if (normalizedVolume >= SPEECH_VOLUME_THRESHOLD) {
            // Only count it as the user speaking once voiced audio has been
            // sustained — brief background sounds (TV, clatter) decay away.
            voicedMsRef.current += deltaMs;
            if (voicedMsRef.current >= SPEECH_SUSTAIN_MS) {
              speechDetectedRef.current = true;
            }
            if (speechDetectedRef.current) {
              lastSpeechAtRef.current = now;
            }
          } else {
            voicedMsRef.current = Math.max(0, voicedMsRef.current - deltaMs * 0.5);
          }

          const elapsed = now - recordingStartedAtRef.current;
          const silenceElapsed = lastSpeechAtRef.current ? now - lastSpeechAtRef.current : 0;
          const localConversationId = options.conversationId ?? conversationIdRef.current;
          const localListenSessionId = options.listenSessionId ?? listenSessionIdRef.current;

          if (
            !autoStopTriggeredRef.current &&
            mediaRecorderRef.current?.state === 'recording' &&
            isCurrentConversation(localConversationId) &&
            listenSessionIdRef.current === localListenSessionId
          ) {
            const shouldAutoStopForSilence =
              speechDetectedRef.current &&
              elapsed >= MIN_RECORDING_MS &&
              silenceElapsed >= SILENCE_STOP_MS;

            const shouldAutoStopForHardLimit = elapsed >= HARD_MAX_RECORDING_MS;

            if (shouldAutoStopForSilence || shouldAutoStopForHardLimit) {
              autoStopTriggeredRef.current = true;
              setPhase('transcribing');
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

  const startListening = async (options: { conversationId?: number } = {}) => {
    const localConversationId = options.conversationId ?? conversationIdRef.current;

    if (!isCurrentConversation(localConversationId)) {
      return;
    }

    if (Platform.OS !== 'web') {
      setError('Microphone input is available in the web preview.');
      setPhase('error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser does not support microphone recording. Use Chrome or Edge and allow microphone access.');
      setPhase('error');
      return;
    }

    abortPendingRequests();
    stopCurrentAudio();
    setError(null);
    setPhase('starting');
    startSyntheticVoiceActivity();

    let pendingStream: MediaStream | null = null;
    const localListenSessionId = listenSessionIdRef.current + 1;
    listenSessionIdRef.current = localListenSessionId;

    try {
      // Explicit constraints: echo cancellation keeps David from hearing his own
      // voice; noise suppression tames background hum; auto-gain OFF stops the
      // browser from amplifying quiet room audio (TV, music) up to speech level.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      pendingStream = stream;

      if (!isCurrentConversation(localConversationId) || listenSessionIdRef.current !== localListenSessionId) {
        stream.getTracks().forEach(track => track.stop());
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
      voicedMsRef.current = 0;
      lastVadTickAtRef.current = null;

      startVoiceActivity(stream, {
        monitorSilence: true,
        conversationId: localConversationId,
        listenSessionId: localListenSessionId,
      });

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        if (!mountedRef.current) return;
        stopVoiceActivity();
        setError('David had trouble accessing the microphone. Allow microphone access for this site, then try again.');
        setPhase('error');
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        stopVoiceActivity();

        if (!mountedRef.current || discardRecordingRef.current) {
          discardRecordingRef.current = false;
          return;
        }

        if (!isCurrentConversation(localConversationId) || listenSessionIdRef.current !== localListenSessionId) {
          return;
        }

        // Silence is not a turn. If the user never produced sustained speech,
        // do not send room tone, a cough, or a random sound to transcription.
        // Just keep listening quietly until the user actually speaks.
        if (!speechDetectedRef.current) {
          setError(null);
          setPhase('listening');
          void startListening({ conversationId: localConversationId });
          return;
        }

        if (!chunks.length) {
          setError(null);
          setPhase('listening');
          void startListening({ conversationId: localConversationId });
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

          if (!isCurrentConversation(localConversationId) || listenSessionIdRef.current !== localListenSessionId) {
            return;
          }

          const transcript = normalizeTranscript(result.transcript);
          if (result.rejected || !isMeaningfulUserText(transcript)) {
            // Nonverbal sounds and low-confidence transcripts are ignored.
            // David should never answer a cough, sniffle, laugh, throat-clear,
            // silence, or background noise as if the user spoke to him.
            setError(null);
            setPhase('listening');
            void startListening({ conversationId: localConversationId });
            return;
          }

          setTextInput(transcript);
          await submitUserText(transcript, {
            conversationId: localConversationId,
            resumeListening: true,
          });
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          if (!mountedRef.current) return;
          if (!isCurrentConversation(localConversationId)) return;

          setError(err?.message || "David couldn't transcribe that audio.");
          setPhase('error');
        } finally {
          if (transcribeAbortControllerRef.current === transcribeController) {
            clearAbortController(transcribeAbortControllerRef);
          }
        }
      };

      recorder.start();
      setPhase('listening');
    } catch (err: any) {
      if (!mountedRef.current) return;
      pendingStream?.getTracks().forEach(track => track.stop());
      stopVoiceActivity();
      const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      setError(
        denied
          ? 'Microphone access is blocked for this site. Allow microphone access and try again.'
          : 'David could not start listening. Check that your microphone is available.',
      );
      setPhase('error');
    }
  };

  /**
   * Plays one already-rendered audio clip and resolves when it finishes.
   * Extracted so the streaming queue below can play David's sentences
   * back-to-back without duplicating the lifecycle bookkeeping.
   */
  const playClipUrl = (audioUrl: string, onStart?: () => void): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const audio = new Audio(audioUrl);
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        currentAudioRef.current = null;
        currentAudioUrlRef.current = null;
        audioStopResolverRef.current = null;
        try {
          URL.revokeObjectURL(audioUrl);
        } catch {
          // Ignore revoke errors.
        }
        resolve();
      };

      currentAudioRef.current = audio;
      currentAudioUrlRef.current = audioUrl;
      audioStopResolverRef.current = finish;
      audio.preload = 'auto';
      audio.volume = 0.82;
      audio.onended = finish;
      audio.onerror = () => {
        finish();
        reject(new Error("David's voice audio was returned, but the browser could not play it."));
      };
      audio.play().then(() => onStart?.()).catch(reject);
    });

  /**
   * David's reply, spoken sentence by sentence as he writes it.
   *
   * Two things run at once: text-to-speech renders upcoming sentences while the
   * current one is still playing. That overlap is the whole point — the user
   * hears his first sentence roughly a full generation cycle sooner than before.
   *
   * Returns false if nothing was ever spoken, so the caller can fall back to
   * the original one-shot path instead of leaving the user in silence.
   */
  const createStreamingSpeaker = (options: {
    conversationId: number;
    requestId: number;
    signal: AbortSignal;
    onFirstAudio?: () => void;
  }) => {
    const clips: Array<Promise<string | null>> = [];
    let closed = false;
    let wake: (() => void) | null = null;
    let spokeAnything = false;

    const nudge = () => {
      wake?.();
      wake = null;
    };

    /** Start rendering a sentence immediately; do not wait for it. */
    const push = (sentence: string) => {
      const prepared = prepareDavidTtsPayload(sentence, { isGreeting: false }).speechText;
      if (!prepared.trim()) return;
      clips.push(
        generateSpeech(prepared, {
          alreadyPrepared: true,
          signal: options.signal,
          source: SPEECH_VOICE_MODE,
        }).catch((error) => {
          console.log('[David Voice] A sentence failed to render; continuing:', error);
          return null;
        }),
      );
      nudge();
    };

    const close = () => {
      closed = true;
      nudge();
    };

    /** Drains the queue in order, waiting for more while the stream is open. */
    const play = async (): Promise<boolean> => {
      let index = 0;

      while (true) {
        if (index >= clips.length) {
          if (closed) break;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const url = await clips[index];
        index += 1;

        if (!isCurrentConversation(options.conversationId, options.requestId)) return spokeAnything;
        if (options.signal.aborted) return spokeAnything;
        if (!url || Platform.OS !== 'web') continue;

        await playClipUrl(url, () => {
          if (!spokeAnything) {
            spokeAnything = true;
            options.onFirstAudio?.();
          }
        });
      }

      return spokeAnything;
    };

    return { push, close, play };
  };

  const playDavidResponseAudio = async (
    text: string,
    options: PlayDavidAudioOptions,
  ) => {
    if (!text.trim()) {
      if (options.resumeListening && isCurrentConversation(options.conversationId, options.requestId)) {
        void startListening({ conversationId: options.conversationId });
      } else if (isCurrentConversation(options.conversationId, options.requestId)) {
        setPhase('idle');
      }
      return;
    }

    if (!isCurrentConversation(options.conversationId, options.requestId)) {
      return;
    }

    stopListening(true);
    stopCurrentAudio();
    setPhase(options.isGreeting ? 'greeting' : 'speaking');

    const speechController = new AbortController();
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = speechController;

    try {
      const preparedText = prepareDavidTtsPayload(text, {
        isGreeting: options.isGreeting,
      }).speechText;

      const requestDavidAudio = () => generateSpeech(preparedText, {
        alreadyPrepared: true,
        signal: speechController.signal,
        source: SPEECH_VOICE_MODE,
      });

      let audioUrl: string | null;
      try {
        audioUrl = await requestDavidAudio();
      } catch (firstError: any) {
        const firstMessage = `${firstError?.message || firstError || ''}`;
        const looksLikeTemporaryNetworkFailure =
          /load failed|failed to fetch|network|networkerror|connection/i.test(firstMessage);

        if (!looksLikeTemporaryNetworkFailure || speechController.signal.aborted) {
          throw firstError;
        }

        // Safari/Chrome can occasionally throw a one-off network "Load failed"
        // while the local/serverless route is waking up. Retry once before
        // surfacing an error to the user.
        await new Promise(resolve => setTimeout(resolve, 450));
        if (speechController.signal.aborted) {
          const abortError = new Error('Request was cancelled.');
          abortError.name = 'AbortError';
          throw abortError;
        }
        audioUrl = await requestDavidAudio();
      }

      if (speechAbortControllerRef.current === speechController) {
        clearAbortController(speechAbortControllerRef);
      }

      if (!isCurrentConversation(options.conversationId, options.requestId)) {
        return;
      }

      if (!audioUrl || Platform.OS !== 'web') {
        // Voice unavailable — show the text so the response is not lost.
        options.onPlaybackStart?.();
        if (options.resumeListening) {
          setPhase('listening');
          void startListening({ conversationId: options.conversationId });
          return;
        }
        setPhase('idle');
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(audioUrl);
        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;

          currentAudioRef.current = null;
          currentAudioUrlRef.current = null;
          audioStopResolverRef.current = null;

          try {
            URL.revokeObjectURL(audioUrl);
          } catch {
            // Ignore revoke errors.
          }

          resolve();
        };

        currentAudioRef.current = audio;
        currentAudioUrlRef.current = audioUrl;
        audioStopResolverRef.current = finish;
        audio.preload = 'auto';
        // Keep David present and close without sounding like he is shouting.
        // Do this only for David's voice instead of globally changing every
        // audio element in the app.
        audio.volume = 0.82;
        audio.onended = finish;
        audio.onerror = () => {
          finish();
          reject(new Error("David's voice audio was returned, but the browser could not play it."));
        };
        audio
          .play()
          .then(() => {
            options.onPlaybackStart?.();
          })
          .catch(reject);
      });

      if (!isCurrentConversation(options.conversationId, options.requestId)) {
        return;
      }

      if (options.resumeListening) {
        setPhase('listening');
        void startListening({ conversationId: options.conversationId });
      } else {
        setPhase('idle');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!mountedRef.current) return;
      if (!isCurrentConversation(options.conversationId, options.requestId)) return;

      // Speech failed — still show the text so the response is not lost.
      options.onPlaybackStart?.();
      const message = `${err?.message || ''}`;
      const friendlyMessage = /load failed|failed to fetch|network|networkerror|connection/i.test(message)
        ? "David's voice connection had a brief problem. Tap Start Conversation and try again."
        : message || 'David had trouble speaking that response.';
      setError(friendlyMessage);
      setPhase('error');
    } finally {
      if (speechAbortControllerRef.current === speechController) {
        clearAbortController(speechAbortControllerRef);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      conversationActiveRef.current = false;
      abortPendingRequests();
      stopListening(true);
      stopVoiceActivity();
      stopCurrentAudio();
      // Leaving the voice screen ends voice mode, so nothing can speak after.
      setVoiceModeActive(false);
    };
  }, []);

  useEffect(() => {
    if (userContextLoading) return;
    if (hasVoiceAccess) {
      // This screen is the only place voice mode is ever switched on.
      setVoiceModeActive(true);
      setPhase(current => (current === 'checking' ? 'idle' : current));
      return;
    }

    setVoiceModeActive(false);
    setPhase('idle');
  }, [hasVoiceAccess, userContextLoading]);

  const submitUserText = async (
    rawText: string,
    options: {
      conversationId?: number;
      resumeListening?: boolean;
      source?: 'voice' | 'typed';
    } = {},
  ) => {
    const userText = normalizeTranscript(rawText);
    if (!isMeaningfulUserText(userText, options.source || 'voice')) {
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

      // David speaks his first sentence while he is still forming the rest.
      // Text-to-speech for each sentence starts the moment that sentence is
      // complete, so the user stops waiting through a whole generation cycle
      // before hearing anything.
      const speechController = new AbortController();
      speechAbortControllerRef.current?.abort();
      speechAbortControllerRef.current = speechController;

      let firstAudioPlayed = false;
      const speaker = createStreamingSpeaker({
        conversationId: localConversationId,
        requestId,
        signal: speechController.signal,
        onFirstAudio: () => {
          firstAudioPlayed = true;
          setPhase('speaking');
        },
      });

      // Stop the mic before any audio starts, or David hears himself.
      stopListening(true);
      stopCurrentAudio();

      const playbackDone = speaker.play().catch((error) => {
        console.log('[David Voice] Streamed playback failed:', error);
        return firstAudioPlayed;
      });

      let response;
      try {
        response = await getDavidVoiceResponse(nextMessages, {
          responseLength: 'short',
          moodKey: detectedMoodKey,
          usedVerses,
          userId,
          liveVoice: true,
          signal: chatController.signal,
          onSentence: (sentence) => {
            if (!isCurrentConversation(localConversationId, requestId)) return;
            speaker.push(sentence);
          },
        });
      } finally {
        // Always close the queue, or the player would wait forever.
        speaker.close();
      }

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

      const spoke = await playbackDone;

      if (!spoke) {
        // Streaming produced no audio (no sentences, a TTS failure, or a
        // non-web platform). Fall back to the original one-shot path so the
        // user is never left with a silent David.
        await playDavidResponseAudio(cleanedResponse, {
          conversationId: localConversationId,
          requestId,
          isGreeting: false,
          resumeListening: shouldResumeListening,
          onPlaybackStart: () => setLastResponseText(cleanedResponse),
        });
        return;
      }

      if (!isCurrentConversation(localConversationId, requestId)) return;

      if (shouldResumeListening) {
        setPhase('listening');
        void startListening({ conversationId: localConversationId });
      } else {
        setPhase('idle');
      }
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

    await playDavidResponseAudio(greeting, {
      conversationId: nextConversationId,
      isGreeting: true,
      resumeListening: true,
      onPlaybackStart: () => setLastResponseText(greeting),
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

  const handleUpgradeToPro = async () => {
    if (upgradeLoading) return;

    setError(null);

    if (!session?.user) {
      setError('Please sign in from the Profile tab before upgrading to Pro.');
      return;
    }

    // Verify the session token is still valid before hitting the Edge Function
    try {
      const { supabase: sb } = await import('../services/supabase');
      if (sb) {
        const { error: authError } = await sb.auth.getUser();
        if (authError) {
          setError('Your session has expired. Please sign out and sign back in, then try again.');
          return;
        }
      }
    } catch {
      // If we can't verify, let the Edge Function handle it
    }

    try {
      setUpgradeLoading(true);
      trackEvent('checkout_started', { plan: 'pro', from: 'voice' });
      await createCheckoutSession();
    } catch (err: any) {
      setError(err?.message || 'Unable to start checkout right now.');
    } finally {
      setUpgradeLoading(false);
    }
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
      source: 'typed',
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
          <Lock color="#d4af37" size={48} style={{ marginBottom: 20 }} />
          <Text style={styles.lockTitle} role="heading" aria-level={1}>David's Voice Pro</Text>
          <Text style={styles.lockText}>
            Live voice with David is a {PLANS.PRO.name} feature — {PLANS.PRO.price}/{PLANS.PRO.interval}.
          </Text>
          <TouchableOpacity
            style={[
              styles.lockUpgradeButton,
              upgradeLoading && styles.lockUpgradeButtonDisabled,
            ]}
            onPress={handleUpgradeToPro}
            disabled={upgradeLoading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Upgrade to ${PLANS.PRO.name}, ${PLANS.PRO.price} per ${PLANS.PRO.interval}`}
          >
            <Text style={styles.lockUpgradeButtonText}>
              {upgradeLoading
                ? 'Starting checkout...'
                : `Get ${PLANS.PRO.name} — ${PLANS.PRO.price}/${PLANS.PRO.interval}`}
            </Text>
          </TouchableOpacity>
          <Text style={styles.lockUpgradeHint}>Unlock live voice chat with David.</Text>
          {error && (
            <View style={styles.lockErrorBanner}>
              <Text style={styles.lockErrorText}>{error}</Text>
            </View>
          )}
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
  // The animated wave itself conveys activity; we no longer narrate the phase
  // ("Listening" / "David speaking" / etc.) as an on-screen status indicator.
  const voiceWaveLabel = '';

  return (
    <View style={styles.outerContainer}>
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Sparkles color="#d4af37" size={24} />
          <Text style={styles.title} role="heading" aria-level={1}>Voice with David</Text>
          <Text style={styles.subtitle}>A calm spiritual companion</Text>
        </View>

        {(() => {
          // Intermediate conversational phases (greeting/thinking/starting/
          // listening/transcribing/speaking) intentionally show NO status text.
          // The flow is simply: the user speaks, David processes, David responds —
          // with no "David is listening / thinking / reflecting" narration.
          const statusMessage =
            phase === 'checking'
              ? 'Getting David ready...'
              : phase === 'ended'
                ? 'Call ended. Start again when you are ready.'
                : phase === 'error'
                  ? 'Something needs attention before David can continue.'
                  : phase === 'idle'
                    ? 'Tap Start Conversation when you are ready to speak.'
                    : '';
          if (!statusMessage) return null;
          return (
            <View style={styles.statusContainer}>
              <Text style={styles.statusText}>{statusMessage}</Text>
            </View>
          );
        })()}

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
            {voiceWaveLabel ? (
              <Text style={styles.voiceWaveLabel}>{voiceWaveLabel}</Text>
            ) : null}
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
                role="button"
                aria-label="Send message to David"
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
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: 'rgba(7, 22, 43, 0.72)',
    position: 'relative',
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
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
    backgroundColor: 'rgba(7, 22, 43, 0.72)',
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
    fontFamily: 'Playfair Display',
    fontSize: 24,
    color: '#d4af37',
    marginBottom: 10,
    textAlign: 'center',
  },
  lockText: {
    fontFamily: 'Playfair Display',
    fontSize: 15,
    lineHeight: 22,
    color: '#f5d77a',
    textAlign: 'center',
  },
  lockUpgradeButton: {
    marginTop: 20,
    minHeight: 52,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: '#d4af37',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  lockUpgradeButtonDisabled: {
    opacity: 0.6,
  },
  lockUpgradeButtonText: {
    fontFamily: 'Cinzel',
    color: '#0b1e3d',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  lockUpgradeHint: {
    fontFamily: 'Playfair Display',
    marginTop: 10,
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(245, 215, 122, 0.78)',
    textAlign: 'center',
  },
  lockErrorBanner: {
    width: '100%',
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(127, 29, 29, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
  },
  lockErrorText: {
    fontFamily: 'Playfair Display',
    color: '#fecaca',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 34,
  },
  title: {
    fontFamily: 'Playfair Display',
    fontSize: 24,
    fontWeight: 'bold',
    color: '#d4af37',
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Cinzel',
    fontSize: 12,
    fontWeight: '700',
    color: '#f5d77a',
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  statusContainer: {
    width: '100%',
    maxWidth: 520,
    minHeight: 66,
    marginBottom: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 30, 61, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.22)',
  },
  statusText: {
    fontFamily: 'Playfair Display',
    color: '#f5d77a',
    fontSize: 14,
    lineHeight: 22,
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
    boxShadow: '0 10px 22px rgba(212, 175, 55, 0.22)',
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
    boxShadow: '0 0 10px rgba(34, 197, 94, 0.7)',
  },
  voiceWaveLabel: {
    fontFamily: 'Cinzel',
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
    boxShadow: '0 4px 8px rgba(212, 175, 55, 0.35)',
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
    borderWidth: 1.5,
    borderColor: 'rgba(248, 113, 113, 0.82)',
  },
  conversationButtonDisabled: {
    opacity: 0.46,
  },
  conversationButtonText: {
    fontFamily: 'Cinzel',
    color: '#0b1e3d',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
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
    fontFamily: 'Cinzel',
    color: '#d4af37',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  responseText: {
    fontFamily: 'Playfair Display',
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
    fontFamily: 'Cinzel',
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
    paddingVertical: 10,
    color: '#fff8dc',
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    fontFamily: 'Playfair Display',
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
    fontFamily: 'Playfair Display',
    color: '#fecaca',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  disclaimer: {
    width: '100%',
    maxWidth: 620,
    fontFamily: 'Playfair Display',
    color: 'rgba(245, 215, 122, 0.72)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
  },
});
