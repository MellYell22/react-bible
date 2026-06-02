import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import { Analytics } from '@vercel/analytics/react';

export default function App() {
  const openEmail = () => {
    Linking.openURL('mailto:aadesigns87@gmail.com?subject=Bible%20Mood%20Search%20Waitlist');
  };

  return (
    <View style={styles.page}>
      <Analytics />

      <View style={styles.backgroundGlowBlue} />
      <View style={styles.backgroundGlowRed} />

      <View style={styles.card}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>COMING SOON</Text>
        </View>

        <Text style={styles.title}>Bible Mood Search</Text>

        <Text style={styles.subtitle}>
          A faith-centered AI companion built to help you find Bible verses, reflection prompts, and encouragement based on your mood.
        </Text>

        <View style={styles.divider} />

        <Text style={styles.bodyText}>
          We are preparing something meaningful. The full experience is being polished now, and the public launch is on the way.
        </Text>

        <TouchableOpacity style={styles.button} onPress={openEmail} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Join the waitlist</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>Built with purpose. Launching soon.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? '100vh' : undefined,
    backgroundColor: '#0B1E3D',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflow: 'hidden',
  },
  backgroundGlowBlue: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(30, 64, 175, 0.35)',
    top: -120,
    right: -120,
  },
  backgroundGlowRed: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(185, 28, 28, 0.3)',
    bottom: -110,
    left: -100,
  },
  card: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 32,
    padding: Platform.OS === 'web' ? 44 : 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  badge: {
    backgroundColor: '#B91C1C',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 22,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    color: '#0B1E3D',
    fontSize: Platform.OS === 'web' ? 64 : 46,
    lineHeight: Platform.OS === 'web' ? 72 : 52,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -1.5,
  },
  subtitle: {
    color: '#1F2937',
    fontSize: Platform.OS === 'web' ? 22 : 18,
    lineHeight: Platform.OS === 'web' ? 34 : 28,
    textAlign: 'center',
    marginTop: 20,
    maxWidth: 610,
    fontWeight: '500',
  },
  divider: {
    width: 88,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D4AF37',
    marginTop: 30,
    marginBottom: 28,
  },
  bodyText: {
    color: '#374151',
    fontSize: 17,
    lineHeight: 28,
    textAlign: 'center',
    maxWidth: 560,
  },
  button: {
    marginTop: 34,
    backgroundColor: '#0B1E3D',
    paddingHorizontal: 30,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#B91C1C',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  footerText: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
