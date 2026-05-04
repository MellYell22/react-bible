import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, TextInput, ActivityIndicator } from 'react-native';
import { motion } from 'motion/react';
import { supabase } from '../services/supabase';

const MotionView = motion(View);
import { Profile, Scripture } from '../types';
import { Frown, Wind, User, Heart, Flame, Sun, HelpCircle, Layers, Zap, Mic } from 'lucide-react';
import { OWNER_EMAIL } from '../utils/tier';

const MOOD_CONFIG = [
  { key: 'ANXIOUS', label: 'Anxious', icon: Wind },
  { key: 'SAD', label: 'Sad', icon: Frown },
  { key: 'LONELY', label: 'Lonely', icon: User },
  { key: 'STRESSED', label: 'Stressed', icon: Zap },
  { key: 'OVERWHELMED', label: 'Overwhelmed', icon: Layers },
  { key: 'HOPEFUL', label: 'Hopeful', icon: Sun },
  { key: 'GRATEFUL', label: 'Grateful', icon: Heart },
  { key: 'ANGRY', label: 'Angry', icon: Flame },
  { key: 'CONFUSED', label: 'Confused', icon: HelpCircle },
];
const TRANSLATIONS = ['NIV', 'KJV', 'NLT', 'ESV', 'NKJV', 'CSB'];

import { useUser } from '../UserContext';

export default function HomeScreen({ navigation }: any) {
  const { profile } = useUser();

  return (
    <View style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <View style={styles.heroSection}>
          <Text style={styles.mainTitle}>BMS</Text>
          <Text style={styles.subtitle}>BIBLE MOOD SEARCH</Text>
          <View style={styles.titleUnderline} />
        </View>

        <View style={styles.primaryActionContainer}>
          <MotionView
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            style={{ width: '100%', alignItems: 'center' }}
          >
            <TouchableOpacity 
              style={styles.talkButton}
              onPress={() => navigation.navigate('Voice')}
            >
              <View style={styles.talkButtonInner}>
                <Mic size={48} color="#051020" />
                <Text style={styles.talkButtonText}>TALK TO DAVID</Text>
              </View>
              <View style={styles.pulseContainer}>
                <motion.div
                  animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.1, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={styles.pulse}
                />
              </View>
            </TouchableOpacity>
            <Text style={styles.talkHint}>Instant spiritual support in real-time</Text>
          </MotionView>
        </View>

        <View style={styles.moodSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>HOW ARE YOU FEELING?</Text>
            <View style={styles.sectionLine} />
          </View>
          
          <View style={styles.moodPills}>
            {MOOD_CONFIG.map((m) => (
              <MotionView
                key={m.key}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                style={{ width: '31%', marginBottom: 12 }}
              >
                <TouchableOpacity 
                  style={styles.moodPill}
                  onPress={() => navigation.navigate('Mood', { mood: m.key })}
                >
                  <m.icon size={20} color="#d4af37" style={{ marginBottom: 8 }} />
                  <Text style={styles.moodPillText}>{m.label}</Text>
                </TouchableOpacity>
              </MotionView>
            ))}
          </View>
        </View>

        <View style={styles.footer}>
          {profile?.email === OWNER_EMAIL && (
            <Text style={styles.ownerBadge}>OWNER ACCOUNT</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#051020',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: 80,
    paddingBottom: 40,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 60,
  },
  mainTitle: {
    fontSize: 48,
    color: '#d4af37',
    fontFamily: 'Playfair Display',
    fontWeight: '900',
    letterSpacing: 8,
  },
  subtitle: {
    fontSize: 10,
    color: 'rgba(212, 175, 55, 0.6)',
    fontWeight: 'bold',
    letterSpacing: 4,
    marginTop: 10,
  },
  titleUnderline: {
    width: 60,
    height: 1,
    backgroundColor: '#d4af37',
    marginTop: 20,
    opacity: 0.3,
  },
  primaryActionContainer: {
    alignItems: 'center',
    marginBottom: 80,
  },
  talkButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#d4af37',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#d4af37',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 15,
  },
  talkButtonInner: {
    alignItems: 'center',
  },
  talkButtonText: {
    color: '#051020',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 16,
  },
  pulseContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulse: {
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 2,
    borderColor: '#d4af37',
    position: 'absolute',
  },
  talkHint: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 12,
    marginTop: 30,
    fontStyle: 'italic',
    fontFamily: 'Playfair Display',
  },
  moodSection: {
    width: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
  },
  sectionTitle: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginRight: 15,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
  },
  moodPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  moodPill: {
    backgroundColor: 'rgba(10, 26, 48, 0.5)',
    paddingVertical: 20,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
    width: '100%',
  },
  moodPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  footer: {
    marginTop: 60,
    alignItems: 'center',
  },
  ownerBadge: {
    color: '#d4af37',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
    opacity: 0.3,
  },
});

