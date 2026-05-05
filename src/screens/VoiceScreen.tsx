import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import { Mic, MicOff, Lock, Sparkles, ThumbsUp, ThumbsDown } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import { supabase } from '../services/supabase';

const MotionView = motion(View);
import { Profile, ResponseLength, ChatMessage } from '../types';
import { getChatResponse, generateSpeech } from '../services/ai';
import { hasProAccess } from '../utils/tier';
import { useMusic } from '../MusicContext';
import { findSong, extractSongTitle, openYouTubeSearch } from '../utils/music';
import { saveAIFeedback } from '../services/supabase';

import { MOODS_DATA } from '../constants/moods';
import { WORSHIP_SONGS } from '../constants/songs';

import { useUser } from '../UserContext';

const GREETINGS_POOL = [
  "Hey, I’m David. I’m glad you’re here.",
  "Hey there. What would you like to talk about today?",
  "I’m here with you. What’s on your mind?",
  "Hi, I’m David. You can talk to me about anything.",
  "Hey. Would you like scripture, encouragement, music, or just a conversation?",
  "Hi! How’s your day going so far?",
  "Hey. I'm David. What can I do for you today?",
  "I'm here for whatever you need—scripture, music, or just to talk.",
  "Hey. I’m glad we could connect. What’s up?",
  "Hello. I’m David. What’s on your heart today?",
  "Hey! I'm David. I'm here to listen whenever you're ready.",
  "Hi there. Is there anything specific you'd like to dive into today?",
  "Hey! It's good to talk. What's on your mind?",
  "Hi, I’m David. I’m here for support, scripture, or just to chat.",
  "Hey. I was hoping we'd talk today. What's going on?",
  "Hello! I'm David. What can we explore together right now?",
  "Hey. I'm ready for whatever you want to talk about.",
  "Hi! I'm David. It's a pleasure to be here with you.",
  "Hey. What's the latest in your world today?",
  "Hi there. I'm David. What's your focus for our conversation?"
];

