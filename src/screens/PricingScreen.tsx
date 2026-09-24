import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Check, Heart, Leaf, Sun } from 'lucide-react';
import { useUser } from '../UserContext';
import { createCheckoutSession, syncCheckoutSession } from '../services/stripe';
import { APP_COLORS, APP_FONTS } from '../designSystem';
import { PLANS } from '../constants';

const PLAN_COPY = [
  {
    id: 'free' as const,
    name: 'FREE',
    price: '$0',
    suffix: '',
    features: ['5 chats per day', '3 reflections per day', 'Access to core features'],
  },
  {
    id: 'plus' as const,
    name: 'PLUS',
    price: PLANS.PLUS.price,
    suffix: '/month',
    features: ['Unlimited text chat', 'Expanded reflections', 'Save your favorites', 'Ad-free experience'],
  },
  {
    id: 'pro' as const,
    name: 'PRO',
    price: PLANS.PRO.price,
    suffix: '/month',
    features: ['Everything in Plus', '1 hour of voice chat per month', 'Deeper, personalized reflections', 'Priority support'],
  },
];

type PaidTier = 'plus' | 'pro';

export default function PricingScreen({ route }: any) {
  const { width } = useWindowDimensions();
  const compact = width < 860;
  const { profile, refreshProfile } = useUser();
  const [loadingTier, setLoadingTier] = useState<PaidTier | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const currentTier = profile?.subscription_tier || 'free';
  const currentIndex = useMemo(() => ['free', 'plus', 'pro', 'owner'].indexOf(currentTier), [currentTier]);

  useEffect(() => {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const success = params?.get('success') === 'true' || route?.params?.success === true || route?.params?.paymentSuccess === true;
    const canceled = params?.get('canceled') === 'true' || route?.params?.canceled === true;
    const sessionId = params?.get('session_id') || route?.params?.sessionId;

    if (canceled) {
      setStatus({ tone: 'info', text: 'Checkout canceled. No changes were made.' });
      if (typeof window !== 'undefined') window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (!success || !sessionId || profile?.id === 'guest') return;

    let active = true;
    (async () => {
      try {
        setStatus({ tone: 'info', text: 'Payment received. Activating your plan…' });
        await syncCheckoutSession(sessionId);
        await refreshProfile(false);
        if (active) setStatus({ tone: 'success', text: 'Your subscription is active.' });
      } catch (error: any) {
        if (active) setStatus({ tone: 'error', text: error?.message || 'We could not verify the completed checkout yet.' });
      } finally {
        if (typeof window !== 'undefined') window.history.replaceState({}, '', window.location.pathname);
      }
    })();

    return () => { active = false; };
  }, [route?.params?.success, route?.params?.paymentSuccess, route?.params?.canceled, route?.params?.sessionId]);

  const beginCheckout = async (tier: PaidTier) => {
    if (profile?.id === 'guest') {
      setStatus({ tone: 'error', text: 'Create a free account or sign in before upgrading.' });
      return;
    }
    if (loadingTier) return;
    setLoadingTier(tier);
    setStatus(null);
    try {
      await createCheckoutSession(tier);
    } catch (error: any) {
      setStatus({ tone: 'error', text: error?.message || 'Unable to start checkout.' });
      setLoadingTier(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headingBlock}>
        <Text style={styles.title}>UNLOCK MORE WITH{compact ? '\n' : ' '}BIBLE AI COMPANION</Text>
        <Text style={styles.subtitle}>GO DEEPER. ANYTIME. ANYWHERE.</Text>
      </View>

      {status && (
        <View style={[styles.statusBox, status.tone === 'error' && styles.statusError, status.tone === 'success' && styles.statusSuccess]}>
          <Text style={styles.statusText}>{status.text}</Text>
        </View>
      )}

      <View style={[styles.planRow, compact && styles.planRowCompact]}>
        {PLAN_COPY.map((plan) => {
          const planIndex = ['free', 'plus', 'pro'].indexOf(plan.id);
          const included = currentIndex >= planIndex;
          const isCurrent = currentTier === plan.id || (currentTier === 'owner' && plan.id === 'pro');
          return (
            <View key={plan.id} style={[styles.planCard, plan.id === 'plus' && styles.featuredCard, compact && styles.planCardCompact]}>
              <Text style={styles.planName}>{plan.name}</Text>
              <View style={styles.priceLine}>
                <Text style={styles.planPrice}>{plan.price}</Text>
                {!!plan.suffix && <Text style={styles.planSuffix}>{plan.suffix}</Text>}
              </View>

              <View style={styles.featureList}>
                {plan.features.map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Check size={14} color={APP_COLORS.gold} strokeWidth={2.4} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>

              {plan.id === 'free' ? (
                <View style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{isCurrent ? 'CURRENT PLAN' : 'INCLUDED'}</Text>
                </View>
              ) : included ? (
                <View style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{isCurrent ? 'CURRENT PLAN' : 'INCLUDED'}</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.primaryButton} onPress={() => beginCheckout(plan.id as PaidTier)} disabled={!!loadingTier}>
                  {loadingTier === plan.id ? (
                    <ActivityIndicator size="small" color={APP_COLORS.navyDeep} />
                  ) : (
                    <Text style={styles.primaryButtonText}>UPGRADE TO {plan.name}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.rule} />

      <View style={[styles.valueRow, compact && styles.valueRowCompact]}>
        <View style={styles.valueItem}><Leaf color={APP_COLORS.gold} size={31} /><Text style={styles.valueText}>Grow in your faith</Text></View>
        <View style={styles.valueItem}><Sun color={APP_COLORS.gold} size={31} /><Text style={styles.valueText}>Find calm in every season</Text></View>
        <View style={styles.valueItem}><Heart color={APP_COLORS.gold} size={31} /><Text style={styles.valueText}>Always have a friend in David</Text></View>
      </View>

      <Image source={{ uri: '/design/pricing-banner.png' }} style={styles.banner} resizeMode="cover" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: APP_COLORS.navy },
  content: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 28, paddingBottom: 34 },
  headingBlock: { alignItems: 'center', marginBottom: 20 },
  title: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 27, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center', lineHeight: 34 },
  subtitle: { color: APP_COLORS.goldSoft, fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '600', letterSpacing: 1.2, marginTop: 5 },
  statusBox: { borderWidth: 1, borderColor: APP_COLORS.border, padding: 12, marginBottom: 16, backgroundColor: APP_COLORS.panel, alignItems: 'center' },
  statusError: { borderColor: '#a94049', backgroundColor: '#391724' },
  statusSuccess: { borderColor: '#31875f', backgroundColor: '#10372b' },
  statusText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 12, textAlign: 'center' },
  planRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  planRowCompact: { flexDirection: 'column' },
  planCard: { flex: 1, minHeight: 326, borderWidth: 1, borderColor: APP_COLORS.border, backgroundColor: APP_COLORS.navyDeep, padding: 20 },
  planCardCompact: { width: '100%', minHeight: 0 },
  featuredCard: { borderWidth: 2, borderColor: APP_COLORS.gold },
  planName: { color: APP_COLORS.cream, fontFamily: APP_FONTS.serif, fontSize: 16, fontWeight: '700', textAlign: 'center', letterSpacing: 1 },
  priceLine: { minHeight: 72, flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', marginTop: 8, marginBottom: 13 },
  planPrice: { color: APP_COLORS.cream, fontFamily: APP_FONTS.display, fontSize: 34, fontWeight: '600' },
  planSuffix: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 10, marginLeft: 3 },
  featureList: { flex: 1, gap: 11, marginBottom: 20 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureText: { flex: 1, color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 12, lineHeight: 17 },
  primaryButton: { minHeight: 42, backgroundColor: APP_COLORS.gold, borderWidth: 1, borderColor: APP_COLORS.goldSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryButtonText: { color: APP_COLORS.navyDeep, fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  secondaryButton: { minHeight: 42, borderWidth: 1, borderColor: APP_COLORS.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  secondaryButtonText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  rule: { height: 1, backgroundColor: APP_COLORS.border, marginTop: 26, marginBottom: 18 },
  valueRow: { flexDirection: 'row', justifyContent: 'space-around', gap: 20, marginBottom: 20 },
  valueRowCompact: { flexDirection: 'column', alignItems: 'center' },
  valueItem: { flex: 1, alignItems: 'center', gap: 8 },
  valueText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 12, textAlign: 'center' },
  banner: { width: '100%', height: 132, borderWidth: 1, borderColor: APP_COLORS.border },
});
