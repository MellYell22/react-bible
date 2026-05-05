import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { supabase } from '../services/supabase';
import { Profile } from '../types';
import { LogOut, CreditCard, Shield, CheckCircle2, AlertCircle, Lock, Star, Bookmark, Trash2, Check, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { createCheckoutSession } from '../services/stripe';
import { OWNER_EMAIL, hasProAccess } from '../utils/tier';
import { PLANS } from '../constants';
import { getSavedScriptures, toggleMemorized, deleteSavedScripture, updateScriptureCategory } from '../services/supabase';
import { SavedScripture } from '../types';

import { useUser } from '../UserContext';

export default function ProfileScreen({ route, navigation }: { route?: { params?: any }, navigation?: any }) {
  const { profile, refreshProfile, signOut } = useUser();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);
  const [showSavedScriptures, setShowSavedScriptures] = useState(false);
  const [savedScriptures, setSavedScriptures] = useState<SavedScripture[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const hasHandledRedirect = useRef(false);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const pricingRef = useRef<View>(null);

  useEffect(() => {
    return () => {
      if (pollingInterval.current) {
        clearTimeout(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isActivating && profile?.subscription_tier === 'pro') {
      console.log('[StripeDebug] Pro tier detected! Stopping polling.');
      setIsActivating(false);
      setStatusMessage({ text: 'Activation complete! Welcome to the Pro family.', type: 'success' });
      if (pollingInterval.current) {
        clearTimeout(pollingInterval.current);
        pollingInterval.current = null;
      }
    }
  }, [isActivating, profile?.subscription_tier]);

  useEffect(() => {
    if (route?.params?.showPricing && !showSavedScriptures) {
      setTimeout(() => {
        pricingRef.current?.measureLayout(
          (scrollViewRef.current as any).getInnerViewNode(),
          (x, y) => {
            scrollViewRef.current?.scrollTo({ y: y - 20, animated: true });
          },
          () => { }
        );
      }, 500);
    }
  }, [route?.params?.showPricing, showSavedScriptures]);

  useEffect(() => {
    // Return early if we've already handled this redirect in this component instance
    if (hasHandledRedirect.current) return;

    // Check for URL parameters (success/canceled)
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success') === 'true' || route?.params?.success || route?.params?.paymentSuccess;
    const canceled = urlParams.get('canceled') === 'true' || route?.params?.canceled;
    const showPricing = route?.params?.showPricing;

    if (success || canceled) {
      console.log(`[StripeDebug] Handling Stripe redirect. Success: ${!!success}, Canceled: ${!!canceled}`);

      // Mark as handled to prevent re-triggering within this lifecycle
      hasHandledRedirect.current = true;

      // Update state based on parameters
      if (success) {
        if (profile?.subscription_tier !== 'pro') {
          setIsActivating(true);
          setStatusMessage({ text: 'Payment received! Activating your Pro plan...', type: 'info' });

          // Start polling for subscription update
          let attempts = 0;
          const maxAttempts = 20; // 20 attempts * 3 seconds = 60 seconds

          const checkStatus = async () => {
            attempts++;
            console.log(`[StripeDebug] Polling subscription status (Attempt ${attempts}/${maxAttempts})...`);

            const latestProfile = await refreshProfile(false);

            if (latestProfile?.subscription_tier === 'pro' || latestProfile?.subscription_tier === 'owner') {
              console.log('[StripeDebug] PRO STATUS CONFIRMED via manual fetch! Unlocking app features.');
              setIsActivating(false);
              setStatusMessage({ text: 'Activation complete! Welcome to the Pro family.', type: 'success' });
              return; // Stop polling
            }

            if (attempts >= maxAttempts) {
              setIsActivating(false);
              setStatusMessage({
                text: 'Activation is taking a bit longer than expected. It will update automatically in a few moments.',
                type: 'info'
              });
              return; // Stop polling
            }

            // Schedule next attempt
            pollingInterval.current = setTimeout(checkStatus, 2000);
          };

          // Start the polling chain
          checkStatus();
        } else {
          setStatusMessage({ text: 'Subscription updated successfully! Welcome to the Pro family.', type: 'success' });
        }
      } else if (canceled) {
        setStatusMessage({ text: 'Checkout canceled. No changes were made.', type: 'info' });
      }

      // 1. Clear Params from React Navigation state if possible
      if (navigation && navigation.setParams) {
        navigation.setParams({ success: undefined, canceled: undefined });
      }

      // 2. Clear params from Browser URL bar without reload
      if (typeof window !== 'undefined' && window.history) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }, [route?.params, refreshProfile, navigation]);

  const handleLogout = async () => {
    await signOut();
  };

  useEffect(() => {
    if (showSavedScriptures && profile) {
      fetchSavedScriptures();
    }
  }, [showSavedScriptures, profile]);

  const fetchSavedScriptures = async () => {
    if (!profile) return;
    setLoadingSaved(true);
    try {
      const data = await getSavedScriptures(profile.id);
      setSavedScriptures(data);
    } catch (error: any) {
      console.error('Error fetching saved scriptures:', error);
    } finally {
      setLoadingSaved(false);
    }
  };

  const handleToggleMemorized = async (item: SavedScripture) => {
    try {
      await toggleMemorized(item.id, !item.is_memorized);
      setSavedScriptures(prev => prev.map(s => s.id === item.id ? { ...s, is_memorized: !s.is_memorized } : s));
    } catch (error) {
      console.error('Error toggling memorized:', error);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    Alert.alert(
      'Delete Scripture',
      'Are you sure you want to remove this verse from your list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSavedScripture(id);
              setSavedScriptures(prev => prev.filter(s => s.id !== id));
            } catch (error) {
              console.error('Error deleting scripture:', error);
            }
          }
        }
      ]
    );
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
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        {isActivating && (
          <View style={styles.activatingLoader}>
            <ActivityIndicator size="small" color="#d4af37" />
            <Text style={styles.activatingText}>ACTIVATING PRO FEATURES...</Text>
          </View>
        )}
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

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, !showSavedScriptures && styles.tabActive]}
          onPress={() => setShowSavedScriptures(false)}
        >
          <Text style={[styles.tabText, !showSavedScriptures && styles.tabTextActive]}>SETTINGS</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, showSavedScriptures && styles.tabActive]}
          onPress={() => setShowSavedScriptures(true)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Bookmark size={12} color={showSavedScriptures ? '#d4af37' : 'rgba(212, 175, 55, 0.4)'} />
            <Text style={[styles.tabText, showSavedScriptures && styles.tabTextActive]}>SAVED</Text>
          </View>
        </TouchableOpacity>
      </View>

      {showSavedScriptures ? (
        <View style={styles.savedSection}>
          <View style={styles.savedHeader}>
            <Text style={styles.sectionTitle}>My Saved Scriptures</Text>
            <TouchableOpacity onPress={fetchSavedScriptures} disabled={loadingSaved}>
              <Text style={{ fontSize: 10, color: '#d4af37', fontWeight: 'bold' }}>REFRESH</Text>
            </TouchableOpacity>
          </View>

          {loadingSaved ? (
            <ActivityIndicator size="large" color="#d4af37" style={{ marginTop: 40 }} />
          ) : savedScriptures.length === 0 ? (
            <View style={styles.emptySaved}>
              <Bookmark size={40} color="rgba(212, 175, 55, 0.1)" style={{ marginBottom: 15 }} />
              <Text style={styles.emptySavedText}>Your saved list is empty.</Text>
              <Text style={styles.emptySavedSubtext}>Verses you save from search or the home screen will appear here.</Text>
            </View>
          ) : (
            savedScriptures.map((item) => (
              <View key={item.id} style={[styles.savedCard, item.is_memorized && styles.memorizedCard]}>
                <TouchableOpacity
                  style={styles.savedCardHeader}
                  onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  <View style={styles.savedCardTitleRow}>
                    <View style={[styles.memorizedDot, { backgroundColor: item.is_memorized ? '#10B981' : 'rgba(212, 175, 55, 0.3)' }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.savedReference}>{item.reference}</Text>
                      <Text style={styles.savedCategory}>{item.category || 'Uncategorized'} • {item.version}</Text>
                    </View>
                    {expandedId === item.id ? <ChevronUp size={16} color="#d4af37" /> : <ChevronDown size={16} color="#d4af37" />}
                  </View>
                </TouchableOpacity>

                {expandedId === item.id && (
                  <View style={styles.savedCardContent}>
                    <Text style={styles.savedText}>"{item.text}"</Text>

                    <View style={styles.categoryInputRow}>
                      <Text style={styles.categoryLabel}>CATEGORY</Text>
                      <TextInput
                        style={styles.categoryInput}
                        value={item.category || ''}
                        onChangeText={(text) => {
                          setSavedScriptures(prev => prev.map(s => s.id === item.id ? { ...s, category: text } : s));
                        }}
                        onBlur={() => updateScriptureCategory(item.id, item.category || 'Uncategorized')}
                        placeholder="Add category..."
                        placeholderTextColor="rgba(212, 175, 55, 0.3)"
                      />
                    </View>

                    <View style={styles.savedActions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, item.is_memorized && styles.memorizedBtn]}
                        onPress={() => handleToggleMemorized(item)}
                      >
                        <Check size={14} color={item.is_memorized ? '#fff' : '#10B981'} />
                        <Text style={[styles.actionBtnText, item.is_memorized && { color: '#fff' }]}>
                          {item.is_memorized ? 'MEMORIZED' : 'MARK AS MEMORIZED'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn]}
                        onPress={() => handleDeleteSaved(item.id)}
                      >
                        <Trash2 size={14} color="#EF4444" />
                        <Text style={[styles.actionBtnText, { color: '#EF4444' }]}>REMOVE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      ) : (
        <>
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
              <Text style={styles.settingsHint}>Upgrade to Pro to unlock medium and long responses.</Text>
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

          <Text style={[styles.sectionTitle, { paddingLeft: 44 }]}>Your Benefits</Text>
          <View style={[styles.benefitsSummary, { paddingLeft: 16 }]}>
            <View style={styles.benefitItem}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.benefitText}>
                {profile?.subscription_tier === 'pro' ? 'Unlimited AI Chat with David' : '3 Mood Searches / Day'}
              </Text>
            </View>
            <View style={styles.benefitItem}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.benefitText}>
                {profile?.subscription_tier === 'pro' ? 'Live Voice Chat with David' : 'Standard AI Reflections'}
              </Text>
            </View>
            <View style={styles.benefitItem}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.benefitText}>
                {profile?.subscription_tier === 'pro' ? 'Mood-based Music and Reflections' : 'Daily Verse of the Day'}
              </Text>
            </View>
            {profile?.subscription_tier === 'pro' && (
              <View style={styles.benefitItem}>
                <CheckCircle2 size={16} color="#10B981" />
                <Text style={styles.benefitText}>Deeper Scripture Insights & Ad-free</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle} onLayout={(e) => {
            // Fallback for measurement if needed
          }} ref={pricingRef}>Subscription Plans</Text>

          {Object.values(PLANS).map((plan) => {
            const currentTier = profile?.subscription_tier || 'free';
            const isOwner = profile?.email === OWNER_EMAIL;
            const isCurrentPlan = currentTier === plan.id;

            // Tier hierarchy: free < pro < owner
            const tierOrder = ['free', 'pro', 'owner'];
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
        </>
      )}

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
  activatingLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 30,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  activatingText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
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
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 30,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 16,
  },
  tabActive: {
    backgroundColor: '#0f2a52',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  tabText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: 'rgba(212, 175, 55, 0.4)',
    letterSpacing: 1,
  },
  tabTextActive: {
    color: '#d4af37',
  },
  savedSection: {
    marginBottom: 30,
  },
  savedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  emptySaved: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#0f2a52',
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  emptySavedText: {
    color: '#d4af37',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'Playfair Display',
    marginBottom: 8,
  },
  emptySavedSubtext: {
    color: 'rgba(212, 175, 55, 0.5)',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: 'Playfair Display',
  },
  savedCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
    overflow: 'hidden',
  },
  memorizedCard: {
    borderColor: 'rgba(16, 185, 129, 0.3)',
    backgroundColor: 'rgba(16, 185, 129, 0.02)',
  },
  savedCardHeader: {
    padding: 16,
  },
  savedCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memorizedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  savedReference: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
    fontFamily: 'Playfair Display',
  },
  savedCategory: {
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.6)',
    marginTop: 2,
    fontWeight: '600',
  },
  savedCardContent: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.05)',
  },
  savedText: {
    fontSize: 15,
    color: '#ffffff',
    lineHeight: 24,
    fontStyle: 'italic',
    fontFamily: 'Playfair Display',
    marginBottom: 16,
    marginTop: 16,
  },
  categoryInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderRadius: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  categoryLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#d4af37',
    marginRight: 10,
    letterSpacing: 1,
  },
  categoryInput: {
    flex: 1,
    color: '#f5d77a',
    fontSize: 12,
    paddingVertical: 8,
    fontFamily: 'Playfair Display',
  },
  savedActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  actionBtnText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    color: 'rgba(212, 175, 55, 0.8)',
  },
  memorizedBtn: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  deleteBtn: {
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
});