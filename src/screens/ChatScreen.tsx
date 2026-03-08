import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Send, Mic, ThumbsUp, ThumbsDown } from 'lucide-react';
import { getChatResponse } from '../services/gemini';
import { ChatMessage, Profile } from '../types';
import { supabase } from '../services/supabase';

export default function ChatScreen({ navigation }: any) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'model', content: "Hello, I'm David. How can I encourage you today?" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

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
      const history = messages.map(msg => ({
        role: msg.role as 'user' | 'model',
        parts: [{ text: msg.content }]
      }));
      history.push({ role: 'user', parts: [{ text: userMessage.content }] });

      const response = await getChatResponse(history);
      setMessages(prev => [...prev, { role: 'model', content: response || "I'm sorry, I couldn't process that." }]);
    } catch (error: any) {
      console.error("Chat Error:", error);
      let errorMessage = "I'm having a bit of trouble connecting right now. Let's try again in a moment.";
      
      if (error?.message?.includes("API_KEY_INVALID") || error?.message?.includes("API key not found")) {
        errorMessage = "It looks like the API key is missing or invalid. Please ensure the GEMINI_API_KEY is set in the environment.";
      } else if (error?.message?.includes("quota")) {
        errorMessage = "I've reached my daily limit for conversations. Please try again later.";
      }
      
      setMessages(prev => [...prev, { role: 'model', content: errorMessage }]);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = (index: number, type: 'up' | 'down') => {
    setMessages(prev => prev.map((msg, i) => 
      i === index ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg
    ));
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
