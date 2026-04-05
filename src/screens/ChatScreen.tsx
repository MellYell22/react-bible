import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Send, Mic, ThumbsUp, ThumbsDown, Volume2, Square, VolumeX } from 'lucide-react';
import { getChatResponse, getChatResponseStream, generateSpeech } from '../services/gemini';
import { ChatMessage, Profile } from '../types';
import { supabase } from '../services/supabase';
import { useMusic } from '../MusicContext';
import { findSong, extractSongTitle, openYouTubeSearch } from '../utils/music';

export default function ChatScreen({ navigation }: any) {
  const { playSong, playbackError } = useMusic();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', content: "Hello, I'm David. How can I encourage you today?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    fetchProfile();
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (playbackError && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'model' && (lastMessage.content.includes("Playing") || lastMessage.content.includes("putting on"))) {
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

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const songTitle = extractSongTitle(userMessage.content);
      if (songTitle) {
        const song = findSong(songTitle);
        if (song && song.isAvailable !== false) {
          playSong(song);
          setMessages(prev => [...prev, { role: 'model', content: `Playing '${song.title}' now...` }]);
          setLoading(false);
          return;
        } else {
          openYouTubeSearch(songTitle);
          setMessages(prev => [...prev, { role: 'model', content: `I couldn't find '${songTitle}' in our library, so I'm opening it on YouTube for you now...` }]);
          setLoading(false);
          return;
        }
      }

      const history = messages.map(msg => ({
        role: msg.role as 'user' | 'model',
        parts: [{ text: msg.content }]
      }));
      history.push({ role: 'user', parts: [{ text: userMessage.content }] });

      // Add an empty model message to start streaming into
      const modelMessageIndex = messages.length + 1;
      setMessages(prev => [...prev, { role: 'model', content: "" }]);

      const response = await getChatResponseStream(history, (fullText) => {
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[modelMessageIndex] = { role: 'model', content: fullText };
          return newMessages;
        });
      });
      
      if (response) {
        // Check David's response for song triggers
        const songTitle = extractSongTitle(response);
        if (songTitle) {
          const song = findSong(songTitle);
          if (song && song.isAvailable !== false) {
            try {
              playSong(song);
            } catch (e) {
              setMessages(prev => {
                const newMessages = [...prev];
                newMessages[modelMessageIndex] = { 
                  role: 'model', 
                  content: response + "\n\nI found the song, but playback did not start. Let me try another way." 
                };
                return newMessages;
              });
            }
          } else {
            // If not in library, try YouTube
            openYouTubeSearch(songTitle);
          }
        }
      } else {
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[modelMessageIndex] = { role: 'model', content: "I'm sorry, I couldn't process that." };
          return newMessages;
        });
      }
    } catch (error: any) {
      console.error("Chat Error:", error);
      let errorMessage = "I'm having a bit of trouble connecting right now. Let's try again in a moment.";
      
      if (error?.message?.includes("API_KEY_INVALID") || error?.message?.includes("API key not found")) {
        errorMessage = "It looks like the API key is missing or invalid. Please ensure the GEMINI_API_KEY is set in the environment.";
      } else if (error?.message?.includes("quota")) {
        errorMessage = "I've reached my daily limit for conversations. Please try again later.";
      }
      
      setMessages(prev => {
        const newMessages = [...prev];
        // If we added an empty message for streaming, replace it. Otherwise append.
        if (newMessages.length > messages.length + 1) {
          newMessages[messages.length + 1] = { role: 'model', content: errorMessage };
          return newMessages;
        }
        return [...prev, { role: 'model', content: errorMessage }];
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = (index: number, type: 'up' | 'down') => {
    setMessages(prev => prev.map((msg, i) => 
      i === index ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg
    ));
  };

  const stopSpeaking = () => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch (e) {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    setSpeakingIndex(null);
  };

  const speakMessage = async (index: number, text: string) => {
    if (speakingIndex === index) {
      stopSpeaking();
      return;
    }
    
    // Stop any current playback
    stopSpeaking();
    
    setSpeakingIndex(index);
    try {
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const context = audioContextRef.current;
        if (context.state === 'suspended') {
          await context.resume();
        }

        const binary = atob(base64Audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        const pcmData = new Int16Array(bytes.buffer.slice(0, bytes.buffer.byteLength - (bytes.buffer.byteLength % 2)));
        const float32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          float32Data[i] = pcmData[i] / 32768.0;
        }
        
        const audioBuffer = context.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);
        
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.onended = () => {
          if (speakingIndex === index) {
            setSpeakingIndex(null);
          }
        };
        currentSourceRef.current = source;
        source.start();
      } else {
        setSpeakingIndex(null);
      }
    } catch (error) {
      console.error("Speech error:", error);
      setSpeakingIndex(null);
    }
  };

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>David</Text>
        </View>
        <Text style={styles.headerSubtitle}>AI Spiritual Companion</Text>
        
        <TouchableOpacity 
          style={styles.voiceSwitchButton}
          onPress={() => navigation.navigate('Voice')}
        >
          <Mic color="#0b1e3d" size={16} />
          <Text style={styles.voiceSwitchText}>TALK TO DAVID</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        ref={scrollViewRef}
        style={styles.chatContainer}
        contentContainerStyle={styles.chatContent}
      >
        {messages.map((msg, index) => (
          <View 
            key={index} 
            style={[
              styles.messageBubble, 
              msg.role === 'user' ? styles.userBubble : styles.modelBubble
            ]}
          >
            <Text style={[
              styles.messageText,
              msg.role === 'user' ? styles.userText : styles.modelText
            ]}>
              {msg.content}
            </Text>
            {msg.role === 'model' && (
              <View style={styles.feedbackContainer}>
                <TouchableOpacity 
                  onPress={() => speakMessage(index, msg.content)}
                  style={styles.feedbackButton}
                >
                  {speakingIndex === index ? (
                    <Square 
                      size={14} 
                      color="#d4af37" 
                      fill="#d4af37"
                    />
                  ) : (
                    <Volume2 
                      size={14} 
                      color="rgba(212, 175, 55, 0.6)" 
                    />
                  )}
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <TouchableOpacity 
                  onPress={() => handleFeedback(index, 'up')}
                  style={styles.feedbackButton}
                >
                  <ThumbsUp 
                    size={14} 
                    color={msg.feedback === 'up' ? '#d4af37' : 'rgba(212, 175, 55, 0.4)'} 
                    fill={msg.feedback === 'up' ? '#d4af37' : 'transparent'}
                  />
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => handleFeedback(index, 'down')}
                  style={styles.feedbackButton}
                >
                  <ThumbsDown 
                    size={14} 
                    color={msg.feedback === 'down' ? '#ef4444' : 'rgba(212, 175, 55, 0.4)'} 
                    fill={msg.feedback === 'down' ? '#ef4444' : 'transparent'}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {loading && (
          <View style={[styles.messageBubble, styles.modelBubble]}>
            <ActivityIndicator color="#4F46E5" size="small" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type your message..."
          value={input}
          onChangeText={setInput}
          multiline
          blurOnSubmit={false}
          onKeyPress={(e: any) => {
            if (Platform.OS === 'web' || Platform.OS === 'ios' || Platform.OS === 'android') {
              if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }
          }}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={loading}>
          <Send color="#fff" size={20} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.1)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontFamily: 'Cinzel',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSubtitle: {
    fontSize: 9,
    color: '#f5d77a',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 2,
    opacity: 0.8,
  },
  voiceSwitchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  voiceSwitchText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0b1e3d',
    marginLeft: 8,
    letterSpacing: 1,
  },
  chatContainer: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 20,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 18,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#d4af37',
    borderBottomRightRadius: 4,
  },
  modelBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f2a52',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Playfair Display',
  },
  userText: {
    color: '#0b1e3d',
    fontWeight: '500',
  },
  modelText: {
    color: '#ffffff',
  },
  feedbackContainer: {
    flexDirection: 'row',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.05)',
    paddingTop: 6,
    justifyContent: 'flex-end',
  },
  feedbackButton: {
    marginLeft: 10,
    padding: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#0f2a52',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxHeight: 100,
    fontSize: 15,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  sendButton: {
    backgroundColor: '#d4af37',
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
});
