import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { AlertCircle, CheckCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useUser } from '../UserContext';
import { FullScreenBackground } from '../components/FullScreenBackground';
import { hasProAccess } from '../utils/tier';

export default function PaymentSuccessScreen({ navigation }: { navigation: any }) {
  const { profile, refreshProfile } = useUser();
  const [isActivating, setIsActivating] = useState(true);
  const [activationTimedOut, setActivationTimedOut] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const hasUnlockedPro = hasProAccess(profile);

  useEffect(() => {
    // Start polling for the pro status
    console.log('[PaymentSuccess] Starting subscription status polling...');
    const interval = setInterval(async () => {
      setAttempts(prev => {
        const next = prev + 1;
        if (next >= 30) { // Poll for up to 90 seconds
          console.warn('[PaymentSuccess] Polling timed out after 90 seconds.');
          clearInterval(interval);
          setIsActivating(false);
          setActivationTimedOut(true);
          return next;
        }
        console.log(`[PaymentSuccess] Polling attempt ${next}...`);
        return next;
      });
      
      await refreshProfile();
    }, 3000);

    return () => {
      console.log('[PaymentSuccess] Cleaning up polling interval.');
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    console.log(`[PaymentSuccess] UI Check - Profile: ${profile?.id}, Tier: ${profile?.subscription_tier}, Status: ${profile?.stripe_subscription_status}`);
    if (hasUnlockedPro) {
      console.log('[PaymentSuccess] PRO STATUS DETECTED! Unlocking app features.');
      setIsActivating(false);
      setActivationTimedOut(false);
      
      // Auto-redirect after a small delay to let user see success
      const timeout = setTimeout(() => {
        handleContinue();
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [hasUnlockedPro, profile?.id, profile?.stripe_subscription_status]);

  const handleContinue = () => {
    // Redirect to main app entry (Mood)
    navigation.reset({
      index: 0,
      routes: [{ name: 'Mood' }],
    });
  };

  const handleProfile = () => {
    navigation.navigate('Profile');
  };

  const title = isActivating
    ? 'HEAVENLY SYNC IN PROGRESS'
    : hasUnlockedPro
      ? 'GLORY! YOU ARE PRO'
      : 'WE ARE STILL CONFIRMING YOUR PRO ACCESS';

  const description = isActivating
    ? 'Our systems are receiving the confirmation from Stripe. Your account will be transformed into Pro momentarily...'
    : hasUnlockedPro
      ? 'Your transformation is complete. You now have unlimited access to AI insights and deeper scripture reflections.'
      : 'Your payment may still be processing. Please open Profile to refresh your account status or contact support if Pro is not unlocked shortly.';

  return (
    <FullScreenBackground>
      <View style={styles.container}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          style={styles.card}
        >
          <View style={styles.iconContainer}>
            <AnimatePresence mode="wait">
              {isActivating ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={styles.flexCenter}
                >
                  <ActivityIndicator size="large" color="#d4af37" />
                  <Text style={styles.pollingText}>Finalizing your upgrade...</Text>
                </motion.div>
              ) : hasUnlockedPro ? (
                <motion.div
                  key="success"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                >
                  <CheckCircle color="#10B981" size={64} />
                </motion.div>
              ) : (
                <motion.div
                  key="pending"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                >
                  <AlertCircle color="#F59E0B" size={64} />
                </motion.div>
              )}
            </AnimatePresence>
          </View>

          <Text style={styles.title}>
            {title}
          </Text>

          <Text style={styles.description}>
            {description}
          </Text>

          {!isActivating && (
            <TouchableOpacity 
              style={styles.button} 
              onPress={hasUnlockedPro ? handleContinue : handleProfile}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{hasUnlockedPro ? 'START YOUR JOURNEY' : 'OPEN PROFILE'}</Text>
              <ArrowRight color="#0b1e3d" size={20} />
            </TouchableOpacity>
          )}

          {isActivating && attempts > 10 && !activationTimedOut && (
            <TouchableOpacity 
              style={styles.troubleButton} 
              onPress={handleProfile}
            >
              <Text style={styles.troubleText}>Taking too long? Go to Profile</Text>
            </TouchableOpacity>
          )}
        </motion.div>

        <View style={styles.benefitList}>
           <View style={styles.benefitItem}>
             <ShieldCheck size={16} color="#d4af37" />
             <Text style={styles.benefitText}>Unlimited AI Conversations</Text>
           </View>
           <View style={styles.benefitItem}>
             <ShieldCheck size={16} color="#d4af37" />
             <Text style={styles.benefitText}>Extended Voice Responses</Text>
           </View>
        </View>
      </View>
    </FullScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: 'rgba(11, 30, 61, 0.8)',
    borderRadius: 24,
    padding: 40,
    width: '100%',
    maxWidth: 450,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  iconContainer: {
    marginBottom: 24,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flexCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollingText: {
    color: '#d4af37',
    fontSize: 14,
    marginTop: 12,
    fontWeight: '500',
    letterSpacing: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#d4af37',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#d4af37',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  buttonText: {
    color: '#0b1e3d',
    fontWeight: 'bold',
    marginRight: 8,
    letterSpacing: 1,
  },
  troubleButton: {
    marginTop: 20,
  },
  troubleText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  benefitList: {
    marginTop: 40,
    width: '100%',
    maxWidth: 450,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 12,
    borderRadius: 8,
  },
  benefitText: {
    color: 'rgba(255, 255, 255, 0.8)',
    marginLeft: 12,
    fontSize: 14,
  }
});
