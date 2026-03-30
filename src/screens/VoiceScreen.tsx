import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import { Mic, MicOff, Lock, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import { supabase } from '../services/supabase';

const MotionView = motion(View);
import { Profile } from '../types';
import { GoogleGenAI, Modality, StartSensitivity, EndSensitivity } from "@google/genai";
import { hasProAccess } from '../utils/tier';

import { MOODS_DATA } from '../constants/moods';
import { WORSHIP_SONGS } from '../constants/songs';

export default function VoiceScreen({ route, navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const moodParam = route?.params?.mood;
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isDavidThinking, setIsDavidThinking] = useState(false);
  const [isDavidSpeaking, setIsDavidSpeaking] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastResponseText, setLastResponseText] = useState<string | null>(null);
  const [isDavidProcessing, setIsDavidProcessing] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'david', text: string }[]>([]);
  const [currentDavidResponse, setCurrentDavidResponse] = useState("");
  
  const sessionRef = useRef<any>(null);
  const davidResponseRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueue = useRef<string[]>([]);
  const isPlaying = useRef(false);

  const addLog = (msg: string) => {
    console.log(`[VoiceDebug] ${msg}`);
    setDebugLogs(prev => [msg, ...prev].slice(0, 20));
  };

  useEffect(() => {
    fetchProfile();
    checkApiKey();
    return () => {
      stopSession();
    };
  }, []);

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

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) setProfile(data);
    }
  };

  const getAudioContext = (sampleRate = 24000) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
      addLog(`AudioContext created (${sampleRate}Hz)`);
    }
    return audioContextRef.current;
  };

  const startSession = async () => {
    stopSession(); // Ensure clean state before starting
    // CRITICAL: Initialize and resume AudioContext immediately on user gesture
    const context = getAudioContext(16000);
    if (context.state === 'suspended') {
      await context.resume();
      addLog("AudioContext resumed on user gesture");
    }

    if (!hasProAccess(profile)) {
      alert('Voice chat is a Pro feature. Please upgrade to access.');
      return;
    }

    if (!hasKey && (window as any).aistudio) {
      await handleOpenKeySelector();
    }

    setIsConnecting(true);
    setMessages([]);
    setCurrentDavidResponse("");
    davidResponseRef.current = "";
    setError(null);
    setLastResponseText(null);
    setIsDavidProcessing(false);
    setIsDavidThinking(false);
    setIsDavidSpeaking(false);
    addLog("Starting session...");
    try {
      const apiKey = 
        process.env.GEMINI_API_KEY || 
        (process.env as any).API_KEY || 
        (window as any).GEMINI_API_KEY || 
        "";
      
      addLog(`API Key present: ${!!apiKey}`);
      if (!apiKey) {
        setError("Gemini API Key is missing. Please set it in the Secrets panel.");
        setIsConnecting(false);
        return;
      }

      addLog(`Modality check: ${typeof Modality !== 'undefined' ? 'Modality exists' : 'Modality is UNDEFINED'}`);
      const audioModality = typeof Modality !== 'undefined' ? Modality.AUDIO : 'audio';
      addLog(`Using modality: ${audioModality}`);

      const ai = new GoogleGenAI({ apiKey });
      
      const VOICE_MODEL_PRIMARY = "gemini-2.5-flash-native-audio-preview-12-2025";
      const VOICE_MODEL_FALLBACK = "gemini-2.5-flash-native-audio-preview-09-2025";
      const DAVID_VOICE = "Charon"; // Deep, grounded male voice

      const connectWithModel = async (modelName: string) => {
        addLog(`Starting Live connection (${modelName})...`);
        
        // Get mood context if available
        let moodContext = "";
        if (moodParam) {
          const staticMood = MOODS_DATA.find(m => m.key === moodParam.toUpperCase());
          if (staticMood) {
            const moodSongs = WORSHIP_SONGS.filter(s => s.moods.includes(staticMood.key)).slice(0, 2);
            moodContext = `
CONTEXT: The user is currently feeling ${staticMood.label}. 
RELEVANT SCRIPTURES: ${staticMood.scriptures.map(s => `${s.reference}: "${s.verse}"`).join('; ')}
RECOMMENDED SONGS: ${moodSongs.map(s => `"${s.title}" by ${s.artist}`).join(', ')}

When you start the conversation, acknowledge this feeling warmly. Reference one of these scriptures or songs naturally if it fits the flow. Don't force it.`;
          }
        }

        return await ai.live.connect({
          model: modelName,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: DAVID_VOICE,
                  },
                },
              },
              systemInstruction: `You are David, a warm, compassionate male AI Bible companion. You MUST speak in ENGLISH only. This is a real-time voice conversation. 

${moodContext}

IDENTITY:
- You are reassuring, wise, and emotionally grounded.
- You sound like a real person having a conversation, not a robot.
- Use natural phrasing, empathy, and gentle pauses.
- Speak TO the user, not AT them.

MUSIC RECOMMENDATIONS:
- You have access to a library of Gospel music across multiple genres (R&B, Contemporary, Traditional, Worship, Country, Pop, Urban, Choir).
- If a user expresses a mood, you can naturally suggest a song from the RECOMMENDED SONGS list provided in the context.
- Example: "That's a lot to carry... you might like 'Take Me to the King' — it really helps when everything feels heavy. Do you want me to play it?"
- Do NOT force recommendations. Only suggest if it feels helpful and natural.
- Do NOT list songs like a robot.

CONCISENESS (STRICT RULE):
- Keep your responses VERY SHORT (1-2 sentences maximum).
- Do NOT provide long explanations or multiple scriptures unless explicitly asked.
- Prioritize speed and natural conversation flow.

NO META-TALK (STRICT RULE):
- NEVER describe what you are doing (e.g., "I am thinking", "Formulating response", "Crafting a message").
- NEVER use internal labels, planning steps, or reasoning in your output.
- ONLY output the final words you want to speak.

If a mood context is provided above, use it to inform your initial greeting warmly and briefly.`,
            } as any,
          callbacks: {
            onopen: () => {
              addLog(`live session connected with ${modelName}`);
              addLog(`Selected voice: ${DAVID_VOICE} (Male)`);
              addLog(`Forced language: English`);
              setIsConnected(true);
              setIsConnecting(false);
              startAudioCapture();
            },
            onmessage: async (message: any) => {
              try {
                const msgType = Object.keys(message).join(', ');
                addLog(`onmessage: [${msgType}]`);
                
                // Log full structure for first few messages to debug
                if (debugLogs.length < 10) {
                  console.log("[VoiceDebug] Full message structure:", JSON.stringify(message, (key, value) => 
                    key === 'data' && typeof value === 'string' ? `${value.substring(0, 20)}...` : value
                  ));
                }

                if (message.setupComplete) {
                  addLog("Model setup complete");
                }
                
                // Exhaustive search for audio data
                let audioData: string | null = null;
                let textData: string | null = null;

                // Standard path
                if (message.serverContent?.modelTurn?.parts) {
                  for (const part of message.serverContent.modelTurn.parts) {
                    // CRITICAL: Skip thinking/reasoning parts
                    if ((part as any).thought) {
                      addLog("Skipping internal thought part");
                      continue;
                    }
                    
                    if (part.inlineData?.data) {
                      audioData = part.inlineData.data;
                    }
                    if (part.text) {
                      // Final safety filter for meta-talk
                      const isMetaTalk = /^(formulating|offering|crafting|thinking|reasoning|processing)/i.test(part.text.trim());
                      if (!isMetaTalk) {
                        textData = part.text;
                      } else {
                        addLog(`Filtered meta-talk: "${part.text.trim()}"`);
                      }
                    }
                  }
                }
                
                // Alternative paths (just in case)
                if (!audioData && message.audio?.data) audioData = message.audio.data;
                if (!audioData && message.data) audioData = message.data;
                if (!textData && message.text) textData = message.text;

                if (audioData) {
                  addLog(`audio chunk detected: ${audioData.length} bytes (base64)`);
                  audioQueue.current.push(audioData);
                  // Ensure AudioContext is ready before processing
                  const context = getAudioContext();
                  if (context.state === 'suspended') {
                    await context.resume();
                    addLog(`AudioContext resumed before playback: ${context.state}`);
                  }
                  processAudioQueue();
                }

                if (textData) {
                  addLog(`text response received: "${textData}"`);
                  davidResponseRef.current += textData;
                  setCurrentDavidResponse(davidResponseRef.current);
                }

                if (message.serverContent?.modelTurn?.complete) {
                  addLog("Model turn complete");
                  if (davidResponseRef.current) {
                    setMessages(prev => [...prev, { role: 'david', text: davidResponseRef.current }]);
                    davidResponseRef.current = "";
                    setCurrentDavidResponse("");
                  }
                }

                if (message.serverContent?.userTurn) {
                  const userText = message.serverContent.userTurn.parts?.[0]?.text;
                  if (userText) {
                    addLog(`transcript received: "${userText}"`);
                    setMessages(prev => [...prev, { role: 'user', text: userText }]);
                    setIsDavidProcessing(true);
                  }
                }
                
                if (message.serverContent?.interrupted) {
                  addLog("Model interrupted by user speech");
                  setIsDavidSpeaking(false);
                  setIsDavidThinking(false);
                  setIsDavidProcessing(false);
                  audioQueue.current = [];
                  // Stop current audio if playing
                  stopAllAudio();
                }
              } catch (err) {
                addLog(`onmessage error: ${err}`);
              }
            },
            onclose: (event: any) => {
              const reason = event?.reason || 'No reason';
              addLog(`websocket/session closed: ${reason}`);
              setIsConnected(false);
              setIsConnecting(false);
              setIsDavidThinking(false);
              setIsDavidSpeaking(false);
              setIsDavidProcessing(false);
              stopAudioCapture();
            },
            onerror: (err: any) => {
              const errorMsg = err?.message || "Unknown WebSocket error";
              addLog(`WebSocket failed: ${errorMsg}`);
              console.error("Live API Error:", err);
              setIsConnecting(false);
              setIsConnected(false);
              setIsDavidThinking(false);
              setIsDavidSpeaking(false);
              setIsDavidProcessing(false);
              setError(`Connection error: ${errorMsg}`);
              stopAudioCapture();
            },
          },
        });
      };

      try {
        sessionRef.current = await connectWithModel(VOICE_MODEL_PRIMARY);
      } catch (primaryErr: any) {
        const isUnavailable = primaryErr?.message?.includes('503') || primaryErr?.message?.includes('unavailable');
        if (isUnavailable) {
          addLog("Primary model unavailable, trying fallback...");
          try {
            sessionRef.current = await connectWithModel(VOICE_MODEL_FALLBACK);
          } catch (fallbackErr: any) {
            addLog(`Fallback failed: ${fallbackErr.message}`);
            setError("David is currently resting (service unavailable). Please try again in a few minutes.");
            setIsConnecting(false);
          }
        } else {
          addLog(`Connection failed: ${primaryErr.message}`);
          setError(`Connection failed: ${primaryErr.message}`);
          setIsConnecting(false);
        }
      }
    } catch (error: any) {
      addLog(`Setup error: ${error?.message}`);
      console.error(error);
      setIsConnecting(false);
      setIsConnected(false);
      setIsDavidThinking(false);
      setIsDavidSpeaking(false);
      setError(`Failed to connect: ${error?.message}`);
      stopAudioCapture();
    }
  };

  const stopSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    stopAudioCapture();
    setIsConnected(false);
  };

  const startAudioCapture = async () => {
    addLog("Requesting microphone access...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog("Microphone access granted");
      
      const audioContext = getAudioContext(16000);
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      // Use 16000 for input as required by the API
      // Reduced buffer size to 1024 for more frequent updates
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      addLog("ScriptProcessorNode created (1024 buffer size)");
      processorRef.current = processor;

      let silenceFrames = 0;
      const SILENCE_THRESHOLD = 0.001; // Very sensitive to ensure audio is sent
      const SILENCE_LIMIT = 10; // Approx 0.6s at 16k rate with 1024 buffer
      let lastSendTime = 0;

      processor.onaudioprocess = (e) => {
        const session = sessionRef.current;
        // Use sessionRef directly to avoid closure issues with isConnected state
        if (session && !isDavidSpeaking) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Debug: Log buffer info occasionally
          const now = Date.now();
          if (now - lastSendTime > 5000) {
            addLog(`onaudioprocess: buffer size=${inputData.length}, first sample=${inputData[0]?.toFixed(4)}`);
          }

          // Simple silence detection
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) sum += Math.abs(inputData[i]);
          const average = sum / inputData.length;
          
          if (average > SILENCE_THRESHOLD) { 
            silenceFrames = 0;
            setIsDavidThinking(false);
            
            // Convert Float32 to PCM16
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              // Clamp and scale
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Convert to Base64
            const bytes = new Uint8Array(pcmData.buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = btoa(binary);

            try {
              session.sendRealtimeInput({
                audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
              });
              
              if (now - lastSendTime > 2000) {
                addLog(`audio chunk sent to Gemini (${base64Data.length} bytes)`);
                lastSendTime = now;
              }
            } catch (sendErr) {
              addLog(`Send error: ${sendErr}`);
            }
          } else {
            silenceFrames++;
            if (silenceFrames > SILENCE_LIMIT && !isDavidThinking && !isDavidSpeaking) {
              setIsDavidThinking(true);
            }
          }
        } else if (session && isDavidSpeaking) {
          // David is speaking, we don't send audio to prevent echo
        }
      };

      source.connect(processor);
      
      // Silent connection to destination to keep processor alive without feedback
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      addLog("Microphone connected to processor and silent destination");
      
      setIsListening(true);
      addLog("Audio capture started");
    } catch (err: any) {
      addLog(`Mic error: ${err?.message}`);
      console.error("Microphone access denied:", err);
      setError("Microphone access is required for voice chat.");
    }
  };

  const stopAudioCapture = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsListening(false);
  };

  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const stopAllAudio = () => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
  };

  const processAudioQueue = async () => {
    if (isPlaying.current) {
      return;
    }
    if (audioQueue.current.length === 0) {
      return;
    }
    
    isPlaying.current = true;
    setIsDavidSpeaking(true);
    setIsDavidThinking(false);
    
    const context = getAudioContext(24000); // Gemini output is usually 24kHz
    if (nextStartTimeRef.current < context.currentTime) {
      nextStartTimeRef.current = context.currentTime + 0.05; // Reduced delay for faster start
    }
    
    try {
      while (audioQueue.current.length > 0) {
        const chunk = audioQueue.current.shift();
        if (chunk) {
          await playAudio(chunk);
        }
      }
    } catch (err) {
      addLog(`Queue processing error: ${err}`);
    } finally {
      isPlaying.current = false;
      // We don't set isDavidSpeaking to false immediately because audio might still be playing in the future
      // Instead, we'll check if the last scheduled audio has finished
      const checkFinished = setInterval(() => {
        if (context.currentTime >= nextStartTimeRef.current) {
          setIsDavidSpeaking(false);
          clearInterval(checkFinished);
        }
      }, 100);
    }
  };

  const playAudio = async (base64Data: string): Promise<void> => {
    if (!base64Data) return;
    
    try {
      const context = getAudioContext(24000);
      addLog(`AudioContext state before playback: ${context.state}`);
      if (context.state === 'suspended') {
        await context.resume();
        addLog(`AudioContext state after resume: ${context.state}`);
      }
      
      // Decode base64 to binary
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Ensure we have an even number of bytes for Int16Array
      const pcm16Len = Math.floor(len / 2);
      const pcm16 = new Int16Array(bytes.buffer, 0, pcm16Len);
      
      // Convert PCM16 (little-endian) to Float32
      const float32 = new Float32Array(pcm16Len);
      for (let i = 0; i < pcm16Len; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      
      addLog("PCM decoded successfully");
      
      // Create AudioBuffer
      const audioBuffer = context.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      addLog(`AudioBuffer created: duration=${audioBuffer.duration.toFixed(3)}s`);
      
      // Create Source
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      
      // Verify connection
      source.connect(context.destination);
      addLog("node connected to audioContext.destination");
      
      const startTime = Math.max(context.currentTime, nextStartTimeRef.current);
      source.start(startTime);
      addLog(`Playback started: start=${startTime.toFixed(3)}s, now=${context.currentTime.toFixed(3)}s`);
      
      activeSourcesRef.current.push(source);
      
      // Update next start time
      nextStartTimeRef.current = startTime + audioBuffer.duration;
      
      // Cleanup source from active list when done
      source.onended = () => {
        addLog("Playback ended");
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        if (activeSourcesRef.current.length === 0 && audioQueue.current.length === 0) {
          setIsDavidSpeaking(false);
        }
      };
      
      setIsDavidSpeaking(true);
    } catch (err) {
      addLog(`decode/playback failure: ${err}`);
      console.error("Error playing audio chunk:", err);
      
      // Fallback to WAV Blob playback if Web Audio fails
      try {
        addLog("Attempting WAV fallback...");
        playAudioWavFallback(base64Data);
      } catch (fallbackErr) {
        addLog(`WAV fallback failed: ${fallbackErr}`);
      }
    }
  };

  const playAudioWavFallback = (base64Data: string) => {
    // Basic WAV header for 24kHz Mono PCM16
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    
    const binaryString = atob(base64Data);
    const dataLen = binaryString.length;
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);
    
    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataLen, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    
    // "fmt " chunk
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    
    // "data" chunk
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, dataLen, true);
    
    for (let i = 0; i < dataLen; i++) {
      view.setUint8(44 + i, binaryString.charCodeAt(i));
    }
    
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().then(() => {
      addLog("WAV fallback playback started");
    }).catch(e => {
      addLog(`WAV fallback play error: ${e}`);
    });
  };

  const testAudio = async () => {
    addLog("Starting audio output test...");
    try {
      const context = getAudioContext(16000);
      addLog(`Context state: ${context.state}`);
      await context.resume();
      addLog(`Context state after resume: ${context.state}`);
      
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, context.currentTime); // A4
      gainNode.gain.setValueAtTime(0.1, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
      
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      
      addLog("Starting oscillator...");
      oscillator.start();
      oscillator.stop(context.currentTime + 0.5);
      
      alert("Test sound played. If you didn't hear a beep, please check your device volume and browser permissions.");
    } catch (err) {
      addLog(`Test audio error: ${err}`);
      console.error(err);
    }
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

  return (
    <ScrollView style={styles.outerContainer} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Sparkles color="#4F46E5" size={24} />
        <Text style={styles.title}>Voice with David</Text>
        <Text style={styles.subtitle}>Real-time Spiritual Companion</Text>
        
        <View style={styles.connectionIndicator}>
          <View style={[
            styles.statusDot, 
            isConnecting ? styles.dotConnecting : isConnected ? styles.dotConnected : styles.dotDisconnected
          ]} />
          <Text style={[
            styles.connectionText,
            isConnecting ? styles.textConnecting : isConnected ? styles.textConnected : styles.textDisconnected
          ]}>
            {isConnecting ? "Connecting" : isConnected ? "Connected" : "Disconnected"}
          </Text>
        </View>
      </View>

      <View style={styles.visualizerContainer}>
        <AnimatePresence>
          {isConnected && (
            <MotionView
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ 
                scale: isDavidSpeaking ? [1, 1.3, 1] : isListening ? [1, 1.1, 1] : 1,
                opacity: isDavidSpeaking ? [0.3, 0.6, 0.3] : isListening ? [0.2, 0.4, 0.2] : 0.1,
              }}
              transition={{ 
                duration: isDavidSpeaking ? 1.5 : 3, 
                repeat: Infinity,
                ease: "easeInOut" 
              }}
              style={{
                position: 'absolute',
                width: 180,
                height: 180,
                borderRadius: 90,
                backgroundColor: 'rgba(212, 175, 55, 0.3)',
                zIndex: 1,
              }}
            />
          )}
        </AnimatePresence>
        
        <View style={[styles.mainCircle, isConnected && styles.mainActive]}>
          {isConnected ? (
            isDavidSpeaking ? (
              <MotionView
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              >
                <Sparkles color="#d4af37" size={48} />
              </MotionView>
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
          {isConnecting ? "Connecting..." : isDavidSpeaking ? "David is speaking..." : (isDavidProcessing || isDavidThinking) ? "David is typing..." : isConnected ? "David is listening..." : "Tap to start conversation"}
        </Text>
      </View>

      {isConnected && (
        <View style={styles.chatContainer}>
          <ScrollView 
            style={styles.chatScroll} 
            contentContainerStyle={styles.chatContent}
            ref={(ref) => {
              if (ref) {
                // Auto-scroll to bottom
                (ref as any).scrollToEnd({ animated: true });
              }
            }}
          >
            {messages.map((msg, i) => (
              <View key={i} style={[styles.messageBubble, msg.role === 'user' ? styles.userBubble : styles.davidBubble]}>
                <Text style={styles.messageLabel}>{msg.role === 'user' ? 'You' : 'David'}:</Text>
                <Text style={styles.messageText}>{msg.text}</Text>
              </View>
            ))}
            {currentDavidResponse && (
              <View style={[styles.messageBubble, styles.davidBubble]}>
                <Text style={styles.messageLabel}>David:</Text>
                <Text style={styles.messageText}>{currentDavidResponse}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {lastResponseText && isConnected && !messages.length && !currentDavidResponse && (
        <MotionView 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={styles.textFallbackContainer}
        >
          <Text style={styles.textFallbackLabel}>David says:</Text>
          <Text style={styles.textFallbackContent}>{lastResponseText}</Text>
        </MotionView>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
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
          <Text style={styles.actionButtonText}>{isConnected ? "End Session" : "Start Conversation"}</Text>
        )}
      </TouchableOpacity>

      <View style={styles.debugToggleContainer}>
        <TouchableOpacity onPress={() => setShowDebug(!showDebug)}>
          <Text style={styles.debugToggleText}>{showDebug ? "Hide Debug" : "Show Debug"}</Text>
        </TouchableOpacity>
      </View>

      {showDebug && (
        <View style={styles.debugPanel}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>Debug Logs</Text>
            <TouchableOpacity onPress={() => setDebugLogs([])}>
              <Text style={styles.debugClear}>Clear</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.debugScroll} contentContainerStyle={{ paddingBottom: 20 }}>
            {debugLogs.map((log, i) => (
              <Text key={i} style={styles.debugLog}>{`> ${log}`}</Text>
            ))}
          </ScrollView>
        </View>
      )}

      {!isConnected && !isConnecting && (
        <TouchableOpacity style={styles.testButton} onPress={testAudio}>
          <Text style={styles.testButtonText}>Test Audio Output</Text>
        </TouchableOpacity>
      )}
      
      <Text style={styles.disclaimer}>
        David is an AI spiritual companion. For professional guidance or pastoral care, please consult your local church or a qualified advisor.
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
    paddingHorizontal: 30,
    paddingBottom: 40,
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
  connectionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotConnected: {
    backgroundColor: '#4ade80',
    shadowColor: '#4ade80',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  dotConnecting: {
    backgroundColor: '#f5d77a',
    shadowColor: '#f5d77a',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  dotDisconnected: {
    backgroundColor: '#9CA3AF',
  },
  connectionText: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  textConnected: {
    color: '#4ade80',
  },
  textConnecting: {
    color: '#f5d77a',
  },
  textDisconnected: {
    color: '#9CA3AF',
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
  pulseCircle: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    zIndex: 1,
  },
  pulseActive: {
    // In a real app we'd animate this
    transform: [{ scale: 1.2 }],
    opacity: 0.5,
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
    marginTop: 20,
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.5)',
    textAlign: 'center',
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chatContainer: {
    width: '100%',
    height: 200,
    backgroundColor: 'rgba(15, 42, 82, 0.4)',
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    overflow: 'hidden',
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: 12,
  },
  messageBubble: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 12,
    maxWidth: '90%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderBottomRightRadius: 2,
  },
  davidBubble: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(15, 42, 82, 0.8)',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  messageLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#d4af37',
    textTransform: 'uppercase',
    marginBottom: 4,
    letterSpacing: 1,
  },
  messageText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
  },
  testButton: {
    marginTop: 15,
    padding: 10,
  },
  testButtonText: {
    color: '#f5d77a',
    fontSize: 10,
    textDecorationLine: 'underline',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
    maxHeight: 200,
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
  debugClear: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  debugTitle: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  }
});