export default function VoiceScreen({ route, navigation }: any) {
  const { playSong, playbackError } = useMusic();
  const { profile } = useUser();
  const [lastGreetingIndex, setLastGreetingIndex] = useState<number>(-1);
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentDavidResponse, setCurrentDavidResponse] = useState("");
  const [lastFeedback, setLastFeedback] = useState<'up' | 'down' | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const addLog = (msg: string) => {
    console.log(`[VoiceDebug] ${msg}`);
    setDebugLogs(prev => [msg, ...prev].slice(0, 20));
  };

  useEffect(() => {
    checkApiKey();
    return () => {
      stopSession();
    };
  }, []);

  useEffect(() => {
    if (playbackError && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && (lastMessage.content.includes("Playing") || lastMessage.content.includes("putting on"))) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (!newMessages[lastIdx].content.includes("playback did not start")) {
            newMessages[lastIdx] = { 
              ...newMessages[lastIdx], 
              content: newMessages[lastIdx].content + "\n\nI found the song, but playback did not start. Let me try another way." 
            };
          }
          return newMessages;
        });
      }
    }
  }, [playbackError]);

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

  const getAudioContext = (sampleRate = 24000) => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
      addLog(`AudioContext created (${sampleRate}Hz)`);
    }
    return audioContextRef.current;
  };

  const startSession = async () => {
    if (!hasProAccess(profile)) {
      alert('Voice chat is a Pro feature. Please upgrade to access.');
      return;
    }

    setIsConnecting(true);
    setMessages([]);
    setError(null);
    setIsDavidProcessing(false);
    setIsDavidThinking(false);
    setIsDavidSpeaking(false);
    
    addLog("Starting David voice session...");
    
    try {
      setIsConnected(true);
      setIsConnecting(false);
      
      // Select random greeting
      let greetingIndex;
      do {
        greetingIndex = Math.floor(Math.random() * GREETINGS_POOL.length);
      } while (greetingIndex === lastGreetingIndex && GREETINGS_POOL.length > 1);
      
      setLastGreetingIndex(greetingIndex);
      const greeting = GREETINGS_POOL[greetingIndex];
      
      const assistantGreeting: ChatMessage = { role: 'assistant', content: greeting };
      setMessages([assistantGreeting]);
      setLastResponseText(greeting);
      
      // Speak the greeting
      await speakMessage(greeting);
    } catch (err: any) {
      addLog(`Session error: ${err?.message}`);
      setError(`Failed to connect: ${err?.message}`);
      setIsConnecting(false);
    }
  };

  const handleVoiceInput = async (text: string) => {
    if (!text.trim()) return;
    
    const newUserMessage: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, newUserMessage]);
    
    setIsDavidProcessing(true);
    setIsDavidThinking(true);
    
    try {
      const history = messages.map(m => ({ 
        role: m.role, 
        content: m.content 
      }));
      
      // Add the new message to history for the API call
      history.push(newUserMessage);
      
      const response = await getChatResponse(history, profile?.preferred_response_length || 'short');
      
      setIsDavidThinking(false);
      setIsDavidProcessing(false);
      setLastResponseText(response);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
      
      // Speak the response
      await speakMessage(response);
    } catch (err: any) {
      addLog(`Chat error: ${err?.message}`);
      setIsDavidThinking(false);
      setIsDavidProcessing(false);
    }
  };

  const speakMessage = async (text: string) => {
    setIsDavidSpeaking(true);
    try {
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const context = audioContextRef.current;
        if (context.state === 'suspended') {
          await context.resume();
        }

        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        // Properly decode the MP3/AAC data from OpenAI
        const audioBuffer = await context.decodeAudioData(bytes.buffer);
        
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.onended = () => {
          setIsDavidSpeaking(false);
          // STOP auto-listening loop to prevent rambling
          // User must manually press the mic to speak again
          setIsListening(false);
        };
        currentSourceRef.current = source;
        source.start();
      } else {
        setIsDavidSpeaking(false);
        setError("David is having trouble speaking right now. Please try again or check your connection.");
        addLog("Speech generation returned null");
      }
    } catch (error) {
      console.error("Speech error:", error);
      setIsDavidSpeaking(false);
      setError("David's voice encountered an error. Please try again.");
      addLog(`Speech error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const startListening = () => {
    if (isDavidSpeaking || !isConnected) return;
    
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addLog("SpeechRecognition not supported in this browser.");
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      addLog("Started listening...");
    };

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      addLog(`Heard: "${text}"`);
      handleVoiceInput(text);
    };

    recognition.onerror = (event: any) => {
      addLog(`Recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      addLog("Listening ended.");
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopSession = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch(e) {}
    }
    setIsConnected(false);
    setIsListening(false);
    setIsDavidSpeaking(false);
    setIsDavidThinking(false);
  };

  const handleFeedback = async (index: number | 'last', type: 'up' | 'down') => {
    const isHelpful = type === 'up';
    
    if (index === 'last') {
      if (!lastResponseText || !profile) return;
      setLastFeedback(type);
      await saveAIFeedback(profile.id, 'chat', lastResponseText, isHelpful);
    } else {
      const message = messages[index];
      if (!message || message.role !== 'assistant' || !profile) return;

      setMessages(prev => prev.map((msg, i) => 
        i === index ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg
      ));

      await saveAIFeedback(profile.id, 'chat', message.content, isHelpful);
    }
  };

  // Recognition was moved to startListening

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
      </View>

      <View style={styles.visualizerContainer}>
        <AnimatePresence>
          {isConnected && (
            <MotionView
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ 
                scale: isDavidSpeaking ? [1, 1.4, 1] : isListening ? [1, 1.15, 1] : 1,
                opacity: isDavidSpeaking ? [0.4, 0.7, 0.4] : isListening ? [0.2, 0.5, 0.2] : 0.1,
              }}
              transition={{ 
                duration: isDavidSpeaking ? 0.8 : 2, 
                repeat: Infinity,
                ease: "easeInOut" 
              }}
              style={{
                position: 'absolute',
                width: 200,
                height: 200,
                borderRadius: 100,
                backgroundColor: 'rgba(212, 175, 55, 0.4)',
                zIndex: 1,
              }}
            />
          )}
        </AnimatePresence>
        
        <View style={[styles.mainCircle, isConnected && styles.mainActive]}>
          {isConnected ? (
            isDavidSpeaking ? (
              <MotionView
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 0.4, repeat: Infinity }}
              >
                <Sparkles color="#d4af37" size={56} />
              </MotionView>
            ) : (
              <Mic color="#fff" size={56} />
            )
          ) : (
            <MicOff color="#9CA3AF" size={56} />
          )}
        </View>
      </View>

      {/* Status text removed for seamless UX */}

      {/* Chat transcript removed for seamless voice-first UX */}

      {lastResponseText && lastResponseText.trim().length > 0 && isConnected && !messages.length && (!currentDavidResponse || currentDavidResponse.trim().length === 0) && (
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
    marginBottom: 30,
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
    marginBottom: 20,
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
