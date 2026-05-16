import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView, TextInput } from 'react-native';
import { Mic, MicOff, Lock, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";

const MotionView = motion(View);
import { ChatMessage } from '../types';
import { getChatResponse, generateSpeech } from '../services/ai';
import { hasProAccess, OWNER_EMAIL } from '../utils/tier';
import { saveAIFeedback } from '../services/supabase';
import { useUser } from '../UserContext';
import {
  isJunkTranscript,
  isMeaningfulTranscript,
  isDuplicateTranscript,
  looksLikeOpeningGreeting,
  looksLikeBannedTherapyPhrase,
  normalizeTranscript,
} from '../utils/voiceTranscript';
import { getVoiceSessionGreeting, DAVID_ANTI_REPEAT_FALLBACKS } from '../constants/davidPersona';
import { humanizeForTts, preSpeechThinkingDelay } from '../utils/davidSpeechDelivery';

const TTS_START_TIMEOUT_MS = 2000;
const POST_GREETING_MIC_DELAY_MS = 400;

// ─── Logging ────────────────────────────────────────────────────────────────
// All voice events are prefixed with [David] for easy filtering in DevTools.
const log = (event: string, detail?: any) => {
  const msg = detail !== undefined
    ? `[David] ${event}: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`
    : `[David] ${event}`;
  console.log(msg);
  return msg;
};

// ─── David opening greetings (natural, warm, brief) ────────────────────────
const GENERIC_NAME_REJECTIONS = new Set([
  'admin', 'app', 'apps', 'bible', 'customer', 'david', 'email', 'gmail',
  'guest', 'hotmail', 'icloud', 'info', 'mail', 'me', 'outlook', 'test',
  'user', 'username', 'yahoo'
]);

const cleanFirstName = (value?: string | null): string => {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();

  // Never turn an email address, email prefix, handle, domain fragment, or
  // machine-style username into a spoken name. A bad name breaks immersion;
  // no name is always better than the wrong one.
  if (!trimmed || trimmed.includes('@') || /[._0-9]/.test(trimmed)) return '';

  const first = trimmed.split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, '') || '';
  const normalized = first.toLowerCase();

  if (first.length < 2 || first.length > 20) return '';
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(first)) return '';
  if (GENERIC_NAME_REJECTIONS.has(normalized)) return '';

  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

// David personality prompt: src/constants/davidPersona.ts (api/chat.ts + server.ts)

