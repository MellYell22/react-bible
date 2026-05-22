import React from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ScrollView, 
  Platform,
  Dimensions
} from 'react-native';
import { 
  Search, 
  Bookmark, 
  User as UserIcon, 
  LogOut, 
  BookOpen 
} from 'lucide-react';
import { AUTHOR_CREDIT, APP_NAME } from '../constants';
import { BibleTranslation } from '../types';
import TranslationPicker from './TranslationPicker';

interface LayoutProps {
  children: React.ReactNode;
  user: any;
  onOpenSanctuary: () => void;
  onOpenBookmarks: () => void;
  onOpenProfile: () => void;
  onHome: () => void;
  onBrowse?: () => void;
  onLogout?: () => void;
  translation: BibleTranslation;
  onTranslationChange: (t: BibleTranslation) => void;
}

const { width } = Dimensions.get('window');

const Layout: React.FC<LayoutProps> = ({
  children,
  user,
  onOpenSanctuary,
  onOpenBookmarks,
  onOpenProfile,
  onHome,
  onBrowse,
  onLogout,
  translation,
  onTranslationChange
}) => {
  const isGuest = user?.id === 'guest';
  const isPro = user?.subscription_tier === 'pro';

  return (
    <View style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={onHome} style={styles.iconButton}>
              <BookOpen size={18} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onBrowse} style={styles.iconButton}>
              <Search size={18} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onOpenBookmarks} style={styles.iconButton}>
              <Bookmark size={18} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <View style={styles.headerCenter}>
            <Text style={styles.appName}>BIBLE MOOD SEARCH</Text>
            <Text style={styles.tagline}>DISCOVER SCRIPTURE FOR EVERY FEELING.</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.translationWrapper}>
              <TranslationPicker value={translation} onChange={onTranslationChange} />
            </View>
            <TouchableOpacity onPress={onOpenProfile} style={styles.iconButton}>
              <UserIcon size={18} color="#ffffff" />
            </TouchableOpacity>
            {onLogout && (
              <TouchableOpacity 
                onPress={onLogout}
                style={styles.iconButton}
              >
                <LogOut size={18} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <ScrollView 
          style={styles.main} 
          contentContainerStyle={styles.mainContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        <View style={styles.footer}>
          <Text style={styles.footerText}>{AUTHOR_CREDIT}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050a14',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#050a14',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.15)',
    zIndex: 50,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  headerCenter: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  iconButton: {
    padding: 8,
    marginHorizontal: 2,
  },
  translationWrapper: {
    marginRight: 8,
  },
  appName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 3,
    fontFamily: 'Cinzel',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 7,
    color: '#d4af37',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 4,
    textAlign: 'center',
    opacity: 0.8,
  },
  sanctuaryButton: {
    borderWidth: 1,
    borderColor: '#d4af37',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
  },
  sanctuaryText: {
    fontSize: 10,
    color: '#d4af37',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  main: {
    flex: 1,
  },
  mainContent: {
    maxWidth: 900,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  footer: {
    paddingVertical: 32,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.1)',
    backgroundColor: '#050a14',
  },
  footerText: {
    fontSize: 10,
    color: '#d4af37',
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
});

export default Layout;
