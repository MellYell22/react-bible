import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Send, Mic, ThumbsUp, ThumbsDown, Volume2, Square } from 'lucide-react';
import { getChatResponseStream, generateSpeech, ChatHistoryMessage } from '../services/ai';
import { ChatMessage } from '../types';
import { saveAIFeedback } from '../services/supabase';
import { useUser } from '../UserContext';

export default function ChatScreen({ navigation }: any) {
  const { profile } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const DAVID_OPENING_GREETINGS = [
      "Hey… I'm glad you came back.",
      "Hey. What's been on your mind today?",
      "I'm here. What's going on?",
      "Hey… how's your heart feeling today?",
      "It's Good To Hear Your Voice, Hows Things Been Going",
      "What's been weighing on you lately?",
      "Hey… tell me what's been going on.",
      "Hey, Lets Talk. Im All Ears",
      "Everything Good With You?",
    ];
    const randomGreeting = DAVID_OPENING_GREETINGS[Math.floor(Math.random() * DAVID_OPENING_GREETINGS.length)];
    setMessages([{ role: 'assistant', content: randomGreeting }]);
  }, []);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmedInput };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const history: ChatHistoryMessage[] = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }));
      history.push({ role: 'user', content: userMessage.content });

      const modelMessageIndex = messages.length + 1;
      // Add thinking indicator
      setMessages(prev => [...prev, { role: 'assistant', content: "David is reflecting…" }]);

      // Natural delay (1-2 seconds) before response starts
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

      // Clear thinking indicator and start streaming response
      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[modelMessageIndex] = { role: 'assistant', content: "" };
        return newMessages;
      });

      const response = await getChatResponseStream(history, (fullText) => {
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[modelMessageIndex] = { role: 'assistant', content: fullText };
          return newMessages;
        });
      }, profile?.preferred_response_length || 'medium');

      if (!response) {
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[modelMessageIndex] = { role: 'assistant', content: "Something didn't come through clearly. Try saying that again, a little slower." };
          return newMessages;
        });
      }
    } catch (error: any) {
      console.error("Chat Error:", error);
      let errorMessage = "I'm having a bit of trouble connecting right now. Let's try again in a moment.";
      if (error?.message?.includes("API_KEY_INVALID") || error?.message?.includes("API key not found")) {
        errorMessage = "It looks like the API key is missing or invalid. Please ensure the OPENAI_API_KEY is set in the environment.";
      } else if (error?.message?.includes("quota")) {
        errorMessage = "I've reached my daily limit for conversations. Please try again later.";
      }
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length > messages.length + 1) {
          newMessages[messages.length + 1] = { role: 'assistant', content: errorMessage };
          return newMessages;
        }
        return [...prev, { role: 'assistant', content: errorMessage }];
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (index: number, type: 'up' | 'down') => {
    const message = messages[index];
    if (!message || message.role !== 'assistant' || !profile) return;
    const isHelpful = type === 'up';
    setMessages(prev => prev.map((msg, i) =>
      i === index ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg
    ));
    await saveAIFeedback(profile.id, 'chat', message.content, isHelpful);
  };

  const stopSpeaking = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setSpeakingIndex(null);
  };

  const speakMessage = async (index: number, text: string) => {
    if (speakingIndex === index) {
      stopSpeaking();
      return;
    }
    stopSpeaking();
    setSpeakingIndex(index);
    try {
      // generateSpeech returns a blob URL — use HTML Audio directly
      const audioUrl = await generateSpeech(text);
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;
        audio.onended = () => {
          setSpeakingIndex(null);
          URL.revokeObjectURL(audioUrl);
          currentAudioRef.current = null;
        };
        audio.onerror = () => {
          setSpeakingIndex(null);
          URL.revokeObjectURL(audioUrl);
          currentAudioRef.current = null;
        };
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => setSpeakingIndex(null));
        }
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
            {msg.role === 'assistant' && (
              <View style={styles.feedbackContainer}>
                <TouchableOpacity
                  onPress={() => speakMessage(index, msg.content)}
                  style={styles.feedbackButton}
                >
                  {speakingIndex === index ? (
                    <Square size={14} color="#d4af37" fill="#d4af37" />
                  ) : (
                    <Volume2 size={14} color="rgba(212, 175, 55, 0.6)" />
                  )}
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => handleFeedback(index, 'up')} style={styles.feedbackButton}>
                  <ThumbsUp
                    size={14}
                    color={msg.feedback === 'up' ? '#d4af37' : 'rgba(212, 175, 55, 0.4)'}
                    fill={msg.feedback === 'up' ? '#d4af37' : 'transparent'}
                  />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleFeedback(index, 'down')} style={styles.feedbackButton}>
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
            if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={loading || !input.trim()}
        >
          <Send color="#fff" size={20} opacity={(!input.trim() || loading) ? 0.5 : 1} />
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
    paddingTop: 40,
    paddingBottom: 12,
    paddingHorizontal: 18,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.1)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSubtitle: {
    fontSize: 8,
    color: '#f5d77a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
    opacity: 0.8,
  },
  voiceSwitchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  voiceSwitchText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#0b1e3d',
    marginLeft: 6,
    letterSpacing: 0.8,
  },
  chatContainer: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 11,
    borderRadius: 16,
    marginBottom: 6,
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
    fontSize: 14,
    lineHeight: 20,
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
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.05)',
    paddingTop: 5,
    justifyContent: 'flex-end',
  },
  feedbackButton: {
    marginLeft: 8,
    padding: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#0f2a52',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    maxHeight: 100,
    fontSize: 14,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  sendButton: {
    backgroundColor: '#d4af37',
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(212, 175, 55, 0.3)',
    shadowOpacity: 0,
    elevation: 0,
  },
});
