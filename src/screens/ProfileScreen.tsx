import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../services/supabase';
import { Profile } from '../types';
import { LogOut, CreditCard, Shield, CheckCircle2 } from 'lucide-react';
import { createCheckoutSession } from '../services/stripe';
import { OWNER_EMAIL, hasProAccess } from '../utils/tier';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) setProfile(data);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleUpgrade = async (tier: 'plus' | 'pro') => {
    if (!profile) return;
    setLoading(true);
    try {
      const priceId = tier === 'plus' ? import.meta.env.VITE_STRIPE_PRICE_ID_PLUS : import.meta.env.VITE_STRIPE_PRICE_ID_PRO;
      if (!priceId) throw new Error('Price ID not configured');
      await createCheckoutSession(priceId, profile.id);
    } catch (error: any) {
      alert(error.message);
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

      <Text style={styles.sectionTitle}>Subscription Plans</Text>
      
      <View style={styles.planCard}>
        <View style={styles.planHeader}>
          <Text style={styles.planName}>Plus Plan</Text>
          <Text style={styles.planPrice}>$9.99/mo</Text>
        </View>
        <View style={styles.featureList}>
          <View style={styles.featureItem}>
            <CheckCircle2 color="#10B981" size={16} />
            <Text style={styles.featureText}>Unlimited Mood Search</Text>
          </View>
          <View style={styles.featureItem}>
            <CheckCircle2 color="#10B981" size={16} />
            <Text style={styles.featureText}>Extended AI Devotions</Text>
          </View>
        </View>
        <TouchableOpacity 
          style={[styles.planButton, (profile?.subscription_tier === 'plus' || profile?.email === OWNER_EMAIL) && styles.activePlanButton]} 
          onPress={() => handleUpgrade('plus')}
          disabled={loading || profile?.subscription_tier === 'plus' || profile?.subscription_tier === 'pro' || profile?.email === OWNER_EMAIL}
        >
          <Text style={styles.planButtonText}>
            {profile?.email === OWNER_EMAIL ? 'Included' : profile?.subscription_tier === 'plus' ? 'Current Plan' : profile?.subscription_tier === 'pro' ? 'Included' : 'Upgrade to Plus'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.planCard, styles.proCard]}>
        <View style={styles.proBadge}>
          <Text style={styles.proBadgeText}>BEST VALUE</Text>
        </View>
        <View style={styles.planHeader}>
          <Text style={[styles.planName, { color: '#fff' }]}>Pro Plan</Text>
          <Text style={[styles.planPrice, { color: '#fff' }]}>$19.99/mo</Text>
        </View>
        <View style={styles.featureList}>
          <View style={styles.featureItem}>
            <CheckCircle2 color="#fff" size={16} />
            <Text style={[styles.featureText, { color: '#fff' }]}>Unlimited Everything</Text>
          </View>
          <View style={styles.featureItem}>
            <CheckCircle2 color="#fff" size={16} />
            <Text style={[styles.featureText, { color: '#fff' }]}>Live Voice Chat with David</Text>
          </View>
          <View style={styles.featureItem}>
            <CheckCircle2 color="#fff" size={16} />
            <Text style={[styles.featureText, { color: '#fff' }]}>Advanced AI Companion</Text>
          </View>
        </View>
        <TouchableOpacity 
          style={[styles.planButton, styles.proButton, (profile?.subscription_tier === 'pro' || profile?.email === OWNER_EMAIL) && styles.activeProButton]} 
          onPress={() => handleUpgrade('pro')}
          disabled={loading || profile?.subscription_tier === 'pro' || profile?.email === OWNER_EMAIL}
        >
          <Text style={[styles.planButtonText, { color: (profile?.subscription_tier === 'pro' || profile?.email === OWNER_EMAIL) ? '#4F46E5' : '#4F46E5' }]}>
            {profile?.email === OWNER_EMAIL ? 'Included' : profile?.subscription_tier === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
          </Text>
        </TouchableOpacity>
      </View>

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
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#f5d77a',
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  settingLabel: {
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.5)',
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 15,
  },
  translationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  translationItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    marginRight: 8,
    marginBottom: 8,
  },
  translationItemActive: {
    backgroundColor: '#d4af37',
    borderColor: '#d4af37',
  },
  translationItemText: {
    fontSize: 11,
    color: '#d4af37',
    fontWeight: 'bold',
  },
  translationItemTextActive: {
    color: '#0b1e3d',
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
  },
  proCard: {
    borderColor: '#d4af37',
    backgroundColor: '#0b1e3d',
  },
  proBadge: {
    position: 'absolute',
    top: -12,
    right: 24,
    backgroundColor: '#d4af37',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#0b1e3d',
    textTransform: 'uppercase',
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  planName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    fontFamily: 'Playfair Display',
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d4af37',
    fontFamily: 'Playfair Display',
  },
  featureList: {
    marginBottom: 25,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 13,
    color: '#f5d77a',
    marginLeft: 10,
    fontFamily: 'Playfair Display',
    opacity: 0.9,
  },
  planButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    padding: 14,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  activePlanButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderColor: '#d4af37',
  },
  planButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#d4af37',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  proButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderColor: '#d4af37',
  },
  activeProButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
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
  footer: {
    padding: 40,
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(212, 175, 55, 0.4)',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontWeight: '600',
    fontFamily: 'Cinzel',
  }
});
