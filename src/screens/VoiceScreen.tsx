import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useUser } from '../UserContext';
import { hasProAccess, OWNER_EMAIL } from '../utils/tier';

const DAVID_ELEVENLABS_AGENT_ID = 'agent_1901m3h52nn7e5xtyze0e3rkb6q5';

export default function VoiceScreen() {
  const { profile, session, loading } = useUser();

  const hasVoiceAccess = useMemo(() => {
    if (profile && hasProAccess(profile)) return true;
    return session?.user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  }, [profile, session?.user?.email]);

  if (loading) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>David</Text>
        <Text style={styles.status}>Getting your voice session ready…</Text>
      </View>
    );
  }

  if (!hasVoiceAccess) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Talk with David</Text>
        <Text style={styles.status}>David’s live voice conversations are included with Pro.</Text>
      </View>
    );
  }

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Talk with David</Text>
        <Text style={styles.status}>David’s ElevenLabs voice agent is connected on the web app.</Text>
      </View>
    );
  }

  const userId = session?.user?.id || '';
  const dynamicVariables = JSON.stringify({ user_id: userId });

  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>LIVE VOICE</Text>
      <Text style={styles.title}>Talk with David</Text>
      <Text style={styles.status}>
        David now connects directly to the ElevenLabs conversational agent. Allow microphone access when prompted.
      </Text>

      <View style={styles.agentShell}>
        {React.createElement('elevenlabs-convai', {
          'agent-id': DAVID_ELEVENLABS_AGENT_ID,
          'dynamic-variables': dynamicVariables,
          variant: 'expanded',
          'start-call-text': 'Start Conversation',
          'end-call-text': 'End Conversation',
          'listening-text': 'David is listening…',
          'speaking-text': 'David is speaking…',
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 620,
    backgroundColor: '#08172f',
    paddingHorizontal: 20,
    paddingTop: 38,
    alignItems: 'center',
  },
  eyebrow: {
    color: '#d4af37',
    fontSize: 12,
    letterSpacing: 2.2,
    marginBottom: 10,
  },
  title: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '500',
    marginBottom: 10,
  },
  status: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 620,
    marginBottom: 24,
  },
  agentShell: {
    width: '100%',
    maxWidth: 720,
    minHeight: 460,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
});
