import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, useWindowDimensions } from 'react-native';
import { Globe2, Menu, Search, Settings, User as UserIcon } from 'lucide-react';
import { APP_COLORS, APP_FONTS } from '../designSystem';
import { useUser } from '../UserContext';

const NAV_ITEMS = ['Home', 'Mood', 'Voice', 'Chat', 'Bible', 'Profile'] as const;
const BRAND_ROUTES = new Set(['Home', 'Mood', 'Pricing', 'Reflection']);

type Props = {
  current: string;
  navigation: { navigate: (name: any, params?: any) => void };
  onLogout?: () => void;
};

export default function AppNav({ current, navigation, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const veryCompact = width < 520;
  const { profile } = useUser();
  const brandMode = BRAND_ROUTES.has(current);
  const translation = profile?.preferred_translation || 'NIV';

  return (
    <View style={[styles.shell, brandMode && styles.shellBrand, compact && styles.shellCompact]}>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setMenuOpen(false)} accessibilityRole="button" accessibilityLabel="Close menu" />
          <View style={styles.menuPanel}>
            <TouchableOpacity onPress={() => setMenuOpen(false)} accessibilityRole="button" accessibilityLabel="Close navigation menu" style={styles.menuItem}><Text style={styles.menuText}>Close menu</Text></TouchableOpacity>
            {NAV_ITEMS.map(item => <TouchableOpacity key={item} accessibilityRole="button" onPress={() => { setMenuOpen(false); navigation.navigate(item); }} style={styles.menuItem}><Text style={styles.menuText}>{item}</Text></TouchableOpacity>)}
            <TouchableOpacity accessibilityRole="button" onPress={() => { setMenuOpen(false); navigation.navigate('Pricing'); }} style={styles.menuItem}><Text style={styles.menuText}>Plans</Text></TouchableOpacity>
            {onLogout && <TouchableOpacity accessibilityRole="button" onPress={() => { setMenuOpen(false); onLogout(); }} style={styles.menuItem}><Text style={styles.menuText}>Sign out</Text></TouchableOpacity>}
          </View>
        </View>
      </Modal>
      <View style={[styles.utilityLeft, compact && styles.utilityLeftCompact]}>
        <TouchableOpacity style={styles.iconButton} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Open menu" accessibilityState={{ expanded: menuOpen }}>
          <Menu size={compact ? 15 : 17} color={APP_COLORS.gold} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Bible')} accessibilityRole="button" accessibilityLabel="Search scripture">
          <Search size={compact ? 15 : 17} color={APP_COLORS.gold} />
        </TouchableOpacity>
        {!veryCompact && (
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel="Profile">
            <UserIcon size={compact ? 15 : 17} color={APP_COLORS.gold} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.centerArea}>
        {brandMode && (
          <View style={styles.brandWrap}>
            <Text style={[styles.brandTitle, compact && styles.brandTitleCompact]} numberOfLines={1}>BIBLE MOOD SEARCH</Text>
            {!veryCompact && <Text style={styles.brandTagline} numberOfLines={1}>DISCOVER SCRIPTURE FOR EVERY FEELING.</Text>}
          </View>
        )}

        <View style={[styles.navItems, compact && styles.navItemsCompact]}>
          {NAV_ITEMS.map((item) => (
            <TouchableOpacity
              key={item}
              onPress={() => navigation.navigate(item)}
              style={[styles.navButton, compact && styles.navButtonCompact]}
              accessibilityRole="button"
              accessibilityLabel={item}
            >
              <Text style={[styles.navText, compact && styles.navTextCompact, current === item && styles.navTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[styles.utilityRight, compact && styles.utilityRightCompact]}>
        {brandMode ? (
          <>
            <TouchableOpacity style={[styles.translationBadge, compact && styles.translationBadgeCompact]} onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel={`Translation ${translation}`}>
              <Text style={styles.translationText}>{translation}</Text>
              <Globe2 size={compact ? 11 : 12} color={APP_COLORS.gold} />
            </TouchableOpacity>
            {!veryCompact && (
              <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel="Settings">
                <Settings size={compact ? 15 : 17} color={APP_COLORS.gold} />
              </TouchableOpacity>
            )}
          </>
        ) : <View style={styles.balanceSpacer} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  menuPanel: { width: 280, maxWidth: '90%', backgroundColor: APP_COLORS.navyDeep, padding: 20, height: '100%' },
  menuItem: { paddingVertical: 15, minHeight: 44 },
  menuText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.sans, fontSize: 16 },
  shell: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    backgroundColor: APP_COLORS.navyDeep,
    borderBottomWidth: 1,
    borderBottomColor: APP_COLORS.borderSoft,
  },
  shellBrand: { minHeight: 86 },
  shellCompact: { minHeight: 72, paddingHorizontal: 10 },
  utilityLeft: { width: 118, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10 },
  utilityLeftCompact: { width: 76, gap: 3 },
  utilityRight: { width: 118, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 9 },
  utilityRightCompact: { width: 76, gap: 3 },
  iconButton: { minWidth: 28, minHeight: 30, alignItems: 'center', justifyContent: 'center' },
  centerArea: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  brandWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  brandTitle: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 13, fontWeight: '700', letterSpacing: 1.35, textAlign: 'center' },
  brandTitleCompact: { fontSize: 10, letterSpacing: 0.8 },
  brandTagline: { color: APP_COLORS.goldSoft, fontFamily: APP_FONTS.serif, fontSize: 6.5, fontWeight: '600', letterSpacing: 1.25, marginTop: 2, textAlign: 'center' },
  translationBadge: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 9, borderWidth: 1, borderColor: APP_COLORS.borderSoft },
  translationBadgeCompact: { minHeight: 28, paddingHorizontal: 5 },
  translationText: { color: APP_COLORS.gold, fontFamily: APP_FONTS.serif, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  navItems: { width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  navItemsCompact: { justifyContent: 'center' },
  navButton: { paddingHorizontal: 12, paddingVertical: 7 },
  navButtonCompact: { paddingHorizontal: 6, paddingVertical: 6 },
  navText: { color: 'rgba(241, 212, 119, 0.76)', fontFamily: APP_FONTS.sans, fontSize: 10, fontWeight: '700', letterSpacing: 0.15 },
  navTextCompact: { fontSize: 8.5 },
  navTextActive: { color: APP_COLORS.gold, borderBottomWidth: 2, borderBottomColor: APP_COLORS.gold, paddingBottom: 4 },
  balanceSpacer: { width: '100%', height: 1 },
});
