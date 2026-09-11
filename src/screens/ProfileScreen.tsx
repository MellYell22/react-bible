import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Bookmark, Check, ChevronDown, ChevronRight, ChevronUp, HelpCircle, LogOut, Mail, Settings, ShieldCheck, Trash2, UserCircle2 } from 'lucide-react';
import { useUser } from '../UserContext';
import { supabase, deleteSavedScripture, getSavedScriptures, toggleMemorized, updateScriptureCategory } from '../services/supabase';
import { SavedScripture } from '../types';
import { APP_COLORS, APP_FONTS } from '../designSystem';
import { requestSubscription, SubscriptionStatus } from '../services/stripe';
import { OWNER_EMAIL, hasProAccess } from '../utils/tier';

const SUPPORT_EMAIL = 'contact@aa-designs.com';

const CANCELLATION_REASONS = [
  'The subscription is too expensive',
  'I bought it by accident',
  'I do not use it enough',
  'I am having technical issues',
  'It is missing a feature I need',
  'Other',
] as const;

type Section = 'account' | 'subscription' | 'saved' | 'settings' | 'help' | null;

export default function ProfileScreen({ navigation }: any) {
  const { profile, signOut, refreshProfile } = useUser();
  const [section, setSection] = useState<Section>(null);
  const [savedScriptures, setSavedScriptures] = useState<SavedScripture[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showCancellationFeedback, setShowCancellationFeedback] = useState(false);
  const [cancellationReason, setCancellationReason] = useState<string | null>(null);
  const [cancellationDetails, setCancellationDetails] = useState('');
  const [submittingCancellationFeedback, setSubmittingCancellationFeedback] = useState(false);

  const [billing, setBilling] = useState<SubscriptionStatus | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [confirmCancellation, setConfirmCancellation] = useState(false);

  const tier = profile?.subscription_tier;
  const isOwner = profile?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase() || tier === 'owner';
  const isPaid = tier === 'plus' || tier === 'pro' || isOwner;

  const loadSaved = async () => {
    if (!profile) return;
    setLoadingSaved(true);
    try {
      setSavedScriptures(await getSavedScriptures(profile.id));
    } finally {
      setLoadingSaved(false);
    }
  };

  useEffect(() => {
    if (section === 'saved') void loadSaved();
  }, [section, profile?.id]);

  const updatePreference = async (field: string, value: any) => {
    if (!profile || profile.id === 'guest' || !supabase) return;
    setUpdating(true);
    setStatus(null);
    try {
      const { error } = await supabase.from('profiles').update({ [field]: value }).eq('id', profile.id);
      if (error) throw error;
      await refreshProfile(false);
      setStatus('Preferences updated.');
    } catch (error: any) {
      setStatus(error?.message || 'Unable to update preferences.');
    } finally {
      setUpdating(false);
    }
  };

  const toggleSection = (next: Exclude<Section, null>) => setSection((current) => current === next ? null : next);

  const loadSubscription = async () => {
    setLoadingBilling(true);
    setStatus(null);
    try { setBilling(await requestSubscription('status')); }
    catch (error: any) { setStatus(error.message); }
    finally { setLoadingBilling(false); }
  };

  useEffect(() => {
    if (section === 'subscription' && isPaid && !isOwner) void loadSubscription();
  }, [section, profile?.id]);

  const cancelSubscription = async () => {
    if (submittingCancellationFeedback) return;
    setSubmittingCancellationFeedback(true);
    setStatus(null);
    try {
      setBilling(await requestSubscription('cancel'));
      setConfirmCancellation(false);
      setStatus('Your subscription has been canceled. Access continues until the end of your paid period.');
    } catch (error: any) { setStatus(error.message); }
    finally { setSubmittingCancellationFeedback(false); }
  };

  const beginCancellationFlow = () => {
    setCancellationReason(null);
    setCancellationDetails('');
    setShowCancellationFeedback(true);
  };

  const continueToCancellation = async (saveFeedback: boolean) => {
    if (submittingCancellationFeedback) return;

    setSubmittingCancellationFeedback(true);
    try {
      if (saveFeedback && cancellationReason && profile?.id && profile.id !== 'guest' && supabase) {
        const { error } = await supabase.from('subscription_cancellation_feedback').insert({
          user_id: profile.id,
          plan: tier || null,
          reason: cancellationReason,
          details: cancellationDetails.trim() || null,
        });

        if (error) {
          console.warn('[Subscription] Cancellation feedback could not be saved:', error.message);
        }
      }

      setShowCancellationFeedback(false);
      setConfirmCancellation(true);
    } finally {
      setSubmittingCancellationFeedback(false);
    }
  };

  const contactSupport = () => {
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Bible%20AI%20Companion%20Support`);
  };

  const menuRows = [
    { key: 'account' as const, label: 'Account Information', icon: UserCircle2, onPress: () => toggleSection('account') },
    { key: 'subscription' as const, label: 'Subscription', icon: ShieldCheck, onPress: () => toggleSection('subscription') },
    { key: 'saved' as const, label: 'Saved Reflections', icon: Bookmark, onPress: () => toggleSection('saved') },
    { key: 'settings' as const, label: 'Settings', icon: Settings, onPress: () => toggleSection('settings') },
    { key: 'help' as const, label: 'Help & Support', icon: HelpCircle, onPress: () => toggleSection('help') },
  ];

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}><UserCircle2 size={46} color={APP_COLORS.gold} strokeWidth={1.5} /></View>
          <View>
            <Text style={styles.title}>My Profile</Text>
            <Text style={styles.subtitle}>Manage your account and preferences</Text>
          </View>
        </View>

        <View style={styles.menuList}>
          {menuRows.map((row) => {
            const Icon = row.icon;
            const isOpen = section === row.key;
            return (
              <TouchableOpacity key={row.key} style={styles.menuRow} onPress={row.onPress}>
                <View style={styles.menuLabelWrap}><Icon size={16} color={APP_COLORS.gold} /><Text style={styles.menuLabel}>{row.label}</Text></View>
                {isOpen ? <ChevronDown size={18} color={APP_COLORS.gold} /> : <ChevronRight size={18} color={APP_COLORS.gold} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {section === 'account' && (
          <View style={styles.detailPanel}>
            <Text style={styles.detailTitle}>ACCOUNT INFORMATION</Text>
            <View style={styles.infoRow}><Mail size={15} color={APP_COLORS.gold} /><Text style={styles.infoText}>{profile?.email || 'Guest'}</Text></View>
            <View style={styles.infoRow}><ShieldCheck size={15} color={APP_COLORS.gold} /><Text style={styles.infoText}>Plan: {isOwner ? 'Owner' : (profile?.subscription_tier || 'free').toUpperCase()}</Text></View>
          </View>
        )}

        {section === 'subscription' && (
          <View style={styles.detailPanel}>
            <Text style={styles.detailTitle}>SUBSCRIPTION</Text>
            {status && <Text style={styles.statusText}>{status}</Text>}
            <Text style={styles.helpText}>Current plan: {isOwner ? 'OWNER' : (profile?.subscription_tier || 'free').toUpperCase()}</Text>
            {isPaid && !isOwner ? (
              <>
                <Text style={styles.subscriptionNote}>{loadingBilling ? 'Loading subscription…' : billing ? `${billing.cancelAtPeriodEnd ? 'Canceled — access ends' : billing.status + ' — current period ends'} ${new Date(billing.currentPeriodEnd * 1000).toLocaleDateString()}` : 'Subscription status could not be loaded.'}</Text>
                {!billing && !loadingBilling && <TouchableOpacity onPress={loadSubscription}><Text style={styles.refreshText}>RETRY</Text></TouchableOpacity>}
                {confirmCancellation && <View>
                  <Text style={styles.helpText}>Cancel renewal? Your access continues through the paid period shown above.</Text>
                  <TouchableOpacity style={styles.cancelButton} onPress={cancelSubscription} disabled={submittingCancellationFeedback}>
                    <Text style={styles.cancelButtonText}>{submittingCancellationFeedback ? 'CANCELING…' : 'CONFIRM CANCELLATION'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmCancellation(false)} disabled={submittingCancellationFeedback}><Text style={styles.helpText}>KEEP SUBSCRIPTION</Text></TouchableOpacity>
                </View>}
                {!confirmCancellation && !billing?.cancelAtPeriodEnd && (!billing || ['active', 'trialing', 'past_due'].includes(billing.status)) && <TouchableOpacity style={styles.cancelButton} onPress={beginCancellationFlow} disabled={loadingBilling}>
                  <Text style={styles.cancelButtonText}>CANCEL SUBSCRIPTION</Text>
                </TouchableOpacity>}
              </>
            ) : isOwner ? (
              <Text style={styles.subscriptionNote}>Owner access does not have a cancellable subscription.</Text>
            ) : (
              <TouchableOpacity style={styles.manageButton} onPress={() => navigation?.navigate('Pricing')}>
                <Text style={styles.manageButtonText}>VIEW PLANS</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {section === 'saved' && (
          <View style={styles.detailPanel}>
            <View style={styles.detailHeaderRow}><Text style={styles.detailTitle}>SAVED REFLECTIONS</Text><TouchableOpacity onPress={loadSaved}><Text style={styles.refreshText}>REFRESH</Text></TouchableOpacity></View>
            {loadingSaved ? <ActivityIndicator color={APP_COLORS.gold} style={{ marginVertical: 22 }} /> : savedScriptures.length === 0 ? (
              <Text style={styles.emptyText}>Your saved list is empty.</Text>
            ) : savedScriptures.map((item) => (
              <View key={item.id} style={styles.savedCard}>
                <TouchableOpacity style={styles.savedHeader} onPress={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                  <View style={{ flex: 1 }}><Text style={styles.savedReference}>{item.reference}</Text><Text style={styles.savedMeta}>{item.category || 'Uncategorized'} · {item.version}</Text></View>
                  {expandedId === item.id ? <ChevronUp size={16} color={APP_COLORS.gold} /> : <ChevronDown size={16} color={APP_COLORS.gold} />}
                </TouchableOpacity>
                {expandedId === item.id && (
                  <View style={styles.savedBody}>
                    <Text style={styles.savedVerse}>“{item.verse}”</Text>
                    <TextInput
                      style={styles.categoryInput}
                      value={item.category || ''}
                      onChangeText={(text) => setSavedScriptures((prev) => prev.map((saved) => saved.id === item.id ? { ...saved, category: text } : saved))}
                      onBlur={() => updateScriptureCategory(item.id, item.category || 'Uncategorized')}
                      placeholder="Category"
                      placeholderTextColor="rgba(241,212,119,0.38)"
                    />
                    <View style={styles.savedActions}>
                      <TouchableOpacity style={styles.smallButton} onPress={async () => { await toggleMemorized(item.id, !item.is_memorized); setSavedScriptures((prev) => prev.map((saved) => saved.id === item.id ? { ...saved, is_memorized: !saved.is_memorized } : saved)); }}>
                        <Check size={14} color={APP_COLORS.gold} /><Text style={styles.smallButtonText}>{item.is_memorized ? 'MEMORIZED' : 'MARK MEMORIZED'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallButton} onPress={async () => { await deleteSavedScripture(item.id); setSavedScriptures((prev) => prev.filter((saved) => saved.id !== item.id)); }}>
                        <Trash2 size={14} color="#ef6a72" /><Text style={[styles.smallButtonText, { color: '#ef6a72' }]}>REMOVE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {section === 'settings' && (
          <View style={styles.detailPanel}>
            <Text style={styles.detailTitle}>SETTINGS</Text>
            {status && <Text style={styles.statusText}>{status}</Text>}
            <Text style={styles.settingLabel}>RESPONSE LENGTH</Text>
            <View style={styles.optionRow}>
              {(['short', 'medium', 'long'] as const).map((length) => {
                const disabled = length !== 'short' && !hasProAccess(profile);
                const selected = profile?.preferred_response_length === length;
                return (
                  <TouchableOpacity key={length} style={[styles.optionButton, selected && styles.optionButtonActive, disabled && styles.optionDisabled]} onPress={() => !disabled && updatePreference('preferred_response_length', length)} disabled={disabled || updating}>
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>{length.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.settingLabel, { marginTop: 18 }]}>VERSE OF THE DAY</Text>
            <TouchableOpacity style={styles.toggleRow} onPress={() => updatePreference('verse_of_the_day_enabled', !profile?.verse_of_the_day_enabled)} disabled={updating}>
              <Text style={styles.toggleLabel}>Daily notifications</Text>
              <View style={[styles.toggleBox, profile?.verse_of_the_day_enabled && styles.toggleBoxActive]}>{profile?.verse_of_the_day_enabled && <Check size={14} color={APP_COLORS.navyDeep} />}</View>
            </TouchableOpacity>
          </View>
        )}

        {section === 'help' && (
          <View style={styles.detailPanel}>
            <Text style={styles.detailTitle}>HELP & SUPPORT</Text>
            <Text style={styles.helpText}>Need help with your account, subscription, or Bible AI Companion? Contact AA Designs support and include the issue you’re seeing.</Text>
            <TouchableOpacity style={styles.contactRow} onPress={contactSupport}>
              <Mail size={16} color={APP_COLORS.gold} />
              <Text style={styles.contactEmail}>{SUPPORT_EMAIL}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
          <LogOut size={17} color={APP_COLORS.cream} />
          <Text style={styles.logoutText}>LOG OUT</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showCancellationFeedback}
        transparent
        animationType="fade"
        onRequestClose={() => !submittingCancellationFeedback && setShowCancellationFeedback(false)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView style={styles.modalCard}>
            <Text style={styles.modalEyebrow}>SUBSCRIPTION FEEDBACK</Text>
            <Text style={styles.modalTitle}>Before you go</Text>
            <Text style={styles.modalQuestion}>Why do you want to change or cancel your subscription?</Text>

            <View style={styles.reasonList}>
              {CANCELLATION_REASONS.map((reason) => {
                const selected = cancellationReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    style={[styles.reasonButton, selected && styles.reasonButtonSelected]}
                    onPress={() => setCancellationReason(reason)}
                    disabled={submittingCancellationFeedback}
                  >
                    <View style={[styles.reasonRadio, selected && styles.reasonRadioSelected]}>
                      {selected && <View style={styles.reasonRadioDot} />}
                    </View>
                    <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              style={styles.feedbackInput}
              value={cancellationDetails}
              onChangeText={setCancellationDetails}
              placeholder="Anything else you want us to know? (optional)"
              placeholderTextColor="rgba(241,212,119,0.45)"
              multiline
              maxLength={500}
              editable={!submittingCancellationFeedback}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.continueCancelButton, (!cancellationReason || submittingCancellationFeedback) && styles.modalButtonDisabled]}
              onPress={() => void continueToCancellation(true)}
              disabled={!cancellationReason || submittingCancellationFeedback}
            >
              {submittingCancellationFeedback ? (
                <ActivityIndicator color={APP_COLORS.navyDeep} />
              ) : (
                <Text style={styles.continueCancelButtonText}>CONTINUE TO CANCELLATION</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipFeedbackButton}
              onPress={() => void continueToCancellation(false)}
              disabled={submittingCancellationFeedback}
            >
              <Text style={styles.skipFeedbackText}>SKIP FEEDBACK & CONTINUE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.keepSubscriptionButton}
              onPress={() => setShowCancellationFeedback(false)}
              disabled={submittingCancellationFeedback}
            >
              <Text style={styles.keepSubscriptionText}>GO BACK</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: APP_COLORS.navy },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatar: { width: 62, height: 62, borderWidth: 2, borderColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  title: { color: APP_COLORS.cream, fontFamily: APP_FONTS.display, fontSize: 25, fontWeight: '600' },
  subtitle: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 11, marginTop: 3 },
  menuList: { gap: 8 },
  menuRow: { minHeight: 46, borderWidth: 1, borderColor: APP_COLORS.border, backgroundColor: APP_COLORS.navyDeep, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 },
  menuLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuLabel: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 12 },
  detailPanel: { marginTop: 14, borderWidth: 1, borderColor: APP_COLORS.borderSoft, backgroundColor: APP_COLORS.navyDeep, padding: 16 },
  detailHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailTitle: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 11, fontWeight: '700', letterSpacing: 0.9, marginBottom: 14 },
  refreshText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 9, fontWeight: '700' },
  infoRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1, borderTopColor: APP_COLORS.borderSoft },
  infoText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 12 },
  emptyText: { color: APP_COLORS.muted, fontFamily: APP_FONTS.sans, fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  savedCard: { borderWidth: 1, borderColor: APP_COLORS.borderSoft, marginBottom: 9 },
  savedHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  savedReference: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 11, fontWeight: '700' },
  savedMeta: { color: APP_COLORS.muted, fontFamily: APP_FONTS.sans, fontSize: 9, marginTop: 2 },
  savedBody: { borderTopWidth: 1, borderTopColor: APP_COLORS.borderSoft, padding: 12 },
  savedVerse: { color: APP_COLORS.cream, fontFamily: APP_FONTS.display, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  categoryInput: { minHeight: 38, borderWidth: 1, borderColor: APP_COLORS.borderSoft, color: APP_COLORS.cream, paddingHorizontal: 10, marginTop: 10 },
  savedActions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  smallButton: { minHeight: 34, borderWidth: 1, borderColor: APP_COLORS.borderSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  smallButtonText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 9, fontWeight: '700' },
  statusText: { color: APP_COLORS.goldSoft, fontFamily: APP_FONTS.sans, fontSize: 10, marginBottom: 10 },
  subscriptionNote: { color: APP_COLORS.muted, fontFamily: APP_FONTS.sans, fontSize: 11, lineHeight: 18, marginTop: 8, marginBottom: 14 },
  cancelButton: { minHeight: 42, borderWidth: 1, borderColor: '#ef6a72', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelButtonText: { color: '#ef6a72', fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  manageButton: { minHeight: 42, borderWidth: 1, borderColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  manageButtonText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  settingLabel: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  optionRow: { flexDirection: 'row', gap: 8 },
  optionButton: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: APP_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  optionButtonActive: { backgroundColor: APP_COLORS.gold },
  optionDisabled: { opacity: 0.32 },
  optionText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 9, fontWeight: '700' },
  optionTextActive: { color: APP_COLORS.navyDeep },
  toggleRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 11 },
  toggleBox: { width: 24, height: 24, borderWidth: 1, borderColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  toggleBoxActive: { backgroundColor: APP_COLORS.gold },
  helpText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 12, lineHeight: 19 },
  contactRow: { minHeight: 42, marginTop: 14, borderTopWidth: 1, borderTopColor: APP_COLORS.borderSoft, flexDirection: 'row', alignItems: 'center', gap: 9 },
  contactEmail: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 12, fontWeight: '600' },
  logoutButton: { minHeight: 46, marginTop: 22, borderWidth: 1, borderColor: APP_COLORS.gold, backgroundColor: APP_COLORS.navyDeep, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  logoutText: { color: APP_COLORS.cream, fontFamily: APP_FONTS.serif, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(3, 10, 22, 0.82)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: APP_COLORS.navyDeep, borderWidth: 1, borderColor: APP_COLORS.gold, borderRadius: 20, padding: 22 },
  modalEyebrow: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginBottom: 8 },
  modalTitle: { color: APP_COLORS.cream, fontFamily: APP_FONTS.display, fontSize: 24, fontWeight: '600', marginBottom: 8 },
  modalQuestion: { color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  reasonList: { gap: 8 },
  reasonButton: { minHeight: 44, borderWidth: 1, borderColor: APP_COLORS.borderSoft, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  reasonButtonSelected: { borderColor: APP_COLORS.gold, backgroundColor: 'rgba(241, 212, 119, 0.08)' },
  reasonRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  reasonRadioSelected: { borderWidth: 2 },
  reasonRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: APP_COLORS.gold },
  reasonText: { flex: 1, color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 11 },
  reasonTextSelected: { color: APP_COLORS.goldSoft },
  feedbackInput: { minHeight: 88, marginTop: 14, borderWidth: 1, borderColor: APP_COLORS.borderSoft, borderRadius: 12, color: APP_COLORS.cream, fontFamily: APP_FONTS.sans, fontSize: 11, lineHeight: 17, padding: 12 },
  continueCancelButton: { minHeight: 44, marginTop: 16, borderRadius: 12, backgroundColor: APP_COLORS.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  continueCancelButtonText: { color: APP_COLORS.navyDeep, fontFamily: APP_FONTS.serif, fontSize: 9, fontWeight: '700', letterSpacing: 0.6, textAlign: 'center' },
  modalButtonDisabled: { opacity: 0.4 },
  skipFeedbackButton: { minHeight: 40, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  skipFeedbackText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  keepSubscriptionButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  keepSubscriptionText: { color: APP_COLORS.muted, fontFamily: APP_FONTS.sans, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});
