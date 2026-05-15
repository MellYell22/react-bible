import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView, TextInput } from 'react-native';
import { Mic, MicOff, Lock, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";

const MotionView = motion(View);
import { ChatMessage } from '../types';
import { getChatResponse, generateSpeech } from '../services/ai';
import { hasProAccess } from '../utils/tier';
import { saveAIFeedback } from '../services/supabase';
import { useUser } from '../UserContext';

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

const getDavidGreeting = (firstName?: string): string => {
  const namedGreetings = [
    `Hey, ${firstName}. Good to hear your voice. What's been weighing on you lately?`,
    `Good to see you again, ${firstName}. How are you really doing today?`,
    `${firstName}, I'm glad you came by. What's been on your heart?`,
  ];

  const namelessGreetings = [
    `Hey. I'm glad you came by.`,
    `Good to hear your voice again. What's been going on?`,
    `Take your time. What's been weighing on you lately?`,
    `Hey. How are you really doing today?`,
    `I'm here with you. What's been on your heart?`,
    `Good to see you again. What have you been carrying lately?`,
  ];

  const greetings = firstName ? [...namedGreetings, ...namelessGreetings] : namelessGreetings;
  return greetings[Math.floor(Math.random() * greetings.length)];
};

// ─── David personality prompt ────────────────────────────────────────────────
// Kept here as a reference — the authoritative copy lives in api/chat.ts (Vercel)
// and server.ts (local dev). Both are kept in sync.

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
  const [isConnecting, setIsConnecting]     = useState(false);
  const [isConnected, setIsConnected]       = useState(false);
  const [isDavidThinking, setIsDavidThinking] = useState(false);
  const [isDavidSpeaking, setIsDavidSpeaking] = useState(false);
  const [hasKey, setHasKey]                 = useState(true);
  const [debugLogs, setDebugLogs]           = useState<string[]>([]);
  const [error, setError]                   = useState<string | null>(null);
  const [showDebug, setShowDebug]           = useState(false);
  const [lastResponseText, setLastResponseText] = useState<string | null>(null);
  const [messages, setMessages]             = useState<ChatMessage[]>([]);
  const [lastFeedback, setLastFeedback]     = useState<'up' | 'down' | null>(null);
  // Text fallback when speech recognition fails
  const [textInput, setTextInput]           = useState('');
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [micErrorCount, setMicErrorCount]   = useState(0);

  // ── Refs (never stale inside callbacks) ──────────────────────────────────
  const recognitionRef      = useRef<any>(null);
  const currentAudioRef     = useRef<HTMLAudioElement | null>(null);
  const isConnectedRef      = useRef(false);
  const isDavidSpeakingRef  = useRef(false);
  const audioContextRef     = useRef<AudioContext | null>(null);
  // Retry tracking for speech recognition network errors
  const micRetryCountRef    = useRef(0);
  const MAX_MIC_RETRIES     = 1; // Show text fallback after 1 network failure (network errors are persistent)
  // Silence detection for automatic speech-end detection
  const audioProcessorRef   = useRef<ScriptProcessorNode | null>(null);
  const silenceTimeoutRef   = useRef<NodeJS.Timeout | null>(null);
  const SILENCE_THRESHOLD   = 0.01; // RMS threshold for silence
  const SILENCE_DURATION    = 1500; // milliseconds of silence to trigger stop

  // ── Logging helper (also pushes to on-screen debug panel) ────────────────
  const addLog = (msg: string) => {
    const full = log(msg);
    setDebugLogs(prev => [full, ...prev].slice(0, 30));
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    checkApiKey();
    return () => { stopSession(); };
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

  // ── Start session ─────────────────────────────────────────────────────────
  // Pressing "Start Conversation" activates the microphone and plays David's opening greeting.
  const startSession = async () => {
    log('Start Conversation button pressed');

    if (!hasProAccess(profile)) {
      alert('Voice chat is a Pro feature. Please upgrade to access.');
      return;
    }

    // Unlock audio on this user gesture so play() works on mobile
    unlockAudioContext();

    setIsConnecting(true);
    setConversationState('starting');
    setMessages([]);
    setError(null);
    setIsDavidThinking(false);
    setIsDavidSpeaking(false);
    isDavidSpeakingRef.current = false;

    addLog('Starting David voice session with opening greeting');

    try {
      isConnectedRef.current = true;
      setIsConnected(true);

      // Play David's opening greeting. Use only a real metadata name; never
      // derive a spoken name from the user's email address or email username.
      const metadata = session?.user?.user_metadata || {};
      const identityData = session?.user?.identities?.[0]?.identity_data || {};
      const firstName = cleanFirstName(metadata.first_name)
        || cleanFirstName(metadata.given_name)
        || cleanFirstName(metadata.full_name)
        || cleanFirstName(metadata.name)
        || cleanFirstName(identityData.first_name)
        || cleanFirstName(identityData.given_name)
        || cleanFirstName(identityData.full_name)
        || cleanFirstName(identityData.name);
      const greeting = getDavidGreeting(firstName);
      log('Playing opening greeting', greeting);
      
      setIsDavidSpeaking(true);
      isDavidSpeakingRef.current = true;
      setConversationState('speaking');

      try {
        const audioUrl = await generateSpeech(greeting);
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          currentAudioRef.current = audio;
          audio.preload = 'auto';

          audio.onended = () => {
            log('Opening greeting finished — starting mic');
            isDavidSpeakingRef.current = false;
            setIsDavidSpeaking(false);
            URL.revokeObjectURL(audioUrl);
            currentAudioRef.current = null;
            setConversationState('listening');
            setIsConnecting(false);
            
            // Add David's greeting as first assistant message
            setMessages([{ role: 'assistant', content: greeting }]);
            
            // Now start listening for user input
            setTimeout(() => startListening(), 300);
          };

          audio.onerror = () => {
            log('Opening greeting audio error — starting mic anyway');
            isDavidSpeakingRef.current = false;
            setIsDavidSpeaking(false);
            currentAudioRef.current = null;
            setConversationState('listening');
            setIsConnecting(false);
            setMessages([{ role: 'assistant', content: greeting }]);
            setTimeout(() => startListening(), 300);
          };

          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch((playErr: any) => {
              log('Opening greeting play() rejected', playErr?.message);
              isDavidSpeakingRef.current = false;
              setIsDavidSpeaking(false);
              currentAudioRef.current = null;
              setConversationState('listening');
              setIsConnecting(false);
              setMessages([{ role: 'assistant', content: greeting }]);
              setTimeout(() => startListening(), 300);
            });
          }
        } else {
          // TTS failed, skip greeting and start listening
          log('Opening greeting TTS failed — starting mic without greeting');
          isDavidSpeakingRef.current = false;
          setIsDavidSpeaking(false);
          setConversationState('listening');
          setIsConnecting(false);
          setTimeout(() => startListening(), 300);
        }
      } catch (err: any) {
        log('Opening greeting error', err?.message);
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        setIsConnecting(false);
        setTimeout(() => startListening(), 300);
      }

    } catch (err: any) {
      addLog(`Session start error: ${err?.message}`);
      setError(`Failed to start: ${err?.message}`);
      setIsConnecting(false);
      setConversationState('idle');
      isConnectedRef.current = false;
    }
  };

  // ── Handle voice input (transcript → AI → TTS) ────────────────────────────
  const handleVoiceInput = async (text: string) => {
    // Validate input
    if (!text || !text.trim()) {
      addLog('Empty transcript — restarting mic');
      setConversationState('listening');
      if (isConnectedRef.current) {
        setTimeout(() => startListening(), 300);
      }
      return;
    }

    // Prevent processing empty or duplicate transcripts
    const trimmedText = text.trim();
    if (trimmedText.length < 2) {
      addLog('Transcript too short — restarting mic');
      setConversationState('listening');
      if (isConnectedRef.current) {
        setTimeout(() => startListening(), 300);
      }
      return;
    }

    log('Transcript received', trimmedText);

    const newUserMessage: ChatMessage = { role: 'user', content: trimmedText };
    setMessages(prev => [...prev, newUserMessage]);
    setIsDavidThinking(true);
    setConversationState('processing');

    try {
      const recentMessages = messages.slice(-10);
      const history = [
        ...recentMessages.map(m => ({ role: m.role, content: m.content })),
        newUserMessage,
      ];

      log('AI request sent', `history length: ${history.length}`);

      const response = await getChatResponse(history, profile?.preferred_response_length || 'short');
      
      // Validate response
      if (!response || !response.trim()) {
        addLog('Empty AI response — restarting mic');
        setIsDavidThinking(false);
        setConversationState('listening');
        if (isConnectedRef.current) {
          setTimeout(() => startListening(), 500);
        }
        return;
      }
      
      log('AI response received', response.substring(0, 80) + (response.length > 80 ? '…' : ''));

      setIsDavidThinking(false);
      setLastResponseText(response);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);

      await speakMessage(response);

    } catch (err: any) {
      addLog(`AI chat error: ${err?.message}`);
      setIsDavidThinking(false);
      setConversationState('listening');
      // Restart listening even after AI error so the session stays alive
      if (isConnectedRef.current) {
        setTimeout(() => startListening(), 500);
      }
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

    log('TTS request sent', `${text.length} chars`);

    try {
      const audioUrl = await generateSpeech(text);

      if (!audioUrl) {
        log('TTS returned null — no audio URL');
        addLog('TTS failed: no audio URL returned from /api/speech');
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        setError("David's voice is unavailable right now. Check the ElevenLabs API key.");
        if (isConnectedRef.current) setTimeout(() => startListening(), 500);
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
        log('Audio playback ended — restarting mic');
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        if (isConnectedRef.current) {
          setTimeout(() => startListening(), 300);
        }
      };

      audio.onerror = (e) => {
        const errMsg = (e as any)?.message || 'unknown';
        log('Audio playback error', errMsg);
        addLog(`Audio playback failed: ${errMsg}`);
        isDavidSpeakingRef.current = false;
        setIsDavidSpeaking(false);
        setConversationState('listening');
        currentAudioRef.current = null;
        setError("Audio playback failed. This may be a browser autoplay restriction.");
        if (isConnectedRef.current) setTimeout(() => startListening(), 500);
      };

      log('Calling audio.play()');
      // play() returns a Promise — catch rejection (autoplay policy)
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((playErr: any) => {
          log('audio.play() rejected (autoplay policy?)', playErr?.message);
          addLog(`audio.play() blocked: ${playErr?.message}. Try tapping the screen first.`);
          isDavidSpeakingRef.current = false;
          setIsDavidSpeaking(false);
          setConversationState('listening');
          currentAudioRef.current = null;
          setError("Autoplay blocked. Tap anywhere on the screen and try again.");
          if (isConnectedRef.current) setTimeout(() => startListening(), 500);
        });
      }

    } catch (err: any) {
      log('speakMessage exception', err?.message);
      addLog(`TTS exception: ${err?.message}`);
      isDavidSpeakingRef.current = false;
      setIsDavidSpeaking(false);
      setConversationState('listening');
      setError("David's voice encountered an unexpected error.");
      if (isConnectedRef.current) setTimeout(() => startListening(), 500);
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
    if (!isConnectedRef.current) {
      log('startListening blocked — session not connected');
      return;
    }

    // Stop any existing recorder
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }

    // Clear any pending silence timeout
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
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstart = () => {
      log('Microphone activated — listening with silence detection');
      setConversationState('listening');
      addLog('Listening…');
      setError(null);

      // Set up silence detection using AudioContext
      try {
        const audioContext = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
        if (!audioContextRef.current) audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);

        analyser.fftSize = 2048;
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(audioContext.destination);

        audioProcessorRef.current = processor;

        let consecutiveSilenceFrames = 0;
        const silenceFramesNeeded = Math.ceil(SILENCE_DURATION / (4096 / audioContext.sampleRate / 1000));

        processor.onaudioprocess = (e) => {
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
          
          // Calculate average frequency magnitude
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          
          if (average < 30) { // Silence threshold in frequency domain
            consecutiveSilenceFrames++;
            if (consecutiveSilenceFrames >= silenceFramesNeeded) {
              log('Silence detected — stopping recording');
              processor.disconnect();
              recorder.stop();
            }
          } else {
            consecutiveSilenceFrames = 0;
          }
        };
      } catch (err) {
        log('Silence detection setup failed', (err as any)?.message);
        // Continue without silence detection
      }
    };

    recorder.onstop = async () => {
      log('Recording stopped — sending to Whisper');
      setConversationState('processing');
      addLog('Transcribing with Whisper…');
      stream.getTracks().forEach(t => t.stop());

      // Clean up audio processor
      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }

      if (!isConnectedRef.current) return;

      if (chunks.length === 0) {
        addLog('No audio recorded — restarting mic');
        setConversationState('listening');
        setTimeout(() => startListening(), 300);
        return;
      }

      const audioBlob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      log('Audio blob size', `${audioBlob.size} bytes`);

      if (audioBlob.size < 1000) {
        addLog('Audio too short — restarting mic');
        setConversationState('listening');
        setTimeout(() => startListening(), 300);
        return;
      }

      setIsDavidThinking(true);
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

        setIsDavidThinking(false);

        if (!transcript) {
          addLog('Empty transcript — restarting mic');
          setConversationState('listening');
          if (isConnectedRef.current) setTimeout(() => startListening(), 300);
          return;
        }

        // Success — reset error state
        micRetryCountRef.current = 0;
        setMicErrorCount(0);
        setError(null);
        handleVoiceInput(transcript);

      } catch (err: any) {
        log('Whisper transcription error', err?.message);
        addLog(`Transcription error: ${err?.message}`);
        setIsDavidThinking(false);
        setConversationState('listening');
        setError('Could not transcribe audio. Try again.');
        if (isConnectedRef.current) setTimeout(() => startListening(), 1000);
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

  // ── Stop session ──────────────────────────────────────────────
  const stopSession = () => {
    log('Session ended by user');
    isConnectedRef.current = false;
    isDavidSpeakingRef.current = false;
    setConversationState('ended');

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (currentAudioRef.current) {
      try { currentAudioRef.current.pause(); } catch (e) {}
      currentAudioRef.current = null;
    }
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch (e) {}
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
  if (!hasProAccess(profile)) {
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
