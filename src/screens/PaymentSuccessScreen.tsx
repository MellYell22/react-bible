import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { CheckCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useUser } from '../UserContext';
import { FullScreenBackground } from '../components/FullScreenBackground';

export default function PaymentSuccessScreen({ navigation }: { navigation: any }) {
  const { profile, refreshProfile } = useUser();
  const [isActivating, setIsActivating] = useState(true);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    // Start polling for the pro status
    const interval = setInterval(async () => {
      setAttempts(prev => {
        const next = prev + 1;
        if (next >= 20) {
          clearInterval(interval);
          setIsActivating(false);
          return next;
        }
        return next;
      });
      
      await refreshProfile();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (profile?.subscription_tier === 'pro') {
      setIsActivating(false);
    }
  }, [profile?.subscription_tier]);

  const handleContinue = () => {
    navigation.navigate('Profile');
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
              {isActivating ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ActivityIndicator size="large" color="#d4af37" />
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
            {isActivating ? 'ACTIVATING PRO FEATURES' : 'WELCOME TO PRO'}
          </Text>

          <Text style={styles.description}>
            {isActivating 
              ? 'Our angels are updating your account status. This usually takes just a moment...'
              : 'Your transformation is complete. You now have unlimited access to AI insights and premium music.'}
          </Text>

          {!isActivating && (
            <TouchableOpacity 
              style={styles.button} 
              onPress={handleContinue}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>ENTER THE SANCTUARY</Text>
              <ArrowRight color="#0b1e3d" size={20} />
            </TouchableOpacity>
          )}

          {isActivating && attempts > 10 && (
            <TouchableOpacity 
              style={styles.troubleButton} 
              onPress={handleContinue}
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
           <View style={styles.benefitItem}>
             <ShieldCheck size={16} color="#d4af37" />
             <Text style={styles.benefitText}>Full Premium Music Library</Text>
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
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
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
