import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Mic, MicOff, Lock, Sparkles } from 'lucide-react';
// Note: Animation from 'motion/react' removed for React Native compatibility
import {
  GoogleGenAI,
  Modality,
  StartSensitivity,
  EndSensitivity,
} from '@google/genai';
import { supabase } from '../services/supabase';
import { Profile } from '../types';
import { hasProAccess } from '../utils/tier';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

const VOICE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const DAVID_VOICE = 'Algenib';

export default function VoiceScreen({ navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isDavidSpeaking, setIsDavidSpeaking] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [davidText, setDavidText] = useState<string | null>(null);

  const sessionRef = useRef<any>(null);

  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);

  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const isConnectedRef = useRef(false);
  const isDavidSpeakingRef = useRef(false);

  const silenceTimerRef = useRef<number | null>(null);
  const playbackChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    fetchProfile();
    checkApiKey();

    return () => {
      stopSession();
    };
  }, []);

  const fetchProfile = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (data) setProfile(data);
  };

  const checkApiKey = async () => {
    if (window.aistudio) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const scheduleAudioStreamEnd = () => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      if (!sessionRef.current || !isConnectedRef.current) return;
      try {
        console.log('[Voice] Silence detected -> sending audioStreamEnd');
        sessionRef.current.sendRealtimeInput({ audioStreamEnd: true });
      } catch (err) {
        console.error('[Voice] Failed to send audioStreamEnd:', err);
      }
    }, 1200);
  };

  const getPlaybackContext = async () => {
    if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
      playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext!)();
    }
    if (playbackCtxRef.current.state === 'suspended') {
      await playbackCtxRef.current.resume();
    }
    return playbackCtxRef.current;
  };

  const startSession = async () => {
    if (!hasProAccess(profile)) {
      alert('Voice chat is a Pro feature. Please upgrade to access.');
      return;
    }

    if (!hasKey && window.aistudio) {
      await handleOpenKeySelector();
    }

    setIsConnecting(true);
    setDavidText(null);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
      if (!apiKey) {
        alert('Missing VITE_GEMINI_API_KEY environment variable. Please configure your environment.');
        setIsConnecting(false);
        return;
      }

      await getPlaybackContext();

      const ai = new GoogleGenAI({ apiKey });

      console.log('[Voice] Connecting to Gemini Live API...');

      const session = await ai.live.connect({
        model: VOICE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 10,
              silenceDurationMs: 120,
            },
          },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: DAVID_VOICE,
              },
            },
          },
          systemInstruction: `
You are David, a calm, compassionate Christian male voice companion.

You should sound like a real human man speaking naturally, warmly, and thoughtfully.
Speak slowly, with natural pauses, gentle breathing room between ideas, and a grounded pastoral presence.

Do not sound robotic, overly polished, or scripted.

Speech style rules:
- Speak in a warm, masculine, emotionally grounded tone.
- Use short pauses between thoughts.
- Occasionally use soft conversational fillers like "hmm", "well", "you know", "ah", or "let me think".
- Vary your rhythm so you sound alive and human.
- Never rush.
- Keep your tone calm, reassuring, reflective, and kind.
- Speak like a trusted Christian friend or soft-spoken pastor.
- When comforting the user, sound present and sincere.
- When sharing scripture, weave it in naturally, not like a sermon.

Response length:
- Usually 1 to 3 sentences.
- If the user is emotional, slow down and be extra gentle.
- If the user asks for more, you may expand naturally.

You are grounded in the Bible, peaceful, deeply human, and conversational.
`,
        },
        callbacks: {
          onopen: () => {
            console.log('[Voice] Session connected');
            isConnectedRef.current = true;
            setIsConnected(true);
            setIsConnecting(false);
            startAudioCapture();
          },

          onmessage: (message: any) => {
            if (message.setupComplete) {
              console.log('[Voice] Setup complete');
              return;
            }

            if (message.serverContent?.inputTranscription?.text) {
              console.log('[Voice] Input transcript:', message.serverContent.inputTranscription.text);
            }

            if (message.serverContent?.outputTranscription?.text) {
              console.log('[Voice] Output transcript:', message.serverContent.outputTranscription.text);
              setDavidText(message.serverContent.outputTranscription.text);
            }

            if (message.serverContent?.interrupted) {
              console.log('[Voice] Model interrupted');
              isDavidSpeakingRef.current = false;
              setIsDavidSpeaking(false);
              return;
            }

            if (message.serverContent?.turnComplete) {
              console.log('[Voice] Turn complete');
              isDavidSpeakingRef.current = false;
              setIsDavidSpeaking(false);
              return;
            }

            const parts = message.serverContent?.modelTurn?.parts ?? [];
            if (!parts.length) return;

            for (const part of parts) {
              if (part.inlineData?.data) {
                isDavidSpeakingRef.current = true;
                setIsDavidSpeaking(true);

                playbackChainRef.current = playbackChainRef.current.then(() =>
                  playAudioChunk(part.inlineData.data)
                );
              }

              if (part.text) {
                setDavidText(part.text);
              }
            }
          },

          onclose: (event: any) => {
            console.log('[Voice] Session closed:', event?.reason || 'no reason');
            isConnectedRef.current = false;
            setIsConnected(false);
            isDavidSpeakingRef.current = false;
            setIsDavidSpeaking(false);
            setIsConnecting(false);
            stopAudioCapture();
          },

          onerror: (err: any) => {
            console.error('[Voice] Live API error:', err);
            isConnectedRef.current = false;
            setIsConnected(false);
            isDavidSpeakingRef.current = false;
            setIsDavidSpeaking(false);
            setIsConnecting(false);

            const msg = err?.message || 'Unknown connection error';
            if (msg.includes('Requested entity was not found')) {
              setHasKey(false);
            }
            alert(`Voice connection error: ${msg}`);
          },
        },
      });

      sessionRef.current = session;
    } catch (error: any) {
      console.error('[Voice] Failed to start session:', error);
      setIsConnecting(false);
      alert(`Failed to start voice session: ${error?.message || 'Unknown error'}`);
    }
  };

  const stopSession = () => {
    console.log('[Voice] Stopping session...');
    clearSilenceTimer();

    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (err) {
        console.error('[Voice] Error closing session:', err);
      }
      sessionRef.current = null;
    }

    stopAudioCapture();

    isConnectedRef.current = false;
    setIsConnected(false);
    isDavidSpeakingRef.current = false;
    setIsDavidSpeaking(false);
    setIsConnecting(false);

    if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
      try {
        playbackCtxRef.current.close();
      } catch (err) {
        console.error('[Voice] Error closing playback context:', err);
      }
      playbackCtxRef.current = null;
    }
  };

  const startAudioCapture = async () => {
    try {
      console.log('[Voice] Starting microphone capture...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      if (!captureCtxRef.current || captureCtxRef.current.state === 'closed') {
        captureCtxRef.current = new (window.AudioContext || window.webkitAudioContext!)({
          sampleRate: 16000,
        });
      }

      const ctx = captureCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      muteGainRef.current = muteGain;

      processor.onaudioprocess = (e) => {
        if (!sessionRef.current || !isConnectedRef.current || isDavidSpeakingRef.current) {
          return;
        }

        const input = e.inputBuffer.getChannelData(0);

        let energy = 0;
        for (let i = 0; i < input.length; i++) {
          energy += Math.abs(input[i]);
        }
        const average = energy / input.length;

        if (average < 0.003) {
          scheduleAudioStreamEnd();
          return;
        }

        clearSilenceTimer();

        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Audio = btoa(binary);

        try {
          sessionRef.current.sendRealtimeInput({
            audio: {
              data: base64Audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch (err) {
          console.error('[Voice] Failed to send audio chunk:', err);
        }
      };

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(ctx.destination);

      setIsListening(true);
      console.log('[Voice] Microphone capture active');
    } catch (err) {
      console.error('[Voice] Microphone access denied:', err);
      alert('Microphone access is required for voice chat.');
      stopSession();
    }
  };

  const stopAudioCapture = () => {
    console.log('[Voice] Stopping audio capture...');
    clearSilenceTimer();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (muteGainRef.current) {
      muteGainRef.current.disconnect();
      muteGainRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (captureCtxRef.current && captureCtxRef.current.state !== 'closed') {
      try {
        captureCtxRef.current.close();
      } catch (err) {
        console.error('[Voice] Error closing capture context:', err);
      }
      captureCtxRef.current = null;
    }

    setIsListening(false);
  };

  const playAudioChunk = async (base64Data: string) => {
    const context = await getPlaybackContext();

    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const pcm16 = new Int16Array(bytes.buffer);
    if (!pcm16.length) return;

    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    const buffer = context.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    await new Promise<void>((resolve) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => resolve();
      source.start(0);
    });
  };

  if (!hasProAccess(profile)) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockCard}>
          <Lock color="#4F46E5" size={48} style={{ marginBottom: 20 }} />
          <Text style={styles.lockTitle}>Pro Feature</Text>
          <Text style={styles.lockText}>
            Upgrade to Pro to experience real-time voice conversations with David.
          </Text>
          <TouchableOpacity style={styles.upgradeButton} onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.upgradeButtonText}>Upgrade Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles color="#4F46E5" size={24} />
        <Text style={styles.title}>Voice with David</Text>
        <Text style={styles.subtitle}>Real-time Spiritual Companion</Text>
      </View>

      <View style={styles.visualizerContainer}>
        {isConnected && <View style={[styles.pulseRing, isDavidSpeaking && styles.pulseRingActive]} />}

        <View style={[styles.mainCircle, isConnected && styles.mainActive]}>
          {isConnected ? (
            isDavidSpeaking ? (
              <Sparkles color="#d4af37" size={48} />
            ) : (
              <Mic color="#fff" size={48} />
            )
          ) : (
            <MicOff color="#9CA3AF" size={48} />
          )}
        </View>
      </View>

      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>
          {isConnecting
            ? 'Connecting...'
            : isDavidSpeaking
              ? 'David is speaking...'
              : isConnected
                ? 'David is listening...'
                : 'Tap to start conversation'}
        </Text>
      </View>

      {davidText && (
        <View style={styles.textFallback}>
          <Text style={styles.textFallbackLabel}>David says:</Text>
          <Text style={styles.textFallbackContent}>{davidText}</Text>
        </View>
      )}

      {!hasKey && (
        <TouchableOpacity style={styles.keyWarning} onPress={handleOpenKeySelector}>
          <Text style={styles.keyWarningText}>⚠️ API Key Setup Required (Tap here)</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.actionButton, isConnected ? styles.stopButton : styles.startButton]}
        onPress={isConnected ? stopSession : startSession}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.actionButtonText}>{isConnected ? 'End Session' : 'Start Conversation'}</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.disclaimer}>
        David is an AI spiritual companion. For professional guidance or pastoral care, please consult your
        local church or a qualified advisor.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 60,
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
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  mainCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
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
  pulseRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(212, 175, 55, 0.3)',
    zIndex: 1,
  },
  pulseRingActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.5)',
  },
  statusContainer: {
    marginBottom: 40,
  },
  statusText: {
    fontSize: 14,
    color: '#f5d77a',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    marginTop: 40,
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.5)',
    textAlign: 'center',
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  textFallback: {
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  textFallbackLabel: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  textFallbackContent: {
    color: '#f5d77a',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
});