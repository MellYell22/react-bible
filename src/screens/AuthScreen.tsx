import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Globe } from 'lucide-react';
import { supabase } from '../services/supabase';
import { FullScreenBackground } from '../components/FullScreenBackground';

const TRANSLATIONS = ['NIV', 'KJV', 'NLT', 'ESV', 'NKJV', 'CSB'];

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [preferredTranslation, setPreferredTranslation] = useState('KJV');
  const [showTranslations, setShowTranslations] = useState(false);

  const handleAuth = async () => {
    if (isResettingPassword) {
      if (!email) {
        alert('Please enter your email');
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
        alert(error.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email || !password) {
      alert('Please enter both email and password');
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

        alert('Check your email for confirmation!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    // IMPORTANT: keep center if you want vertical centering,
    // but the "box" MUST NOT be added by FullScreenBackground.
    <FullScreenBackground center>
      {/* Top Header with Translation Selector */}
      <View style={styles.topHeader}>
        <View style={styles.versionContainer}>
          <Text style={styles.headerLabel}>VERSION</Text>
          <TouchableOpacity 
            style={styles.translationSelector}
            onPress={() => setShowTranslations(!showTranslations)}
          >
            <Globe size={10} color="#d4af37" />
            <Text style={styles.translationText}>{preferredTranslation}</Text>
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
      </View>

      {/* No card/container background. This is PURE layout only. */}
      <View style={styles.screen}>
        <Text style={styles.title}>Bible Mood Search</Text>
        <Text style={styles.subtitle}>AI Scripture Companion</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="rgba(245, 215, 122, 0.55)"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          {!isResettingPassword && (
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="rgba(245, 215, 122, 0.55)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          )}

          <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#d4af37" />
            ) : (
              <Text style={styles.buttonText}>
                {isResettingPassword ? 'Send Reset Link' : isSignUp ? 'Sign Up' : 'Log In'}
              </Text>
            )}
          </TouchableOpacity>

          {!isResettingPassword && !isSignUp && (
            <TouchableOpacity 
              style={styles.forgotPasswordWrap} 
              onPress={() => setIsResettingPassword(true)}
            >
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            style={styles.toggleWrap} 
            onPress={() => {
              if (isResettingPassword) {
                setIsResettingPassword(false);
              } else {
                setIsSignUp(!isSignUp);
              }
            }}
          >
            <Text style={styles.toggleText}>
              {isResettingPassword 
                ? 'Back to Login' 
                : isSignUp 
                  ? 'Already have an account? Log in' 
                  : "Don't have an account? Sign up"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>CREATED BY AA DESIGNS</Text>
        </View>
      </View>
    </FullScreenBackground>
  );
}

const GOLD = '#d4af37';
const SOFT_GOLD = '#f5d77a';

const styles = StyleSheet.create({
  // Pure layout wrapper, NO background, NO shadow, NO border.
  screen: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'transparent',
    flex: 1,
  },

  topHeader: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1000,
  },

  versionContainer: {
    alignItems: 'flex-end',
  },

  headerLabel: {
    fontSize: 7,
    color: 'rgba(212, 175, 55, 0.4)',
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 2,
    textTransform: 'uppercase',
  },

  translationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },

  translationText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    marginLeft: 4,
    letterSpacing: 1,
  },

  translationDropdown: {
    position: 'absolute',
    top: 35,
    right: 0,
    backgroundColor: '#0f2a52',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    width: 80,
  },

  dropdownItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  dropdownText: {
    color: 'rgba(212, 175, 55, 0.6)',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  dropdownTextActive: {
    color: '#d4af37',
  },

  title: {
    fontSize: 24,
    color: GOLD,
    textAlign: 'center',
    letterSpacing: 4,
    fontFamily: 'Playfair Display',
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  subtitle: {
    marginTop: 6,
    fontSize: 9,
    color: SOFT_GOLD,
    textAlign: 'center',
    letterSpacing: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    opacity: 0.9,
    fontFamily: 'Cinzel',
  },

  // Keeps the form slim and centered with NO panel feel.
  form: {
    width: '86%',
    marginTop: 60,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  input: {
    width: '100%',
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.4)',
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginBottom: 24,
    fontSize: 18,
    color: '#ffffff',
    textAlign: 'center',
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
  },

  // Pill outline button (no “box panel” look)
  button: {
    width: '100%',
    marginTop: 24,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },

  buttonText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
    fontFamily: 'Cinzel',
  },

  toggleWrap: {
    marginTop: 32,
    paddingVertical: 6,
  },

  toggleText: {
    color: SOFT_GOLD,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    opacity: 0.8,
    fontFamily: 'Playfair Display',
    textTransform: 'uppercase',
  },
  forgotPasswordWrap: {
    marginTop: 16,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: SOFT_GOLD,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    opacity: 0.6,
    fontFamily: 'Playfair Display',
    textTransform: 'uppercase',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(212, 175, 55, 0.2)',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 3,
    fontFamily: 'Cinzel',
  },
});