export default function VoiceScreen({ route, navigation }: any) {
  const { profile, session } = useUser();

  // ── Conversation state machine ────────────────────────────────────────────
  // idle: not connected
  // starting: connecting but not yet listening
  // listening: mic is active, waiting for user speech
  // processing: transcribing or AI is thinking
  // speaking: David is speaking
  // ended: session closed
  const [conversationState, setConversationState] = useState<'idle' | 'starting' | 'listening' | 'processing' | 'speaking' | 'ended'>('idle');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isDavidThinking, setIsDavidThinking] = useState(false);
  const [isDavidSpeaking, setIsDavidSpeaking] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastResponseText, setLastResponseText] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastFeedback, setLastFeedback] = useState<'up' | 'down' | null>(null);
  // Text fallback when speech recognition fails
  const [textInput, setTextInput] = useState('');
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [micErrorCount, setMicErrorCount] = useState(0);

  // ── Refs (never stale inside callbacks) ──────────────────────────────────
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isConnectedRef = useRef(false);
  const isDavidSpeakingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Retry tracking for speech recognition network errors
  const micRetryCountRef = useRef(0);
  const MAX_MIC_RETRIES = 1; // Show text fallback after 1 network failure (network errors are persistent)
  // Silence / speech-end detection (MediaRecorder + AudioContext)
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingVoiceRef = useRef(false);
  const lastTranscriptRef = useRef<string>('');
  const emptyTranscriptStreakRef = useRef(0);
  const listenRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const hasGreetedRef = useRef(false);
  const lastResponseAtRef = useRef(0);
  const recentTranscriptsRef = useRef<string[]>([]);
  const sessionGenerationRef = useRef(0);

  // RMS thresholds — tuned to ignore breath/cough bursts, require sustained speech
  const SPEECH_RMS_THRESHOLD = 0.024;
  const SILENCE_RMS_THRESHOLD = 0.007;
  const SILENCE_DURATION_MS = 2000;
  const MIN_SPEECH_MS = 900;
  const MIN_SUSTAINED_SPEECH_FRAMES = 6;
  const MIN_RECORDING_MS = 2000;
  const MIN_AUDIO_BYTES = 5000;
  const POST_TTS_MIC_DELAY_MS = 1000;
  const RESPONSE_COOLDOWN_MS = 1500;
  const MIC_RESTART_BASE_MS = 900;
  const MIC_RESTART_MAX_MS = 4500;
  const NO_SPEECH_DISCARD_MS = 15000;

  // ── Logging helper (also pushes to on-screen debug panel) ────────────────
  const addLog = (msg: string) => {
    const full = log(msg);
    setDebugLogs(prev => [full, ...prev].slice(0, 30));
  };

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const isInResponseCooldown = (): boolean => {
    const elapsed = Date.now() - lastResponseAtRef.current;
    return lastResponseAtRef.current > 0 && elapsed < RESPONSE_COOLDOWN_MS;
  };

  const markResponseCompleted = () => {
    lastResponseAtRef.current = Date.now();
  };

  const clearListenRetry = () => {
    if (listenRetryTimeoutRef.current) {
      clearTimeout(listenRetryTimeoutRef.current);
      listenRetryTimeoutRef.current = null;
    }
  };

  /** Re-open mic only when safe; backs off after empty/junk transcripts. */
  const scheduleListenRetry = (reason: string) => {
    if (!isConnectedRef.current) return;
    if (isDavidSpeakingRef.current || isProcessingVoiceRef.current) return;

    clearListenRetry();
    const streak = emptyTranscriptStreakRef.current;
    const delay = Math.min(
      MIC_RESTART_MAX_MS,
      MIC_RESTART_BASE_MS + streak * 400,
    );
    addLog(`${reason} — retry mic in ${delay}ms`);
    listenRetryTimeoutRef.current = setTimeout(() => {
      listenRetryTimeoutRef.current = null;
      if (isConnectedRef.current && !isDavidSpeakingRef.current && !isProcessingVoiceRef.current) {
        startListening();
      }
    }, delay);
  };

  const hasVoiceAccess = (): boolean => {
    if (profile && hasProAccess(profile)) return true;
    const email = session?.user?.email?.toLowerCase();
    return email === OWNER_EMAIL.toLowerCase();
  };

  const getFirstNameFromSession = (): string => {
    const metadata = session?.user?.user_metadata || {};
    const identityData = session?.user?.identities?.[0]?.identity_data || {};
    return cleanFirstName(metadata.first_name)
      || cleanFirstName(metadata.given_name)
      || cleanFirstName(metadata.full_name)
      || cleanFirstName(metadata.name)
      || cleanFirstName(identityData.first_name)
      || cleanFirstName(identityData.given_name)
      || cleanFirstName(identityData.full_name)
      || cleanFirstName(identityData.name)
      || '';
  };

  const isSessionGenerationActive = (generation: number): boolean =>
    sessionGenerationRef.current === generation && isConnectedRef.current;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    checkApiKey();
    return () => {
      cleanupSessionResources('component_unmount');
    };
  }, []);

  // ── API key check (AI Studio env only) ───────────────────────────────────
  const checkApiKey = async () => {
    if ((window as any).aistudio) {
      const selected = await (window as any).aistudio.hasSelectedApiKey();
      setHasKey(selected);
    }
  };

  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  // ── Mobile autoplay unlock ────────────────────────────────────────────────
  // iOS Safari and some Android browsers block audio.play() unless triggered
  // directly inside a user-gesture handler. We prime a silent AudioContext on
  // the first user tap so subsequent programmatic play() calls are allowed.
  const unlockAudioContext = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioCtx();
        addLog('AudioContext unlocked for mobile autoplay');
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().then(() => addLog('AudioContext resumed'));
      }
    } catch (e) {
      addLog(`AudioContext unlock error: ${e}`);
    }
  };

  const beginListeningAfterGreeting = (generation: number) => {
    if (!isSessionGenerationActive(generation)) return;
    setIsConnecting(false);
    setConversationState('listening');
    setTimeout(() => {
      if (isSessionGenerationActive(generation)) {
        startListening();
      }
    }, POST_GREETING_MIC_DELAY_MS);
  };

  /** Opening greeting — sync pick, async TTS without blocking session lifecycle */
  const playOpeningGreeting = async (greeting: string, generation: number) => {
    if (!isSessionGenerationActive(generation)) return;

    isDavidSpeakingRef.current = true;
    setIsDavidSpeaking(true);
    setConversationState('speaking');
    log('TTS started', greeting);

    try {
      const ttsPromise = generateSpeech(greeting, { isGreeting: true, skipHumanize: true });
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), TTS_START_TIMEOUT_MS);
      });
      const audioUrl = await Promise.race([ttsPromise, timeoutPromise]);

      if (!isSessionGenerationActive(generation)) return;

      if (!audioUrl) {
        log('TTS timeout or failed — continuing without blocking');
        addLog('Greeting audio unavailable — mic opening');
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        markResponseCompleted();
        beginListeningAfterGreeting(generation);
        return;
      }

      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      audio.preload = 'auto';

      const finishGreeting = () => {
        if (!isSessionGenerationActive(generation)) return;
        log('TTS finished');
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        markResponseCompleted();
        beginListeningAfterGreeting(generation);
      };

      audio.onended = finishGreeting;
      audio.onerror = () => {
        log('TTS playback error — opening mic');
        finishGreeting();
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((playErr: any) => {
          log('TTS play() rejected', playErr?.message);
          finishGreeting();
        });
      }
    } catch (err: any) {
      log('TTS exception', err?.message);
      if (!isSessionGenerationActive(generation)) return;
      isDavidSpeakingRef.current = false;
      setIsDavidSpeaking(false);
      markResponseCompleted();
      beginListeningAfterGreeting(generation);
    }
  };

  // ── Start session ─────────────────────────────────────────────────────────
  const startSession = () => {
    log('Start Conversation button pressed');

    if (!hasVoiceAccess()) {
      alert('Voice chat is a Pro feature. Please upgrade to access.');
      return;
    }

    unlockAudioContext();

    const generation = ++sessionGenerationRef.current;

    setIsConnecting(true);
    setConversationState('starting');
    setMessages([]);
    setError(null);
    setIsDavidThinking(false);
    setIsDavidSpeaking(false);
    isDavidSpeakingRef.current = false;
    isProcessingVoiceRef.current = false;
    lastTranscriptRef.current = '';
    recentTranscriptsRef.current = [];
    lastResponseAtRef.current = 0;
    hasGreetedRef.current = false;
    emptyTranscriptStreakRef.current = 0;
    clearListenRetry();

    isConnectedRef.current = true;
    setIsConnected(true);
    setIsConnecting(false);

    log('session started', { generation });

    if (hasGreetedRef.current) {
      log('greeting skipped', 'already greeted this session');
      beginListeningAfterGreeting(generation);
      return;
    }

    const firstName = getFirstNameFromSession();
    // Greetings use force:true — no filler prefixes (mm…, heh.) or ellipsis pauses.
    // Humanization is intentionally disabled here because greetings are already
    // written to sound natural, and prefixes like "heh. hey. how's your day been?"
    // sound awkward as an opening line.
    const greeting = humanizeForTts(getVoiceSessionGreeting(firstName || undefined), {
      isGreeting: false,
      force: true,
    });
    hasGreetedRef.current = true;

    log('greeting triggered', greeting);
    addLog(`David: ${greeting}`);
    setMessages([{ role: 'assistant', content: greeting }]);
    setLastResponseText(greeting);

    void playOpeningGreeting(greeting, generation);
  };

  // ── Transcript filter helpers ────────────────────────────────────────────
  // Words that are filler/noise and should not trigger an AI response on their own.
  const FILLER_WORDS = new Set([
    'um', 'uh', 'hmm', 'hm', 'ah', 'oh', 'er', 'like',
    'yeah', 'yep', 'yup', 'okay', 'ok', 'alright', 'right',
    'hello', 'hey', 'hi', 'bye', 'goodbye',
    'thanks', 'thank', 'please', 'sure', 'fine', 'good', 'great',
    'yes', 'no', 'nope', 'maybe',
  ]);

  // Returns true if the transcript is meaningful enough to send to OpenAI.
  const isTranscriptMeaningful = (raw: string): boolean => {
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9\s']/g, '');
    if (!cleaned) return false;

    const words = cleaned.split(/\s+/).filter(w => w.length > 0);

    // Fewer than 4 words — check if any are non-filler
    if (words.length < 4) {
      const meaningfulWords = words.filter(w => !FILLER_WORDS.has(w));
      if (meaningfulWords.length === 0) return false;
    }

    return true;
  };

  // Track the last David response for anti-repeat logic
  const lastDavidResponseRef = useRef<string>('');

  // Similarity check: returns true if two strings share > 60% of their words
  const isTooSimilar = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = b.toLowerCase().split(/\s+/);
    const overlap = wordsB.filter(w => wordsA.has(w)).length;
    const similarity = overlap / Math.max(wordsA.size, wordsB.length);
    return similarity > 0.6;
  };

  const ANTI_REPEAT_FALLBACKS = DAVID_ANTI_REPEAT_FALLBACKS;

  // ── Handle voice input (transcript → AI → TTS) ────────────────────────────
  const handleVoiceInput = async (text: string) => {
    const trimmedText = text.trim();

    if (isInResponseCooldown()) {
      addLog('Ignored — response cooldown active');
      setConversationState('listening');
      scheduleListenRetry('Response cooldown');
      return;
    }

    if (
      !trimmedText ||
      isJunkTranscript(trimmedText) ||
      !isMeaningfulTranscript(trimmedText) ||
      !isTranscriptMeaningful(trimmedText)
    ) {
      emptyTranscriptStreakRef.current += 1;
      addLog('Rejected transcript (not meaningful)');
      setConversationState('listening');
      scheduleListenRetry('No usable speech');
      return;
    }

    const normalized = normalizeTranscript(trimmedText);
    if (isDuplicateTranscript(normalized, lastTranscriptRef.current, recentTranscriptsRef.current)) {
      emptyTranscriptStreakRef.current += 1;
      addLog('Rejected duplicate transcript');
      setConversationState('listening');
      scheduleListenRetry('Duplicate transcript');
      return;
    }

    lastTranscriptRef.current = normalized;
    recentTranscriptsRef.current = [normalized, ...recentTranscriptsRef.current].slice(0, 5);
    emptyTranscriptStreakRef.current = 0;
    log('Transcript accepted', trimmedText);

    const newUserMessage: ChatMessage = { role: 'user', content: trimmedText };
    const history = [
      ...messagesRef.current.slice(-10).map(m => ({ role: m.role, content: m.content })),
      newUserMessage,
    ];

    setMessages(prev => [...prev, newUserMessage]);
    setIsDavidThinking(true);
    isProcessingVoiceRef.current = true;
    setConversationState('processing');

    try {
      log('AI request sent', `history length: ${history.length}`);

      const response = await getChatResponse(history, profile?.preferred_response_length || 'short');

      if (!response || !response.trim()) {
        addLog('Empty AI response');
        setIsDavidThinking(false);
        isProcessingVoiceRef.current = false;
        setConversationState('listening');
        scheduleListenRetry('Empty AI response');
        return;
      }

      log('AI response received', response.substring(0, 80) + (response.length > 80 ? '…' : ''));

      // ── Response guards — swap bad lines for a short fallback (never silent retry) ──
      let finalResponse = response;
      const pickFallback = () =>
        ANTI_REPEAT_FALLBACKS[Math.floor(Math.random() * ANTI_REPEAT_FALLBACKS.length)];

      if (looksLikeBannedTherapyPhrase(response)) {
        const fallback = pickFallback();
        log('Banned therapy phrase — swapping response', `"${response.substring(0, 60)}" → "${fallback}"`);
        addLog('Replaced banned therapy phrase with fallback');
        finalResponse = fallback;
      } else if (hasGreetedRef.current && looksLikeOpeningGreeting(response)) {
        const fallback = pickFallback();
        log('Duplicate opening greeting — swapping response', `"${response.substring(0, 60)}" → "${fallback}"`);
        addLog('Replaced duplicate opening greeting with fallback');
        finalResponse = fallback;
      } else if (isTooSimilar(lastDavidResponseRef.current, response)) {
        const fallback = pickFallback();
        log('Anti-repeat triggered — swapping response', `"${response.substring(0, 60)}" → "${fallback}"`);
        finalResponse = fallback;
      }
      finalResponse = humanizeForTts(finalResponse);
      lastDavidResponseRef.current = finalResponse;

      setIsDavidThinking(false);
      setLastResponseText(finalResponse);
      setMessages(prev => [...prev, { role: 'assistant', content: finalResponse }]);

      await speakMessage(finalResponse);

    } catch (err: any) {
      addLog(`AI chat error: ${err?.message}`);
      setIsDavidThinking(false);
      isProcessingVoiceRef.current = false;
      setConversationState('listening');
      scheduleListenRetry('AI error');
    }
  };

  // ── Text-to-speech ────────────────────────────────────────────────────────
  const speakMessage = async (text: string) => {
    // Stop any audio that might still be playing
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    isDavidSpeakingRef.current = true;
    setIsDavidSpeaking(true);
    setConversationState('speaking');
    setError(null);

    log('TTS started', `${text.length} chars`);

    try {
      await preSpeechThinkingDelay(false);
      const audioUrl = await generateSpeech(text, { skipHumanize: true });

      if (!audioUrl) {
        log('TTS returned null — no audio URL');
        addLog('TTS failed: no audio URL returned from /api/speech');
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        setError("David's voice is unavailable right now. Check the ElevenLabs API key.");
        isProcessingVoiceRef.current = false;
        if (isConnectedRef.current) scheduleListenRetry('TTS failed');
        return;
      }

      log('Audio URL returned', audioUrl.substring(0, 40) + '…');

      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      // Preload so mobile browsers have the data before play()
      audio.preload = 'auto';

      audio.oncanplaythrough = () => {
        log('Audio canplaythrough — ready to play');
      };

      audio.onplay = () => {
        log('Audio playback started');
        addLog('David is speaking…');
      };

      audio.onended = () => {
        log('TTS finished');
        isDavidSpeakingRef.current = false;
        isProcessingVoiceRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        markResponseCompleted();
        if (isConnectedRef.current) {
          setTimeout(() => startListening(), POST_TTS_MIC_DELAY_MS);
        }
      };

      audio.onerror = (e) => {
        const errMsg = (e as any)?.message || 'unknown';
        log('Audio playback error', errMsg);
        addLog(`Audio playback failed: ${errMsg}`);
        isDavidSpeakingRef.current = false;
        isProcessingVoiceRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        currentAudioRef.current = null;
        setError("Audio playback failed. This may be a browser autoplay restriction.");
        if (isConnectedRef.current) scheduleListenRetry('Playback error');
      };

      log('Calling audio.play()');
      // play() returns a Promise — catch rejection (autoplay policy)
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((playErr: any) => {
          log('audio.play() rejected (autoplay policy?)', playErr?.message);
          addLog(`audio.play() blocked: ${playErr?.message}. Try tapping the screen first.`);
          isDavidSpeakingRef.current = false;
          isProcessingVoiceRef.current = false;
          setIsDavidSpeaking(false);
          setConversationState('listening');
          currentAudioRef.current = null;
          setError("Autoplay blocked. Tap anywhere on the screen and try again.");
          if (isConnectedRef.current) scheduleListenRetry('Autoplay blocked');
        });
      }

    } catch (err: any) {
      log('speakMessage exception', err?.message);
      addLog(`TTS exception: ${err?.message}`);
      isDavidSpeakingRef.current = false;
      isProcessingVoiceRef.current = false;
      setIsDavidSpeaking(false);
      setConversationState('listening');
      setError("David's voice encountered an unexpected error.");
      if (isConnectedRef.current) scheduleListenRetry('TTS exception');
    }
  };

  // ── Silence detection helper ──────────────────────────────────────────────
  // Calculates RMS (root mean square) of audio samples to detect silence
  const calculateRMS = (data: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  };

  // ── Speech recognition via OpenAI Whisper (MediaRecorder) ───────────────────
  // Replaces the unreliable browser Web Speech API.
  // Flow: getUserMedia → MediaRecorder records audio → automatic silence detection stops recording
  //       → audio blob sent to /api/transcribe (Whisper) → transcript → David responds.
  const startListening = async () => {
    if (isDavidSpeakingRef.current) {
      log('startListening blocked — David is still speaking');
      return;
    }
    if (isProcessingVoiceRef.current) {
      log('startListening blocked — still processing prior utterance');
      return;
    }
    if (isInResponseCooldown()) {
      log('startListening delayed — response cooldown');
      scheduleListenRetry('Response cooldown');
      return;
    }
    if (!isConnectedRef.current) {
      log('startListening blocked — session not connected');
      return;
    }

    clearListenRetry();

    // Stop any existing recorder
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
      recognitionRef.current = null;
    }

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    log('Requesting microphone permission');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      log('Microphone permission granted');
    } catch (err: any) {
      log('Microphone permission denied', err?.message);
      addLog('Mic permission denied. Use the text box below.');
      setError('Microphone access was denied. Type your message below instead.');
      setShowTextFallback(true);
      setConversationState('listening');
      return;
    }

    // Pick the best supported MIME type
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ].find(t => MediaRecorder.isTypeSupported(t)) || '';

    log('Starting MediaRecorder', mimeType || 'default');
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err: any) {
      log('MediaRecorder init failed', err?.message);
      addLog(`Could not start recorder: ${err?.message}`);
      setError('Could not start microphone. Try a different browser.');
      stream.getTracks().forEach(t => t.stop());
      setConversationState('listening');
      return;
    }

    const chunks: Blob[] = [];
    let recordingStartedAt = 0;
    let hasDetectedSpeech = false;
    let speechMsAccumulated = 0;
    let consecutiveSpeechFrames = 0;
    let maxConsecutiveSpeechFrames = 0;
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstart = () => {
      recordingStartedAt = Date.now();
      log('Microphone activated — waiting for real speech before end-of-utterance');
      setConversationState('listening');
      addLog('Listening…');
      setError(null);

      try {
        const audioContext = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
        if (!audioContextRef.current) audioContextRef.current = audioContext;

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const muteGain = audioContext.createGain();
        muteGain.gain.value = 0;

        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(audioContext.destination);

        audioProcessorRef.current = processor;

        const frameMs = (4096 / audioContext.sampleRate) * 1000;
        const silenceFramesNeeded = Math.ceil(SILENCE_DURATION_MS / frameMs);
        let consecutiveSilenceFrames = 0;

        processor.onaudioprocess = (e) => {
          if (recorder.state !== 'recording') return;

          const input = e.inputBuffer.getChannelData(0);
          const rms = calculateRMS(input);
          const elapsedMs = Date.now() - recordingStartedAt;

          if (rms >= SPEECH_RMS_THRESHOLD) {
            consecutiveSpeechFrames++;
            maxConsecutiveSpeechFrames = Math.max(
              maxConsecutiveSpeechFrames,
              consecutiveSpeechFrames,
            );
            if (consecutiveSpeechFrames >= 2) {
              speechMsAccumulated += frameMs;
            }
            if (
              maxConsecutiveSpeechFrames >= MIN_SUSTAINED_SPEECH_FRAMES &&
              speechMsAccumulated >= MIN_SPEECH_MS
            ) {
              hasDetectedSpeech = true;
            }
            consecutiveSilenceFrames = 0;
            return;
          }

          consecutiveSpeechFrames = 0;

          if (rms <= SILENCE_RMS_THRESHOLD) {
            consecutiveSilenceFrames++;
          } else {
            consecutiveSilenceFrames = Math.max(0, consecutiveSilenceFrames - 1);
          }

          const speechLongEnough =
            hasDetectedSpeech &&
            speechMsAccumulated >= MIN_SPEECH_MS &&
            maxConsecutiveSpeechFrames >= MIN_SUSTAINED_SPEECH_FRAMES;
          const recordingLongEnough = elapsedMs >= MIN_RECORDING_MS;

          if (
            speechLongEnough &&
            recordingLongEnough &&
            consecutiveSilenceFrames >= silenceFramesNeeded
          ) {
            log('End of utterance (speech + silence) — stopping recording', {
              speechMs: Math.round(speechMsAccumulated),
              elapsedMs,
            });
            processor.disconnect();
            muteGain.disconnect();
            source.disconnect();
            if (recorder.state === 'recording') recorder.stop();
          }
        };

        // If user never speaks, do not send ambient audio to Whisper
        silenceTimeoutRef.current = setTimeout(() => {
          if (recorder.state !== 'recording' || hasDetectedSpeech) return;
          log('No speech detected — discarding recording');
          processor.disconnect();
          muteGain.disconnect();
          source.disconnect();
          recorder.stop();
        }, NO_SPEECH_DISCARD_MS);
      } catch (err) {
        log('Silence detection setup failed', (err as any)?.message);
      }
    };

    recorder.onstop = async () => {
      const recordingDurationMs = Date.now() - recordingStartedAt;
      log('Recording stopped', { recordingDurationMs });

      stream.getTracks().forEach(t => t.stop());

      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      if (!isConnectedRef.current) return;

      if (isInResponseCooldown()) {
        addLog('Recording discarded — response cooldown');
        setConversationState('listening');
        scheduleListenRetry('Response cooldown');
        return;
      }

      if (recordingDurationMs < MIN_RECORDING_MS) {
        emptyTranscriptStreakRef.current += 1;
        addLog(`Recording too short (${recordingDurationMs}ms)`);
        setConversationState('listening');
        scheduleListenRetry('Recording too short');
        return;
      }

      if (!hasDetectedSpeech) {
        emptyTranscriptStreakRef.current += 1;
        addLog('Recording discarded — no speech detected');
        setConversationState('listening');
        scheduleListenRetry('No speech in recording');
        return;
      }

      if (chunks.length === 0) {
        emptyTranscriptStreakRef.current += 1;
        setConversationState('listening');
        scheduleListenRetry('No audio chunks');
        return;
      }

      const audioBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      log('Audio blob size', `${audioBlob.size} bytes`);

      if (audioBlob.size < MIN_AUDIO_BYTES) {
        emptyTranscriptStreakRef.current += 1;
        addLog('Audio too small — likely noise only');
        setConversationState('listening');
        scheduleListenRetry('Audio too small');
        return;
      }

      setConversationState('processing');
      addLog('Transcribing…');
      isProcessingVoiceRef.current = true;
      log('Transcription request sent', `${audioBlob.size} bytes`);

      try {
        const formData = new FormData();
        formData.append('audio', audioBlob, `recording.${mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'}`);

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.message || `Transcription failed: ${response.status}`);
        }

        const data = await response.json();
        const transcript = data.transcript?.trim() || '';
        log('Transcript received', `"${transcript}"`);

        isProcessingVoiceRef.current = false;

        if (!transcript || data.rejected) {
          emptyTranscriptStreakRef.current += 1;
          addLog(data.reason ? `Transcript rejected: ${data.reason}` : 'Empty transcript');
          setConversationState('listening');
          scheduleListenRetry('No transcript');
          return;
        }

        if (isJunkTranscript(transcript) || !isMeaningfulTranscript(transcript)) {
          emptyTranscriptStreakRef.current += 1;
          addLog('Transcript rejected as junk/noise');
          setConversationState('listening');
          scheduleListenRetry('Not meaningful');
          return;
        }

        const normalized = normalizeTranscript(transcript);
        if (isDuplicateTranscript(normalized, lastTranscriptRef.current, recentTranscriptsRef.current)) {
          emptyTranscriptStreakRef.current += 1;
          addLog('Duplicate transcript from Whisper');
          setConversationState('listening');
          scheduleListenRetry('Duplicate transcript');
          return;
        }

        micRetryCountRef.current = 0;
        setMicErrorCount(0);
        setError(null);
        emptyTranscriptStreakRef.current = 0;
        handleVoiceInput(transcript);

      } catch (err: any) {
        log('Whisper transcription error', err?.message);
        addLog(`Transcription error: ${err?.message}`);
        isProcessingVoiceRef.current = false;
        setConversationState('listening');
        setError('Could not transcribe audio. Try again.');
        scheduleListenRetry('Transcription error');
      }
    };

    recorder.onerror = (e: any) => {
      log('MediaRecorder error', e?.error?.message || 'unknown');
      setConversationState('listening');
      stream.getTracks().forEach(t => t.stop());
    };

    recognitionRef.current = recorder;

    // Record until silence is detected or user ends session
    // Auto-stop after 30 seconds as a safety net
    recorder.start();
    log('MediaRecorder.start() called');

    // Auto-stop after 30s
    setTimeout(() => {
      if (recorder.state === 'recording') {
        log('Auto-stopping recording after 30s');
        recorder.stop();
      }
    }, 30000);
  };

  // ── Text fallback submit ──────────────────────────────────────────
  const handleTextSubmit = () => {
    const trimmed = textInput.trim();
    if (!trimmed || !isConnectedRef.current) return;
    log('Text input submitted', trimmed);
    setTextInput('');
    handleVoiceInput(trimmed);
  };

  const cleanupSessionResources = (reason: string) => {
    if (!isConnectedRef.current) return;

    log('session ended', reason);
    sessionGenerationRef.current += 1;
    isConnectedRef.current = false;
    isDavidSpeakingRef.current = false;
    isProcessingVoiceRef.current = false;
    lastTranscriptRef.current = '';
    recentTranscriptsRef.current = [];
    lastResponseAtRef.current = 0;
    hasGreetedRef.current = false;
    emptyTranscriptStreakRef.current = 0;
    setConversationState('ended');

    clearListenRetry();

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) { }
      recognitionRef.current = null;
    }
    if (currentAudioRef.current) {
      try { currentAudioRef.current.pause(); } catch (e) { }
      currentAudioRef.current = null;
    }
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch (e) { }
      audioProcessorRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    setIsConnected(false);
    setIsDavidSpeaking(false);
    setIsDavidThinking(false);
    // Reset text fallback state
    micRetryCountRef.current = 0;
    setMicErrorCount(0);
    setShowTextFallback(false);
    setTextInput('');
    setConversationState('idle');
  };

  const stopSession = () => {
    cleanupSessionResources('user_explicit_end_button');
  };

  // ── Feedback ──────────────────────────────────────────────────────────────
  const handleFeedback = async (index: number | 'last', type: 'up' | 'down') => {
    const isHelpful = type === 'up';
    if (index === 'last') {
      if (!lastResponseText || !profile) return;
      setLastFeedback(type);
      await saveAIFeedback(profile.id, 'chat', lastResponseText, isHelpful);
    } else {
      const message = messages[index as number];
      if (!message || message.role !== 'assistant' || !profile) return;
      setMessages(prev => prev.map((msg, i) =>
        i === index ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg
      ));
      await saveAIFeedback(profile.id, 'chat', message.content, isHelpful);
    }
  };

  // ── Locked screen (non-Pro) ───────────────────────────────────────────────
  if (!hasVoiceAccess()) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockCard}>
          <Lock color="#4F46E5" size={48} style={{ marginBottom: 20 }} />
          <Text style={styles.lockTitle}>Pro Feature</Text>
          <Text style={styles.lockText}>
            Upgrade to Pro to experience real-time voice conversations with David.
          </Text>
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={() => navigation.navigate('Profile')}
          >
            <Text style={styles.upgradeButtonText}>Upgrade Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <ScrollView style={styles.outerContainer} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Sparkles color="#4F46E5" size={24} />
        <Text style={styles.title}>Voice with David</Text>
        <Text style={styles.subtitle}>Real-time Spiritual Companion</Text>
      </View>

      {/* Visualizer */}
      <View style={styles.visualizerContainer}>
        <AnimatePresence>
          {isConnected && (
            <MotionView
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{
                scale: isDavidSpeaking ? [1, 1.4, 1] : conversationState === 'listening' ? [1, 1.15, 1] : 1,
                opacity: isDavidSpeaking ? [0.4, 0.7, 0.4] : conversationState === 'listening' ? [0.2, 0.5, 0.2] : 0.1,
              }}
              transition={{
                duration: isDavidSpeaking ? 0.8 : 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              style={{
                position: 'absolute',
                width: 110,
                height: 110,
                borderRadius: 55,
                backgroundColor: 'rgba(212, 175, 55, 0.4)',
                zIndex: 1,
              }}
            />
          )}
        </AnimatePresence>

        <TouchableOpacity
          style={[styles.mainCircle, isConnected && styles.mainActive,
          conversationState === 'listening' && styles.mainListening]}
          onPress={() => {
            // Mic button is now visual only - no manual send needed
          }}
          disabled={true}
          activeOpacity={0.8}
        >
          {isConnected ? (
            isDavidSpeaking ? (
              <MotionView
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 0.4, repeat: Infinity }}
              >
                <Sparkles color="#d4af37" size={40} />
              </MotionView>
            ) : isDavidThinking ? (
              <ActivityIndicator color="#d4af37" size="large" />
            ) : (
              <Mic color={conversationState === 'listening' ? '#0b1e3d' : '#fff'} size={40} />
            )
          ) : (
            <MicOff color="#9CA3AF" size={40} />
          )}
        </TouchableOpacity>
      </View>

      {/* Status label */}
      {isConnected && (
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {isDavidSpeaking
              ? 'David is speaking…'
              : isDavidThinking
                ? 'David is reflecting…'
                : conversationState === 'listening'
                  ? 'Listening…'
                  : 'Processing…'}
          </Text>
        </View>
      )}

      {/* Last David response (text fallback) */}
      {lastResponseText && lastResponseText.trim().length > 0 && isConnected && (
        <MotionView
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={styles.textFallbackContainer}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.textFallbackLabel}>David says:</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => handleFeedback('last', 'up')}>
                <ThumbsUp size={14} color={lastFeedback === 'up' ? '#d4af37' : 'rgba(212, 175, 55, 0.4)'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleFeedback('last', 'down')}>
                <ThumbsDown size={14} color={lastFeedback === 'down' ? '#ef4444' : 'rgba(212, 175, 55, 0.4)'} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.textFallbackContent}>{lastResponseText}</Text>
        </MotionView>
      )}

      {/* Text input fallback — shown when speech recognition fails (above error banner so it's visible) */}
      {isConnected && showTextFallback && (
        <View style={styles.textInputContainer}>
          <Text style={styles.textInputLabel}>Type your message to David</Text>
          <View style={styles.textInputRow}>
            <TextInput
              style={styles.textInputField}
              value={textInput}
              onChangeText={setTextInput}
              placeholder="What's on your mind…"
              placeholderTextColor="rgba(212, 175, 55, 0.4)"
              onSubmitEditing={handleTextSubmit}
              returnKeyType="send"
              editable={!isDavidThinking && !isDavidSpeaking}
              multiline={false}
            />
            <TouchableOpacity
              style={[styles.textSendButton, (!textInput.trim() || isDavidThinking) && styles.textSendButtonDisabled]}
              onPress={handleTextSubmit}
              disabled={!textInput.trim() || isDavidThinking || isDavidSpeaking}
            >
              <Text style={styles.textSendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={{ marginTop: 8 }}
            onPress={() => {
              setShowTextFallback(false);
              micRetryCountRef.current = 0;
              setMicErrorCount(0);
              setError(null);
              if (isConnectedRef.current) startListening();
            }}
          >
            <Text style={styles.retryMicText}>Try microphone again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Error banner — only show when text fallback is NOT shown */}
      {error && !showTextFallback && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* API key warning */}
      {!hasKey && (
        <TouchableOpacity style={styles.keyWarning} onPress={handleOpenKeySelector}>
          <Text style={styles.keyWarningText}>⚠️ API Key Setup Required (Tap here)</Text>
        </TouchableOpacity>
      )}

      {/* Main action button */}
      <TouchableOpacity
        style={[styles.actionButton, isConnected ? styles.stopButton : styles.startButton]}
        onPress={isConnected ? stopSession : startSession}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.actionButtonText}>
            {isConnected ? 'End Conversation' : 'Start Conversation'}
          </Text>
        )}
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        David is an AI spiritual companion. For professional guidance or pastoral care, please consult your local church or a qualified advisor.
      </Text>

      {/* Debug panel toggle */}
      <TouchableOpacity
        style={styles.debugToggleContainer}
        onPress={() => setShowDebug(v => !v)}
      >
        <Text style={styles.debugToggleText}>{showDebug ? 'Hide Debug' : 'Show Debug'}</Text>
      </TouchableOpacity>

      {showDebug && (
        <View style={styles.debugPanel}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>Voice Debug Log</Text>
            <TouchableOpacity onPress={() => setDebugLogs([])}>
              <Text style={styles.debugClear}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.debugScroll}>
            {debugLogs.map((l, i) => (
              <Text key={i} style={styles.debugLog}>{l}</Text>
            ))}
          </ScrollView>
        </View>
      )}
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
    paddingHorizontal: 30,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
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
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  mainCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#0b1e3d',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    borderWidth: 2,
    borderColor: '#d4af37',
  },
  mainActive: {
    backgroundColor: '#0f2a52',
    borderColor: '#f5d77a',
  },
  mainListening: {
    backgroundColor: '#d4af37',
    borderColor: '#f5d77a',
  },
  statusContainer: {
    marginBottom: 16,
  },
  statusText: {
    fontSize: 13,
    color: '#f5d77a',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  textFallbackContainer: {
    backgroundColor: 'rgba(15, 42, 82, 0.6)',
    padding: 15,
    borderRadius: 16,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  textFallbackLabel: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 5,
  },
  textFallbackContent: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  keyWarning: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  keyWarningText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  actionButton: {
    width: '100%',
    padding: 18,
    borderRadius: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1,
  },
  startButton: {
    backgroundColor: '#0b1e3d',
    borderColor: '#d4af37',
  },
  stopButton: {
    backgroundColor: '#7f1d1d',
    borderColor: '#ef4444',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  disclaimer: {
    marginTop: 20,
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.5)',
    textAlign: 'center',
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  debugToggleContainer: {
    marginTop: 20,
  },
  debugToggleText: {
    color: 'rgba(212, 175, 55, 0.4)',
    fontSize: 10,
    textDecorationLine: 'underline',
    textTransform: 'uppercase',
  },
  debugPanel: {
    width: '100%',
    maxHeight: 220,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 12,
    borderRadius: 12,
    marginTop: 15,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.3)',
    paddingBottom: 4,
  },
  debugTitle: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  debugClear: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  debugScroll: {
    flex: 1,
  },
  debugLog: {
    color: '#4ade80',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 2,
  },
  lockedContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  lockCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 32,
    padding: 40,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 15,
  },
  lockTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#d4af37',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  lockText: {
    fontSize: 14,
    color: '#f5d77a',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 30,
  },
  upgradeButton: {
    backgroundColor: '#0b1e3d',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#d4af37',
  },
  upgradeButtonText: {
    color: '#d4af37',
    fontSize: 14,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Text input fallback styles
  textInputContainer: {
    width: '100%',
    backgroundColor: 'rgba(15, 42, 82, 0.7)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.4)',
  },
  textInputLabel: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  textInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  textInputField: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  textSendButton: {
    backgroundColor: '#d4af37',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  textSendButtonDisabled: {
    backgroundColor: 'rgba(212, 175, 55, 0.3)',
  },
  textSendButtonText: {
    color: '#0b1e3d',
    fontWeight: 'bold',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  retryMicText: {
    color: 'rgba(212, 175, 55, 0.6)',
    fontSize: 11,
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginTop: 4,
  },
});
