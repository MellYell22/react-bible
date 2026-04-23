import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { supabase } from '../services/supabase';
import { Profile } from '../types';
import { LogOut, CreditCard, Shield, CheckCircle2, AlertCircle, Lock, Star } from 'lucide-react';
import { createCheckoutSession } from '../services/stripe';
import { OWNER_EMAIL, hasProAccess } from '../utils/tier';
import { PLANS } from '../constants';

import { useUser } from '../UserContext';

export default function ProfileScreen({ route }: { route?: { params?: any } }) {
  const { profile, refreshProfile, signOut } = useUser();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  // Extract query params as stable primitives
  const params = new URLSearchParams(window.location.search);
  const success = params.get('success');
  const canceled = params.get('canceled');

  useEffect(() => {
    // Only run if success or canceled params are present
    if (!success && !canceled) {
      return;
    }

    // Handle success redirect from Stripe
    if (success === 'true') {
      setStatusMessage({ text: 'Subscription updated successfully! Welcome to the family.', type: 'success' });
      // Refresh the global profile to reflect the new tier
      refreshProfile();
      // Clear params from URL
      window.history.replaceState({}, document.title, '/profile');
    }
    // Handle canceled redirect from Stripe
    else if (canceled === 'true') {
      setStatusMessage({ text: 'Checkout canceled. No changes were made.', type: 'info' });
      window.history.replaceState({}, document.title, '/profile');
    }
  }, [success, canceled, refreshProfile]);

  const handleLogout = async () => {
    await signOut();
  };

  const handleUpgrade = async (tierId: string) => {
    if (!profile) return;
    setLoading(true);
    setStatusMessage(null);

    const plan = Object.values(PLANS).find(p => p.id === tierId);

    console.log(`[StripeDebug] Upgrade button clicked: ${tierId}`);

    try {
      if (!plan || !plan.priceId) {
        throw new Error(`Price ID for ${tierId} plan is not configured.`);
      }
      await createCheckoutSession(plan.priceId);
    } catch (error: any) {
      console.error(`[StripeDebug] Upgrade error: ${error.message}`);
      setStatusMessage({ text: error.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const updatePreference = async (field: string, value: any) => {
    if (!profile) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('id', profile.id);

      if (error) throw error;
      setStatusMessage({ text: 'Preferences updated!', type: 'success' });
    } catch (error: any) {
      setStatusMessage({ text: error.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile?.email?.[0].toUpperCase()}</Text>
        </View>
        <Text style={styles.email}>{profile?.email}</Text>
        <View style={styles.tierBadge}>
          <Text style={styles.tierText}>
            {profile?.email === OWNER_EMAIL ? 'OWNER (FULL ACCESS)' : (profile?.subscription_tier?.toUpperCase() || 'FREE')}
          </Text>
        </View>
      </View>

      {statusMessage && (
        <View style={[styles.statusBanner, styles[`${statusMessage.type}Banner`]]}>
          {statusMessage.type === 'error' ? <AlertCircle size={16} color="#ef4444" /> : <CheckCircle2 size={16} color={statusMessage.type === 'success' ? '#10B981' : '#d4af37'} />}
          <Text style={[styles.statusText, styles[`${statusMessage.type}Text`]]}>{statusMessage.text}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>AI Preferences</Text>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsLabel}>Response Length</Text>
        <View style={styles.optionsRow}>
          {['short', 'medium', 'long'].map((length) => {
            const isPro = hasProAccess(profile);
            const isDisabled = length !== 'short' && !isPro;
            const isSelected = profile?.preferred_response_length === length;

            return (
              <TouchableOpacity
                key={length}
                style={[
                  styles.optionButton,
                  isSelected && styles.optionButtonActive,
                  isDisabled && styles.optionButtonDisabled
                ]}
                onPress={() => !isDisabled && updatePreference('preferred_response_length', length)}
                disabled={loading}
              >
                <Text style={[
                  styles.optionText,
                  isSelected && styles.optionTextActive,
                  isDisabled && styles.optionTextDisabled
                ]}>
                  {length.toUpperCase()}
                </Text>
                {isDisabled && <Lock size={10} color="rgba(212, 175, 55, 0.3)" style={{ marginTop: 2 }} />}
              </TouchableOpacity>
            );
          })}
        </View>
        {!hasProAccess(profile) && (
          <Text style={styles.settingsHint}>Upgrade to Plus or Pro to unlock medium and long responses.</Text>
        )}

        <View style={[styles.divider, { marginVertical: 20 }]} />

        <Text style={styles.settingsLabel}>Verse of the Day</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Daily Notifications</Text>
          <TouchableOpacity
            style={[styles.toggleSwitch, profile?.verse_of_the_day_enabled && styles.toggleSwitchActive]}
            onPress={() => updatePreference('verse_of_the_day_enabled', !profile?.verse_of_the_day_enabled)}
            disabled={loading}
          >
            <View style={[styles.toggleDot, profile?.verse_of_the_day_enabled && styles.toggleDotActive]} />
          </TouchableOpacity>
        </View>

        {profile?.verse_of_the_day_enabled && (
          <View style={styles.timePickerContainer}>
            <Text style={styles.timeLabel}>Notification Time</Text>
            <View style={styles.timeInputRow}>
              <TextInput
                style={styles.timeInput}
                value={profile?.verse_of_the_day_time || '08:00'}
                onChangeText={(text) => updatePreference('verse_of_the_day_time', text)}
                placeholder="HH:mm"
                placeholderTextColor="rgba(212, 175, 55, 0.3)"
                maxLength={5}
              />
              <Text style={styles.timeHint}>(24h format, e.g., 08:00)</Text>
            </View>
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Your Benefits</Text>
      <View style={styles.benefitsSummary}>
        <View style={styles.benefitItem}>
          <CheckCircle2 size={16} color="#10B981" />
          <Text style={styles.benefitText}>
            {profile?.subscription_tier === 'pro' ? 'Unlimited AI Conversations' :
              profile?.subscription_tier === 'plus' ? 'Unlimited Mood Search' : '3 Mood Searches / Day'}
          </Text>
        </View>
        <View style={styles.benefitItem}>
          <CheckCircle2 size={16} color="#10B981" />
          <Text style={styles.benefitText}>
            {profile?.preferred_response_length === 'long' ? 'Comprehensive AI Reflections' :
              profile?.preferred_response_length === 'medium' ? 'Standard AI Reflections' : 'Concise AI Reflections'}
          </Text>
        </View>
        {profile?.subscription_tier === 'pro' && (
          <View style={styles.benefitItem}>
            <CheckCircle2 size={16} color="#10B981" />
            <Text style={styles.benefitText}>Live Voice Chat with David</Text>
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>Subscription Plans</Text>

      {Object.values(PLANS).map((plan) => {
        const currentTier = profile?.subscription_tier || 'free';
        const isOwner = profile?.email === OWNER_EMAIL;
        const isCurrentPlan = currentTier === plan.id;

        // Tier hierarchy: free < plus < pro < owner
        const tierOrder = ['free', 'plus', 'pro', 'owner'];
        const currentTierIndex = tierOrder.indexOf(isOwner ? 'owner' : currentTier);
        const planTierIndex = tierOrder.indexOf(plan.id);

        const isIncluded = currentTierIndex >= planTierIndex;
        const canUpgrade = !isIncluded && plan.id !== 'free';
        const isDisabled = loading || isIncluded || plan.id === 'free';

        return (
          <View key={plan.id} style={[
            styles.planCard,
            plan.id === 'pro' && styles.proCard,
            isCurrentPlan && styles.currentPlanCard
          ]}>
            {plan.id === 'pro' && (
              <View style={styles.proBadge}>
                <Star size={10} color="#0b1e3d" fill="#0b1e3d" />
                <Text style={styles.proBadgeText}>BEST VALUE</Text>
              </View>
            )}

            {isCurrentPlan && (
              <View style={styles.currentBadge}>
                <CheckCircle2 size={10} color="#fff" />
                <Text style={styles.currentBadgeText}>ACTIVE</Text>
              </View>
            )}

            <View style={styles.planHeader}>
              <View>
                <Text style={[styles.planName, plan.id === 'pro' && { color: '#fff' }]}>{plan.name}</Text>
                <Text style={[styles.planInterval, plan.id === 'pro' && { color: 'rgba(255,255,255,0.6)' }]}>
                  {plan.id === 'free' ? 'Basic Access' : 'Full Experience'}
                </Text>
              </View>
              <View style={styles.priceContainer}>
                <Text style={[styles.planPrice, plan.id === 'pro' && { color: '#fff' }]}>{plan.price}</Text>
                <Text style={[styles.planIntervalLabel, plan.id === 'pro' && { color: 'rgba(255,255,255,0.6)' }]}>/{plan.interval}</Text>
              </View>
            </View>

            <View style={styles.featureList}>
              {plan.features.map((feature, idx) => {
                // For the current plan or higher, show checkmarks. 
                // For plans higher than current, show what they *will* get.
                return (
                  <View key={idx} style={styles.featureItem}>
                    <CheckCircle2 color={plan.id === 'pro' ? "#fff" : "#10B981"} size={14} />
                    <Text style={[styles.featureText, plan.id === 'pro' && { color: '#fff' }]}>{feature}</Text>
                  </View>
                );
              })}
            </View>

            {canUpgrade ? (
              <TouchableOpacity
                style={[
                  styles.planButton,
                  plan.id === 'pro' && styles.proButton
                ]}
                onPress={() => handleUpgrade(plan.id)}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={plan.id === 'pro' ? '#fff' : '#d4af37'} />
                ) : (
                  <Text style={[
                    styles.planButtonText,
                    plan.id === 'pro' && { color: '#0b1e3d' }
                  ]}>
                    Upgrade to {plan.name.split(' ')[0]}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <View style={[
                styles.planButton,
                styles.activePlanButton,
                plan.id === 'pro' && styles.activeProButton
              ]}>
                <Text style={[
                  styles.planButtonText,
                  plan.id === 'pro' && { color: '#fff' }
                ]}>
                  {isCurrentPlan ? 'Current Plan' : 'Included'}
                </Text>
              </View>
            )}
          </View>
        );
      })}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <LogOut color="#EF4444" size={20} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
    backgroundColor: '#0f2a52',
    padding: 25,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#d4af37',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#0b1e3d',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#d4af37',
    fontFamily: 'Playfair Display',
  },
  email: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
    fontFamily: 'Playfair Display',
    opacity: 0.8,
  },
  tierBadge: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  tierText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
  },
  successBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  infoBanner: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  statusText: {
    fontSize: 12,
    marginLeft: 10,
    fontWeight: '500',
  },
  successText: { color: '#10B981' },
  errorText: { color: '#ef4444' },
  infoText: { color: '#d4af37' },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f5d77a',
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 10,
  },
  settingsCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 24,
    padding: 24,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  settingsLabel: {
    fontSize: 14,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
    marginBottom: 15,
    textAlign: 'center',
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  optionButton: {
    flex: 1,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    flexDirection: 'row',
    gap: 4,
  },
  optionButtonActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderColor: '#d4af37',
  },
  optionButtonDisabled: {
    opacity: 0.5,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  optionText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: 'rgba(212, 175, 55, 0.6)',
    letterSpacing: 1,
  },
  optionTextActive: {
    color: '#d4af37',
  },
  optionTextDisabled: {
    color: 'rgba(212, 175, 55, 0.3)',
  },
  settingsHint: {
    fontSize: 11,
    color: 'rgba(212, 175, 55, 0.5)',
    textAlign: 'center',
    marginTop: 15,
    fontStyle: 'italic',
    fontFamily: 'Playfair Display',
  },
  benefitsSummary: {
    backgroundColor: '#0f2a52',
    borderRadius: 24,
    padding: 20,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  benefitText: {
    fontSize: 13,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
    opacity: 0.9,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  toggleLabel: {
    fontSize: 14,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  toggleSwitchActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.3)',
    borderColor: '#d4af37',
  },
  toggleDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(212, 175, 55, 0.4)',
  },
  toggleDotActive: {
    backgroundColor: '#d4af37',
    transform: [{ translateX: 20 }],
  },
  timePickerContainer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.1)',
  },
  timeLabel: {
    fontSize: 12,
    color: '#f5d77a',
    marginBottom: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  timeInput: {
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 8,
    color: '#d4af37',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    width: 80,
  },
  timeHint: {
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.4)',
    fontStyle: 'italic',
  },
  planCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
    overflow: 'hidden',
  },
  proCard: {
    borderColor: '#d4af37',
    backgroundColor: '#0b1e3d',
  },
  currentPlanCard: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  proBadge: {
    position: 'absolute',
    top: 12,
    right: -30,
    backgroundColor: '#d4af37',
    paddingHorizontal: 40,
    paddingVertical: 4,
    transform: [{ rotate: '45deg' }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proBadgeText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#0b1e3d',
    textTransform: 'uppercase',
  },
  currentBadge: {
    position: 'absolute',
    top: 12,
    left: -30,
    backgroundColor: '#10B981',
    paddingHorizontal: 40,
    paddingVertical: 4,
    transform: [{ rotate: '-45deg' }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  currentBadgeText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#fff',
    textTransform: 'uppercase',
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  planName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    fontFamily: 'Playfair Display',
  },
  planInterval: {
    fontSize: 11,
    color: 'rgba(212, 175, 55, 0.6)',
    fontFamily: 'Playfair Display',
    marginTop: 2,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  planPrice: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#d4af37',
    fontFamily: 'Playfair Display',
  },
  planIntervalLabel: {
    fontSize: 12,
    color: 'rgba(212, 175, 55, 0.6)',
    fontFamily: 'Playfair Display',
  },
  featureList: {
    marginBottom: 25,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  featureText: {
    fontSize: 13,
    color: '#f5d77a',
    marginLeft: 10,
    fontFamily: 'Playfair Display',
    opacity: 0.9,
  },
  planButton: {
    backgroundColor: '#d4af37',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  activePlanButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderWidth: 1,
    borderColor: '#d4af37',
  },
  planButtonText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0b1e3d',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  proButton: {
    backgroundColor: '#fff',
  },
  activeProButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: '#fff',
    borderWidth: 1,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    padding: 15,
  },
  logoutText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
    marginLeft: 10,
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontFamily: 'Playfair Display',
  },
});
