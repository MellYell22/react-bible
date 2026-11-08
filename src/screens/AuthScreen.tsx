import SanctuaryBanner from '../components/SanctuaryBanner';
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { Globe, Menu, Search, User, Settings } from 'lucide-react';
import { supabase } from '../services/supabase';
import { FullScreenBackground } from '../components/FullScreenBackground';
import { useUser } from '../UserContext';
import { BibleTranslation } from '../types';

const TRANSLATIONS = ['NIV', 'KJV', 'NLT', 'ESV', 'NKJV', 'CSB'];

export default function AuthScreen() {
  const { continueAsGuest } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(true);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [preferredTranslation, setPreferredTranslation] = useState('NIV');
  const [showTranslations, setShowTranslations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  const handleAuth = async () => {
    setError(null);

    if (!supabase) {
      setError('Sign in is temporarily unavailable. Please continue as guest and try again shortly.');
      return;
    }

    if (isResettingPassword) {
      if (!email) {
        setError('Please enter your email');
        return;
      }
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        alert('Password reset link sent to your email!');
        setIsResettingPassword(false);
      } catch (error: any) {
        setError(error.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.user) {
          await supabase.from('profiles').insert([
            { 
              id: data.user.id, 
              email: data.user.email, 
              subscription_tier: 'free',
              has_completed_onboarding: false,
              preferred_translation: preferredTranslation
            },
          ]);
        }

        if (data.session) {
          // Email confirmation is off for this project: the session is live
          // and the app shell will move on to onboarding automatically.
          setConfirmationSentTo(null);
        } else {
          // No session yet: the account needs email confirmation first.
          setConfirmationSentTo(email);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!supabase || !confirmationSentTo || resending) return;
    setResending(true);
    setResendNote(null);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: confirmationSentTo });
      if (error) throw error;
      setResendNote('Confirmation email sent again. Please check your inbox (and spam folder).');
    } catch (error: any) {
      setResendNote(error.message || 'Could not resend the email. Please try again in a moment.');
    } finally {
      setResending(false);
    }
  };

  if (confirmationSentTo) {
    return (
      <FullScreenBackground center={false}>
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
          <View style={styles.mainContent}>
            <Text style={styles.mainTitle}>CHECK YOUR EMAIL</Text>
            <View style={styles.form}>
              <Text style={styles.confirmationText}>
                We sent a confirmation link to {confirmationSentTo}. Tap that link to finish creating your account, then come back here and sign in.
              </Text>
              <TouchableOpacity style={styles.signInButton} onPress={handleResendConfirmation} disabled={resending}>
                {resending ? (
                  <ActivityIndicator color="#00213d" />
                ) : (
                  <Text style={styles.signInButtonText}>RESEND CONFIRMATION EMAIL</Text>
                )}
              </TouchableOpacity>
              {!!resendNote && <Text style={styles.resendNote}>{resendNote}</Text>}
              <TouchableOpacity
                style={styles.createAccountButton}
                onPress={() => { setConfirmationSentTo(null); setIsSignUp(false); setResendNote(null); }}
              >
                <Text style={styles.createAccountText}>BACK TO SIGN IN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.guestButton}
                onPress={() => continueAsGuest(preferredTranslation as BibleTranslation)}
              >
                <Text style={styles.guestButtonText}>CONTINUE AS GUEST — FIND A VERSE NOW</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </FullScreenBackground>
    );
  }

  return (
    <FullScreenBackground center={false}>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.headerIcon} accessibilityLabel="Explore as guest" onPress={() => continueAsGuest(preferredTranslation as BibleTranslation)}>
              <Menu size={20} color="#efc744" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon} accessibilityLabel="Explore scripture as guest" onPress={() => continueAsGuest(preferredTranslation as BibleTranslation)}>
              <Search size={20} color="#efc744" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon} accessibilityLabel="Sign in" onPress={() => {setIsSignUp(false);setIsResettingPassword(false);}}>
              <User size={20} color="#efc744" />
            </TouchableOpacity>
          </View>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>BIBLE MOOD SEARCH</Text>
            <Text style={styles.headerSubtitle}>DISCOVER SCRIPTURE FOR EVERY FEELING.</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.signUpButton} onPress={() => { setIsSignUp(true); setIsResettingPassword(false); }}>
              <Text style={styles.signUpText}>SIGN UP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon} accessibilityLabel="Choose translation" onPress={() => setShowTranslations(!showTranslations)}>
              <Settings size={20} color="#efc744" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.translationContainer}>
          <TouchableOpacity 
            style={styles.translationSelector}
            onPress={() => setShowTranslations(!showTranslations)}
          >
            <Text style={styles.translationLabel}>{preferredTranslation}</Text>
            <Globe size={12} color="#efc744" />
          </TouchableOpacity>
          
          {showTranslations && (
            <View style={styles.translationDropdown}>
              {TRANSLATIONS.map(t => (
                <TouchableOpacity 
                  key={t} 
                  style={styles.dropdownItem}
                  onPress={() => {
                    setPreferredTranslation(t);
                    setShowTranslations(false);
                  }}
                >
                  <Text style={[
                    styles.dropdownText,
                    preferredTranslation === t && styles.dropdownTextActive
                  ]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.mainContent}>
          <Text style={styles.mainTitle}>ENTER SANCTUARY</Text>

          <View style={styles.form}>
            {/* Guest entry sits above the form: most first-time visitors want
                a verse, not an account. Signing up is still one tap away. */}
            {!isResettingPassword && (
              <View style={styles.guestFirstBlock}>
                <TouchableOpacity
                  style={styles.guestButton}
                  onPress={() => continueAsGuest(preferredTranslation as BibleTranslation)}
                >
                  <Text style={styles.guestButtonText}>CONTINUE AS GUEST — FIND A VERSE NOW</Text>
                </TouchableOpacity>
                <Text style={styles.guestFirstHint}>No account needed. Start in seconds.</Text>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Or save your verses</Text>
                  <View style={styles.dividerLine} />
                </View>
              </View>
            )}

            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="rgba(239, 199, 68, 0.4)"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                onSubmitEditing={handleAuth}
              />
            </View>

            {!isResettingPassword && (
              <View style={styles.inputGroup}>
                <View style={styles.passwordHeader}>
                  <Text style={styles.inputLabel}>PASSWORD</Text>
                  <TouchableOpacity onPress={() => setIsResettingPassword(true)}>
                    <Text style={styles.forgotPasswordLink}>FORGOT PASSWORD?</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(239, 199, 68, 0.4)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  onSubmitEditing={handleAuth}
                />
              </View>
            )}

            {!isResettingPassword && !isSignUp && (
              <View style={styles.rememberMeContainer}>
                <TouchableOpacity 
                  style={[styles.checkbox, rememberMe && styles.checkboxChecked]}
                  onPress={() => setRememberMe(!rememberMe)}
                >
                  {rememberMe && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
                <Text style={styles.rememberMeText}>REMEMBER ME</Text>
              </View>
            )}

            <TouchableOpacity 
              style={styles.signInButton} 
              onPress={handleAuth} 
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#00213d" />
              ) : (
                <Text style={styles.signInButtonText}>
                  {isResettingPassword ? 'SEND RESET LINK' : isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
                </Text>
              )}
            </TouchableOpacity>

            {!isResettingPassword && !isSignUp && (
              <TouchableOpacity 
                style={styles.createAccountButton}
                onPress={() => setIsSignUp(true)}
              >
                <Text style={styles.createAccountText}>CREATE FREE ACCOUNT</Text>
              </TouchableOpacity>
            )}

            {isSignUp && (
              <TouchableOpacity 
                style={styles.toggleContainer}
                onPress={() => setIsSignUp(false)}
              >
                <Text style={styles.toggleText}>Already have an account? Sign in</Text>
              </TouchableOpacity>
            )}

            {isResettingPassword && (
              <TouchableOpacity 
                style={styles.toggleContainer}
                onPress={() => setIsResettingPassword(false)}
              >
                <Text style={styles.toggleText}>Back to Login</Text>
              </TouchableOpacity>
            )}
            <SanctuaryBanner />
          </View>
        </View>
      </ScrollView>
    </FullScreenBackground>
  );
}

const GOLD = '#efc744';
const SOFT_GOLD = '#e9d495';
const NAVY = '#00213d';
const DARK_NAVY = '#00213d';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 199, 68, 0.1)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },
  headerSubtitle: {
    fontSize: 8,
    color: SOFT_GOLD,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 2,
    fontFamily: 'Cinzel',
    opacity: 0.8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    padding: 8,
  },
  signUpButton: {
    backgroundColor: GOLD,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 0,
  },
  signUpText: {
    color: DARK_NAVY,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },
  translationContainer: {
    position: 'absolute',
    top: 80,
    right: 20,
    zIndex: 100,
  },
  translationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(239, 199, 68, 0.3)',
    borderRadius: 0,
  },
  translationLabel: {
    color: GOLD,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },
  translationDropdown: {
    position: 'absolute',
    top: 40,
    right: 0,
    backgroundColor: '#00213d',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: GOLD,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 199, 68, 0.1)',
  },
  dropdownText: {
    color: 'rgba(239, 199, 68, 0.6)',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'Cinzel',
  },
  dropdownTextActive: {
    color: GOLD,
  },
  mainContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 18,
    marginTop: 48,
  },
  mainTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 24,
    fontFamily: 'Playfair Display',
    textAlign: 'center',
  },
  form: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  errorContainer: {
    width: '100%',
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginBottom: 20,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '600',
    fontFamily: 'Playfair Display',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 8,
    color: 'rgba(239, 199, 68, 0.6)',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    fontWeight: '700',
    fontFamily: 'Cinzel',
  },
  passwordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  forgotPasswordLink: {
    fontSize: 8,
    color: GOLD,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
    fontFamily: 'Cinzel',
  },
  input: {
    width: '100%',
    backgroundColor: 'rgba(5, 16, 32, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(239, 199, 68, 0.3)',
    borderRadius: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 20,
    gap: 6,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: GOLD,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxChecked: {
    backgroundColor: GOLD,
  },
  checkmark: {
    color: DARK_NAVY,
    fontSize: 12,
    fontWeight: 'bold',
  },
  rememberMeText: {
    fontSize: 9,
    color: 'rgba(239, 199, 68, 0.7)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontWeight: '600',
    fontFamily: 'Cinzel',
  },
  signInButton: {
    width: '100%',
    backgroundColor: GOLD,
    paddingVertical: 12,
    borderRadius: 0,
    alignItems: 'center',
    marginBottom: 12,
  },
  signInButtonText: {
    color: DARK_NAVY,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },
  createAccountButton: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 199, 68, 0.5)',
    paddingVertical: 12,
    borderRadius: 0,
    alignItems: 'center',
    marginBottom: 16,
  },
  createAccountText: {
    color: 'rgba(239, 199, 68, 0.7)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },
  guestFirstBlock: {
    width: '100%',
  },
  guestFirstHint: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 18,
    letterSpacing: 0.3,
    fontFamily: 'Playfair Display',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(239, 199, 68, 0.25)',
  },
  dividerText: {
    color: 'rgba(239, 199, 68, 0.6)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },
  guestButton: {
    width: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: GOLD,
    paddingVertical: 12,
    borderRadius: 0,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  guestButtonText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
    textAlign: 'center',
  },
  confirmationText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
    marginBottom: 20,
  },
  resendNote: {
    color: SOFT_GOLD,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
    marginBottom: 16,
  },
  toggleContainer: {
    marginTop: 24,
    paddingVertical: 8,
  },
  toggleText: {
    color: SOFT_GOLD,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
  },
});
