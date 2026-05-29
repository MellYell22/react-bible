import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { CheckCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useUser } from '../UserContext';
import { FullScreenBackground } from '../components/FullScreenBackground';

export default function PaymentSuccessScreen({ navigation }: { navigation: any }) {
  const { profile, refreshProfile } = useUser();
  const [isActivating, setIsActivating] = useState(true);
  const [activationTimedOut, setActivationTimedOut] = useState(false);
  const [attempts, setAttempts] = useState(0);

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
    if (profile?.subscription_tier === 'pro' || profile?.subscription_tier === 'owner') {
      console.log('[PaymentSuccess] PRO STATUS DETECTED! Unlocking app features.');
      setIsActivating(false);
      setActivationTimedOut(false);
      
      // Auto-redirect after a small delay to let user see success
      const timeout = setTimeout(() => {
        handleContinue();
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [profile?.subscription_tier]);

  const navigateTo = (name: string) => {
    if (navigation?.reset) {
      navigation.reset({
        index: 0,
        routes: [{ name }],
      });
      return;
    }
    navigation?.navigate?.(name);
  };

  const handleContinue = () => {
    navigateTo('Mood');
  };

  const handleProfile = () => {
    navigateTo('Profile');
  };

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
              {isActivating || activationTimedOut ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={styles.flexCenter}
                >
                  <ActivityIndicator size="large" color="#d4af37" />
                  <Text style={styles.pollingText}>
                    {activationTimedOut ? 'Waiting for Stripe confirmation...' : 'Finalizing your upgrade...'}
                  </Text>
                </motion.div>
              ) : (
                <motion.div
                  key="success"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 20 }}
                >
                  <CheckCircle color="#10B981" size={64} />
                </motion.div>
              )}
            </AnimatePresence>
          </View>

          <Text style={styles.title}>
            {isActivating
              ? 'HEAVENLY SYNC IN PROGRESS'
              : activationTimedOut
                ? 'UPGRADE STILL FINALIZING'
                : 'GLORY! YOU ARE PRO'}
          </Text>

          <Text style={styles.description}>
            {isActivating
              ? 'Our systems are receiving the confirmation from Stripe. Your account will be transformed into Pro momentarily...'
              : activationTimedOut
                ? 'Stripe has not confirmed Pro access on your profile yet. Please check your Profile again in a moment.'
              : 'Your transformation is complete. You now have unlimited access to AI insights and deeper scripture reflections.'}
          </Text>

          {!isActivating && !activationTimedOut && (
            <TouchableOpacity 
              style={styles.button} 
              onPress={handleContinue}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>START YOUR JOURNEY</Text>
              <ArrowRight color="#0b1e3d" size={20} />
            </TouchableOpacity>
          )}

          {((isActivating && attempts > 10) || activationTimedOut) && (
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
