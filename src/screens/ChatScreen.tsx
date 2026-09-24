import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BookOpen, MoreHorizontal, Send, Square, ThumbsDown, ThumbsUp, UserCircle2, Volume2 } from 'lucide-react';
import { generateSpeech, SPEECH_USER_TAP } from '../services/ai';
import { ChatMessage } from '../types';
import { saveAIFeedback, supabase } from '../services/supabase';
import { createCheckoutSession, type CheckoutPlan } from '../services/stripe';
import { useUser } from '../UserContext';
import { getDavidGreeting } from '../constants/persona';
import DailyLimitUpgrade from '../components/DailyLimitUpgrade';
import { trackEvent } from '../services/analytics';
import { APP_COLORS, APP_FONTS } from '../designSystem';

const LAST_GREETING_KEY = 'david:last-greeting';

const readLastGreeting = (): string | null => {
  try { return window.localStorage.getItem(LAST_GREETING_KEY); } catch { return null; }
};

const writeLastGreeting = (greeting: string): void => {
  try { window.localStorage.setItem(LAST_GREETING_KEY, greeting); } catch { /* harmless */ }
};

export default function ChatScreen({ navigation, route }: any) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const { profile } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const initialPromptHandledRef = useRef<string | null>(null);

  const isPaid = profile?.role === 'owner'
    || profile?.subscription_tier === 'owner'
    || profile?.subscription_tier === 'plus'
    || profile?.subscription_tier === 'pro';

  const submitMessage = async (rawText: string, baseMessages: ChatMessage[] = messages, clearComposer = true) => {
    const trimmedInput = rawText.trim();
    if (!trimmedInput || loading) return;

    if (!supabase) {
      setMessages((prev) => [...prev, { role: 'assistant', content: "I can't connect right now. Please refresh and try again." }]);
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: trimmedInput };
    const nextMessages = [...baseMessages, userMessage];
    const modelMessageIndex = nextMessages.length;
    setMessages([...nextMessages, { role: 'assistant', content: '…' }]);
    if (clearComposer) setInput('');
    setLoading(true);

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error('Your sign-in session expired. Please sign in again.');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) throw new Error('The app connection is not configured.');

      const response = await fetch(`${supabaseUrl}/functions/v1/david-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ message: trimmedInput, mode: 'chat' }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 429 || data?.limitReached || data?.code === 'DAILY_LIMIT_REACHED') {
        trackEvent('chat_limit_reached');
        setLimitReached(true);
        setMessages(baseMessages);
        if (clearComposer) setInput(trimmedInput);
        return;
      }
      if (!response.ok) throw new Error(data?.error || data?.message || 'David could not respond right now.');

      const reply = typeof data?.reply === 'string' ? data.reply.trim() : '';
      if (!reply) throw new Error('David returned an empty response.');
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (error: any) {
      console.error('Chat Error:', error);
      let errorMessage = error?.message || "I'm having a bit of trouble connecting right now. Let's try again in a moment.";
      if (error?.message?.includes('quota') || error?.message?.includes('rate limit')) {
        errorMessage = "I need a short breather — a lot of people are talking with me right now. Try me again in a few minutes.";
      }
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > modelMessageIndex) {
          updated[modelMessageIndex] = { role: 'assistant', content: errorMessage };
          return updated;
        }
        return [...prev, { role: 'assistant', content: errorMessage }];
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialPrompt = typeof route?.params?.initialPrompt === 'string' ? route.params.initialPrompt.trim() : '';
    const initialPromptKey = `${route?.params?.submittedAt || ''}:${initialPrompt}`;
    if (initialPrompt) {
      if (initialPromptHandledRef.current === initialPromptKey) return;
      initialPromptHandledRef.current = initialPromptKey;
      void submitMessage(initialPrompt, [], false);
      return;
    }

    let cancelled = false;
    const openWithGreeting = async () => {
      let isReturning = false;
      let daysSinceLastChat: number | null = null;
      let firstName: string | undefined;
      try {
        if (supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          const metadata: any = session?.user?.user_metadata || {};
          firstName = metadata.first_name || metadata.full_name || metadata.name || undefined;
          const { data } = await supabase.from('david_conversation_memory').select('created_at').order('created_at', { ascending: false }).limit(1);
          const lastAt = data?.[0]?.created_at;
          if (lastAt) {
            isReturning = true;
            const elapsed = Date.now() - new Date(lastAt).getTime();
            if (Number.isFinite(elapsed) && elapsed >= 0) daysSinceLastChat = elapsed / (1000 * 60 * 60 * 24);
          }
        }
      } catch (error) {
        console.warn('Greeting continuity lookup failed:', error);
      }
      if (cancelled) return;
      const greetingContext = { firstName, isReturning, daysSinceLastChat, lastGreeting: readLastGreeting() };
      const greeting = getDavidGreeting(greetingContext);
      writeLastGreeting(greeting);
      setMessages([{ role: 'assistant', content: greeting }]);
    };
    void openWithGreeting();
    return () => { cancelled = true; };
  }, [route?.params?.initialPrompt, route?.params?.submittedAt, profile?.id]);

  useEffect(() => () => {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
  }, []);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const handleFeedback = async (index: number, type: 'up' | 'down') => {
    const message = messages[index];
    if (!message || message.role !== 'assistant' || !profile) return;
    setMessages((prev) => prev.map((msg, i) => i === index ? { ...msg, feedback: msg.feedback === type ? undefined : type } : msg));
    await saveAIFeedback(profile.id, 'chat', message.content, type === 'up');
  };

  const stopSpeaking = () => {
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    setSpeakingIndex(null);
  };

  const speakMessage = async (index: number, text: string) => {
    if (speakingIndex === index) return stopSpeaking();
    stopSpeaking();
    setSpeakingIndex(index);
    try {
      const audioUrl = await generateSpeech(text, { source: SPEECH_USER_TAP });
      if (!audioUrl) return setSpeakingIndex(null);
      const audio = new Audio(audioUrl);
      audio.volume = 0.55;
      currentAudioRef.current = audio;
      audio.onended = () => { setSpeakingIndex(null); URL.revokeObjectURL(audioUrl); currentAudioRef.current = null; };
      audio.onerror = () => { setSpeakingIndex(null); URL.revokeObjectURL(audioUrl); currentAudioRef.current = null; };
      await audio.play();
    } catch { setSpeakingIndex(null); }
  };

  const handleUpgrade = async (plan: CheckoutPlan) => {
    if (upgradeLoading) return;
    setUpgradeLoading(true);
    try {
      trackEvent('checkout_started', { plan, from: 'chat_limit' });
      await createCheckoutSession(plan);
    } catch (error: any) {
      setUpgradeLoading(false);
      setLimitReached(false);
      setMessages((prev) => [...prev, { role: 'assistant', content: error?.message || "I couldn't open checkout just now. Please try again in a moment." }]);
    }
  };

  if (limitReached && !isPaid) {
    return <DailyLimitUpgrade onUpgradePlus={() => void handleUpgrade('plus')} onUpgradePro={() => void handleUpgrade('pro')} onDismiss={() => setLimitReached(false)} busy={upgradeLoading} />;
  }

  const firstUserMessage = messages.find((message) => message.role === 'user')?.content;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.layout, compact && styles.layoutCompact]}>
        {!compact && (
          <View style={styles.sidebar}>
            <Text style={styles.sidebarTitle}>CONVERSATIONS</Text>
            <TouchableOpacity style={styles.newChatButton} onPress={() => { setMessages([]); setInput(''); }}>
              <Text style={styles.newChatText}>+ New Chat</Text>
            </TouchableOpacity>
            <View style={styles.historyGroup}>
              <Text style={styles.historyGroupTitle}>TODAY</Text>
              {firstUserMessage ? <Text style={styles.historyItem} numberOfLines={1}>{firstUserMessage}  ›</Text> : <Text style={styles.historyEmpty}>No conversations yet.</Text>}
            </View>
          </View>
        )}

        <View style={styles.chatPanel}>
          <View style={styles.chatHeader}>
            <View style={styles.davidIdentity}>
              <View style={styles.avatar}><UserCircle2 size={27} color={APP_COLORS.gold} /></View>
              <View><Text style={styles.davidName}>David</Text><Text style={styles.davidSubtitle}>A calm spiritual companion</Text></View>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Voice')} accessibilityRole="button" accessibilityLabel="Open David voice">
              <MoreHorizontal size={20} color={APP_COLORS.gold} />
            </TouchableOpacity>
          </View>

          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <BookOpen size={52} color={APP_COLORS.gold} strokeWidth={1.3} />
              <Text style={styles.emptyTitle}>Start a conversation</Text>
              <Text style={styles.emptyText}>Share what’s on your mind, ask a question, or simply{`\n`}tell David how you’re feeling.</Text>
            </View>
          ) : (
            <ScrollView ref={scrollViewRef} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled">
              {messages.map((msg, index) => (
                <View key={index} style={[styles.messageRow, msg.role === 'user' && styles.userMessageRow]}>
                  <Text style={styles.messageAuthor}>{msg.role === 'user' ? 'YOU' : 'DAVID'}</Text>
                  <Text style={[styles.messageText, msg.role === 'user' && styles.userMessageText]}>{msg.content}</Text>
                  {msg.role === 'assistant' && msg.content !== '…' && (
                    <View style={styles.messageActions}>
                      <TouchableOpacity onPress={() => speakMessage(index, msg.content)}>{speakingIndex === index ? <Square size={13} color={APP_COLORS.gold} /> : <Volume2 size={14} color={APP_COLORS.muted} />}</TouchableOpacity>
                      <TouchableOpacity onPress={() => handleFeedback(index, 'up')}><ThumbsUp size={14} color={msg.feedback === 'up' ? APP_COLORS.gold : APP_COLORS.muted} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => handleFeedback(index, 'down')}><ThumbsDown size={14} color={msg.feedback === 'down' ? '#ef6a72' : APP_COLORS.muted} /></TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
              {loading && <ActivityIndicator size="small" color={APP_COLORS.gold} style={{ marginVertical: 8 }} />}
            </ScrollView>
          )}

          <View style={styles.composerRow}>
            <TextInput
              style={styles.composer}
              placeholder="Type a message..."
              placeholderTextColor="rgba(255,248,231,0.46)"
              value={input}
              onChangeText={setInput}
              multiline
              returnKeyType="send"
              onSubmitEditing={() => void submitMessage(input)}
              onKeyPress={(e: any) => {
                if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault?.();
                  void submitMessage(input);
                }
              }}
            />
            <TouchableOpacity style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]} onPress={() => void submitMessage(input)} disabled={!input.trim() || loading}>
              <Send size={19} color={APP_COLORS.navyDeep} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: APP_COLORS.navy },
  layout: { flex: 1, flexDirection: 'row', minHeight: 0, padding: 10, gap: 10 },
  layoutCompact: { padding: 8 },
  sidebar: { width: 230, borderWidth: 1, borderColor: APP_COLORS.border, backgroundColor: APP_COLORS.navyDeep, padding: 12 },
  sidebarTitle: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  newChatButton: { minHeight: 38, backgroundColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  newChatText: { color: APP_COLORS.navyDeep, fontFamily: APP_FONTS.sans, fontSize: 10, fontWeight: '800' },
  historyGroup: { marginBottom: 16 },
  historyGroupTitle: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 9, fontWeight: '700', marginBottom: 8 },
  historyItem: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 10, lineHeight: 24 },
  historyEmpty: { color: APP_COLORS.muted, fontFamily: APP_FONTS.sans, fontSize: 10, lineHeight: 18 },
  chatPanel: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: APP_COLORS.border, backgroundColor: APP_COLORS.navyDeep },
  chatHeader: { minHeight: 66, borderBottomWidth: 1, borderBottomColor: APP_COLORS.borderSoft, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  davidIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderWidth: 2, borderColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  davidName: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 14, fontWeight: '700' },
  davidSubtitle: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 9, marginTop: 2 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyTitle: { color: APP_COLORS.cream, fontFamily: APP_FONTS.display, fontSize: 18, fontWeight: '600', marginTop: 14 },
  emptyText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 7 },
  messages: { flex: 1, minHeight: 0 },
  messagesContent: { padding: 18 },
  messageRow: { width: '88%', alignSelf: 'flex-start', marginBottom: 18 },
  userMessageRow: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageAuthor: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 8, fontWeight: '700', letterSpacing: 1, marginBottom: 5 },
  messageText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.display, fontSize: 15, lineHeight: 23 },
  userMessageText: { color: APP_COLORS.goldSoft, textAlign: 'right' },
  messageActions: { flexDirection: 'row', gap: 10, marginTop: 7, alignItems: 'center' },
  composerRow: { minHeight: 60, borderTopWidth: 1, borderTopColor: APP_COLORS.borderSoft, flexDirection: 'row', alignItems: 'stretch', padding: 10 },
  composer: { flex: 1, borderWidth: 1, borderColor: APP_COLORS.border, backgroundColor: APP_COLORS.navy, color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 11, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 100 },
  sendButton: { width: 48, marginLeft: 10, backgroundColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.38 },
});
