import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Send, PhoneCall, ThumbsUp, ThumbsDown, Volume2, Square } from 'lucide-react';
import { generateSpeech, SPEECH_USER_TAP } from '../services/ai';
import { ChatMessage } from '../types';
import { saveAIFeedback, supabase } from '../services/supabase';
import { createCheckoutSession, type CheckoutPlan } from '../services/stripe';
import { useUser } from '../UserContext';
import { getDavidGreeting } from '../constants/persona';
import DailyLimitUpgrade from '../components/DailyLimitUpgrade';
import { trackEvent } from '../services/analytics';

const LAST_GREETING_KEY = 'david:last-greeting';

/** Remembering the last greeting is what stops "Hey. I'm David." twice in a row. */
const readLastGreeting = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_GREETING_KEY);
  } catch {
    return null;
  }
};

const writeLastGreeting = (greeting: string): void => {
  try {
    window.localStorage.setItem(LAST_GREETING_KEY, greeting);
  } catch {
    // Private browsing or blocked storage — harmless, greeting variety just
    // falls back to random.
  }
};

export default function ChatScreen({ navigation, route }: any) {
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

  const submitMessage = async (
    rawText: string,
    baseMessages: ChatMessage[] = messages,
    clearComposer: boolean = true,
  ) => {
    const trimmedInput = rawText.trim();
    if (!trimmedInput || loading) return;

    if (!supabase) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I can't connect right now. Please refresh and try again.",
      }]);
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: trimmedInput };
    const nextMessages = [...baseMessages, userMessage];
    const modelMessageIndex = nextMessages.length;

    // Neutral typing placeholder — no "David is reflecting/thinking" status text.
    // The bubble simply shows a quiet ellipsis until the real reply replaces it.
    setMessages([...nextMessages, { role: 'assistant', content: '…' }]);
    if (clearComposer) setInput('');
    setLoading(true);

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error('Your sign-in session expired. Please sign in again.');
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        throw new Error('The app connection is not configured.');
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/david-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          message: trimmedInput,
          mode: 'chat',
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 429 || data?.limitReached || data?.code === 'DAILY_LIMIT_REACHED') {
        // The free daily limit is not a failure — it is the paywall. Roll the
        // transcript back to before this turn so the conversation stays clean,
        // then hand over to the upgrade screen.
        trackEvent('chat_limit_reached');
        setLimitReached(true);
        setMessages(baseMessages);
        if (clearComposer) setInput(trimmedInput);
        return;
      }

      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'David could not respond right now.');
      }

      const reply = typeof data?.reply === 'string' ? data.reply.trim() : '';
      if (!reply) {
        throw new Error('David returned an empty response.');
      }

      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (error: any) {
      console.error('Chat Error:', error);
      let errorMessage = error?.message || "I'm having a bit of trouble connecting right now. Let's try again in a moment.";
      if (error?.message?.includes('quota') || error?.message?.includes('rate limit')) {
        errorMessage = "I need a short breather — a lot of people are talking with me right now. Try me again in a few minutes.";
      }
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length > modelMessageIndex) {
          newMessages[modelMessageIndex] = { role: 'assistant', content: errorMessage };
          return newMessages;
        }
        return [...prev, { role: 'assistant', content: errorMessage }];
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialPrompt = typeof route?.params?.initialPrompt === 'string'
      ? route.params.initialPrompt.trim()
      : '';
    const initialPromptKey = `${route?.params?.submittedAt || ''}:${initialPrompt}`;

    if (initialPrompt) {
      if (initialPromptHandledRef.current === initialPromptKey) return;
      initialPromptHandledRef.current = initialPromptKey;
      void submitMessage(initialPrompt, [], false);
      return;
    }

    // David should not greet a person he already knows the same way he greets
    // a stranger. Look up when they last talked so the opening line matches the
    // actual relationship instead of re-introducing him every single day.
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

          const { data } = await supabase
            .from('david_conversation_memory')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1);

          const lastAt = data?.[0]?.created_at;
          if (lastAt) {
            isReturning = true;
            const elapsed = Date.now() - new Date(lastAt).getTime();
            if (Number.isFinite(elapsed) && elapsed >= 0) {
              daysSinceLastChat = elapsed / (1000 * 60 * 60 * 24);
            }
          }
        }
      } catch (error) {
        // A greeting is never worth failing a screen over — fall back to
        // meeting them fresh.
        console.warn('Greeting continuity lookup failed:', error);
      }

      if (cancelled) return;

      const lastGreeting = readLastGreeting();
      const greeting = getDavidGreeting({
        firstName,
        isReturning,
        daysSinceLastChat,
        lastGreeting,
      });

      writeLastGreeting(greeting);
      setMessages([{ role: 'assistant', content: greeting }]);
    };

    void openWithGreeting();

    return () => {
      cancelled = true;
    };
  }, [route?.params?.initialPrompt, route?.params?.submittedAt, profile?.id]);

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  const handleSend = async () => {
    await submitMessage(input);
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
      // generateSpeech returns a blob URL — use HTML Audio directly.
      // Typed chat is silent. Audio here only ever comes from this button.
      const audioUrl = await generateSpeech(text, { source: SPEECH_USER_TAP });
      if (audioUrl) {
        const audio = new Audio(audioUrl);
        audio.volume = 0.55;
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
      console.error('Speech error:', error);
      setSpeakingIndex(null);
    }
  };

  const handleUpgrade = async (plan: CheckoutPlan) => {
    if (upgradeLoading) return;
    setUpgradeLoading(true);
    try {
      // Fired before the redirect: once Stripe takes over the tab, this code
      // no longer runs, so a post-redirect event would never be sent.
      trackEvent('checkout_started', { plan, from: 'chat_limit' });
      // Redirects to Stripe Checkout on success, so this rarely returns.
      await createCheckoutSession(plan);
    } catch (error: any) {
      console.error('[Chat] Upgrade could not start:', error?.message || error);
      setUpgradeLoading(false);
      setLimitReached(false);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: error?.message || "I couldn't open checkout just now. Please try again in a moment.",
      }]);
    }
  };

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // Free account has spent today's conversations — show the upgrade screen
  // instead of the composer. Dismissing returns them to the transcript.
  if (limitReached && !isPaid) {
    return (
      <DailyLimitUpgrade
        onUpgradePlus={() => void handleUpgrade('plus')}
        onUpgradePro={() => void handleUpgrade('pro')}
        onDismiss={() => setLimitReached(false)}
        busy={upgradeLoading}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} role="heading" aria-level={1}>David</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          {isPaid ? 'Unlimited text chat' : '5 free messages daily'}
        </Text>
        <TouchableOpacity
          style={styles.headerCallButton}
          onPress={() => navigation.navigate('Voice')}
          accessibilityRole="button"
          accessibilityLabel="Open David's Pro voice"
        >
          <PhoneCall color="#d4af37" size={14} />
          <Text style={styles.headerCallText}>VOICE · PRO</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatContainer}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <View
              key={index}
              style={[
                styles.messageBlock,
                isUser ? styles.userMessageBlock : styles.modelMessageBlock,
              ]}
            >
              <Text style={[styles.messageAuthor, isUser && styles.userAuthor]}>
                {isUser ? 'YOU' : 'DAVID'}
              </Text>
              <Text
                style={[
                  styles.messageText,
                  isUser ? styles.userText : styles.modelText,
                ]}
              >
                {msg.content}
              </Text>

              {msg.role === 'assistant' && (
                <View style={styles.feedbackContainer}>
                  <TouchableOpacity
                    onPress={() => speakMessage(index, msg.content)}
                    style={styles.feedbackButton}
                    accessibilityRole="button"
                    accessibilityLabel={speakingIndex === index ? 'Stop reading' : 'Read David message aloud'}
                  >
                    {speakingIndex === index ? (
                      <Square size={14} color="#d4af37" fill="#d4af37" />
                    ) : (
                      <Volume2 size={14} color="rgba(212, 175, 55, 0.6)" />
                    )}
                  </TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity role="button" aria-label="This was helpful" onPress={() => handleFeedback(index, 'up')} style={styles.feedbackButton}>
                    <ThumbsUp
                      size={14}
                      color={msg.feedback === 'up' ? '#d4af37' : 'rgba(212, 175, 55, 0.4)'}
                      fill={msg.feedback === 'up' ? '#d4af37' : 'transparent'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity role="button" aria-label="This was not helpful" onPress={() => handleFeedback(index, 'down')} style={styles.feedbackButton}>
                    <ThumbsDown
                      size={14}
                      color={msg.feedback === 'down' ? '#ef4444' : 'rgba(212, 175, 55, 0.4)'}
                      fill={msg.feedback === 'down' ? '#ef4444' : 'transparent'}
                    />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {loading && (
          <View style={[styles.messageBlock, styles.modelMessageBlock]}>
            <Text style={styles.messageAuthor}>DAVID</Text>
            <ActivityIndicator color="#d4af37" size="small" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type your message..."
          placeholderTextColor="rgba(255, 255, 255, 0.4)"
          value={input}
          onChangeText={setInput}
          multiline
          blurOnSubmit={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          onKeyPress={(e: any) => {
            if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              void handleSend();
            }
          }}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={loading || !input.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Send color="#051020" size={20} opacity={(!input.trim() || loading) ? 0.5 : 1} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  header: {
    paddingTop: 40,
    paddingBottom: 14,
    paddingHorizontal: 18,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.22)',
    position: 'relative',
  },
  headerTitle: {
    fontFamily: 'Cinzel',
    fontSize: 15,
    fontWeight: '700',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSubtitle: {
    fontFamily: 'Cinzel',
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(212, 175, 55, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 3,
  },
  headerCallButton: {
    position: 'absolute',
    top: 34,
    right: 14,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 4,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.45)',
    backgroundColor: 'rgba(212, 175, 55, 0.06)',
  },
  headerCallText: {
    fontFamily: 'Cinzel',
    color: '#d4af37',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  chatContainer: {
    flex: 1,
    minHeight: 0,
  },
  chatContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
  },
  messageBlock: {
    width: '100%',
    marginBottom: 24,
  },
  userMessageBlock: {
    alignItems: 'flex-end',
  },
  modelMessageBlock: {
    alignItems: 'flex-start',
  },
  messageAuthor: {
    fontFamily: 'Cinzel',
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(212, 175, 55, 0.56)',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  userAuthor: {
    color: 'rgba(245, 215, 122, 0.72)',
  },
  messageText: {
    maxWidth: '90%',
    fontFamily: 'Playfair Display',
    fontSize: 16,
    lineHeight: 26,
  },
  userText: {
    color: '#f5d77a',
    textAlign: 'right',
  },
  modelText: {
    color: '#ffffff',
    textAlign: 'left',
  },
  feedbackContainer: {
    width: '90%',
    flexDirection: 'row',
    marginTop: 8,
    alignItems: 'center',
  },
  feedbackButton: {
    marginLeft: 10,
    padding: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0b1e3d',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.15)',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(5, 16, 32, 0.5)',
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 100,
    fontFamily: 'Playfair Display',
    fontSize: 14,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  sendButton: {
    backgroundColor: '#d4af37',
    width: 44,
    height: 44,
    borderRadius: 4,
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: 'rgba(212, 175, 55, 0.3)',
  },
});
