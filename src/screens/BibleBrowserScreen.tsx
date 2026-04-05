import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { motion } from 'motion/react';
import { ChevronRight, ChevronLeft, BookOpen, Book, Video } from 'lucide-react';
import { VideoGenerator } from '../components/VideoGenerator';

const MotionView = motion(View);
import { supabase } from '../services/supabase';
import { Profile } from '../types';

const BIBLE_BOOKS = [
  { name: 'Genesis', chapters: 50 }, { name: 'Exodus', chapters: 40 }, { name: 'Leviticus', chapters: 27 },
  { name: 'Numbers', chapters: 36 }, { name: 'Deuteronomy', chapters: 34 }, { name: 'Joshua', chapters: 24 },
  { name: 'Judges', chapters: 21 }, { name: 'Ruth', chapters: 4 }, { name: '1 Samuel', chapters: 31 },
  { name: '2 Samuel', chapters: 24 }, { name: '1 Kings', chapters: 22 }, { name: '2 Kings', chapters: 25 },
  { name: '1 Chronicles', chapters: 29 }, { name: '2 Chronicles', chapters: 36 }, { name: 'Ezra', chapters: 10 },
  { name: 'Nehemiah', chapters: 13 }, { name: 'Esther', chapters: 10 }, { name: 'Job', chapters: 42 },
  { name: 'Psalms', chapters: 150 }, { name: 'Proverbs', chapters: 31 }, { name: 'Ecclesiastes', chapters: 12 },
  { name: 'Song of Solomon', chapters: 8 }, { name: 'Isaiah', chapters: 66 }, { name: 'Jeremiah', chapters: 52 },
  { name: 'Lamentations', chapters: 5 }, { name: 'Ezekiel', chapters: 48 }, { name: 'Daniel', chapters: 12 },
  { name: 'Hosea', chapters: 14 }, { name: 'Joel', chapters: 3 }, { name: 'Amos', chapters: 9 },
  { name: 'Obadiah', chapters: 1 }, { name: 'Jonah', chapters: 4 }, { name: 'Micah', chapters: 7 },
  { name: 'Nahum', chapters: 3 }, { name: 'Habakkuk', chapters: 3 }, { name: 'Zephaniah', chapters: 3 },
  { name: 'Haggai', chapters: 2 }, { name: 'Zechariah', chapters: 14 }, { name: 'Malachi', chapters: 4 },
  { name: 'Matthew', chapters: 28 }, { name: 'Mark', chapters: 16 }, { name: 'Luke', chapters: 24 },
  { name: 'John', chapters: 21 }, { name: 'Acts', chapters: 28 }, { name: 'Romans', chapters: 16 },
  { name: '1 Corinthians', chapters: 16 }, { name: '2 Corinthians', chapters: 13 }, { name: 'Galatians', chapters: 6 },
  { name: 'Ephesians', chapters: 6 }, { name: 'Philippians', chapters: 4 }, { name: 'Colossians', chapters: 4 },
  { name: '1 Thessalonians', chapters: 5 }, { name: '2 Thessalonians', chapters: 3 }, { name: '1 Timothy', chapters: 6 },
  { name: '2 Timothy', chapters: 4 }, { name: 'Titus', chapters: 3 }, { name: 'Philemon', chapters: 1 },
  { name: 'Hebrews', chapters: 13 }, { name: 'James', chapters: 5 }, { name: '1 Peter', chapters: 5 },
  { name: '2 Peter', chapters: 3 }, { name: '1 John', chapters: 5 }, { name: '2 John', chapters: 1 },
  { name: '3 John', chapters: 1 }, { name: 'Jude', chapters: 1 }, { name: 'Revelation', chapters: 22 }
];

export default function BibleBrowserScreen() {
  const [view, setView] = useState<'books' | 'chapters' | 'verses' | 'content'>('books');
  const [selectedBook, setSelectedBook] = useState<typeof BIBLE_BOOKS[0] | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showVideoGenerator, setShowVideoGenerator] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) setProfile(data);
    }
  };

  const handleBookSelect = (book: typeof BIBLE_BOOKS[0]) => {
    setSelectedBook(book);
    setView('chapters');
  };

  const handleChapterSelect = (chapter: number) => {
    setSelectedChapter(chapter);
    setView('verses');
  };

  const handleVerseSelect = (verse: number) => {
    setSelectedVerse(verse);
    setView('content');
  };

  const goBack = () => {
    if (view === 'chapters') setView('books');
    else if (view === 'verses') setView('chapters');
    else if (view === 'content') setView('verses');
  };

  const renderHeader = () => (
    <View style={styles.header}>
      {view !== 'books' && (
        <TouchableOpacity onPress={goBack} style={styles.backButton}>
          <ChevronLeft color="#d4af37" size={24} />
        </TouchableOpacity>
      )}
      <Text style={styles.headerTitle}>
        {view === 'books' ? 'Select Book' : 
         view === 'chapters' ? selectedBook?.name : 
         view === 'verses' ? `${selectedBook?.name} ${selectedChapter}` : 
         `${selectedBook?.name} ${selectedChapter}:${selectedVerse}`}
      </Text>
    </View>
  );

  const renderBooks = () => (
    <FlatList
      data={BIBLE_BOOKS}
      keyExtractor={(item) => item.name}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.listItem} onPress={() => handleBookSelect(item)}>
          <Text style={styles.listItemText}>{item.name}</Text>
          <ChevronRight color="rgba(212, 175, 55, 0.3)" size={20} />
        </TouchableOpacity>
      )}
      contentContainerStyle={styles.listContent}
    />
  );

  const renderChapters = () => {
    if (!selectedBook) return null;
    const chapters = Array.from({ length: selectedBook.chapters }, (_, i) => i + 1);
    return (
      <FlatList
        data={chapters}
        numColumns={5}
        keyExtractor={(item) => item.toString()}
        renderItem={({ item }) => (
          <MotionView
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(212, 175, 55, 0.1)' }}
            whileTap={{ scale: 0.95 }}
            style={{ flex: 1, margin: 6 }}
          >
            <TouchableOpacity style={[styles.gridItem, { margin: 0 }]} onPress={() => handleChapterSelect(item)}>
              <Text style={styles.gridItemText}>{item}</Text>
            </TouchableOpacity>
          </MotionView>
        )}
        contentContainerStyle={styles.gridContent}
      />
    );
  };

  const renderVerses = () => {
    // Mocking verse count as 30 for all chapters for now
    const verses = Array.from({ length: 30 }, (_, i) => i + 1);
    return (
      <FlatList
        data={verses}
        numColumns={6}
        keyExtractor={(item) => item.toString()}
        renderItem={({ item }) => (
          <MotionView
            whileHover={{ scale: 1.05, backgroundColor: 'rgba(212, 175, 55, 0.1)' }}
            whileTap={{ scale: 0.95 }}
            style={{ flex: 1, margin: 4 }}
          >
            <TouchableOpacity style={[styles.gridItemSmall, { margin: 0 }]} onPress={() => handleVerseSelect(item)}>
              <Text style={styles.gridItemTextSmall}>{item}</Text>
            </TouchableOpacity>
          </MotionView>
        )}
        contentContainerStyle={styles.gridContent}
      />
    );
  };

  const renderContent = () => (
    <ScrollView style={styles.contentContainer}>
      <View style={styles.contentCard}>
        <BookOpen color="#d4af37" size={32} style={{ alignSelf: 'center', marginBottom: 20 }} />
        <Text style={styles.referenceText}>
          {selectedBook?.name} {selectedChapter}:{selectedVerse} ({profile?.preferred_translation || 'KJV'})
        </Text>
        <Text style={styles.verseBody}>
          This is where the actual scripture text would appear. In a production app, we would fetch this from a Bible API or local database using the selected reference and translation.
        </Text>
        
        {showVideoGenerator ? (
          <VideoGenerator 
            title={`${selectedBook?.name} ${selectedChapter}:${selectedVerse}`}
            prompt={`A cinematic, inspiring, and spiritually grounded visual accompaniment for the Bible verse: ${selectedBook?.name} ${selectedChapter}:${selectedVerse}. High quality, peaceful, and reverent.`}
            onClose={() => setShowVideoGenerator(false)}
          />
        ) : (
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#d4af37', marginBottom: 15 }]}
            onPress={() => setShowVideoGenerator(true)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Video size={18} color="#d4af37" />
              <Text style={[styles.actionButtonText, { color: '#d4af37' }]}>GENERATE VISION</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={styles.actionButton}
          onPress={() => setView('books')}
        >
          <Text style={styles.actionButtonText}>BROWSE MORE</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      <View style={styles.main}>
        {view === 'books' && renderBooks()}
        {view === 'chapters' && renderChapters()}
        {view === 'verses' && renderVerses()}
        {view === 'content' && renderContent()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: 'rgba(11, 30, 61, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.2)',
  },
  backButton: {
    marginRight: 15,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#d4af37',
    fontFamily: 'Playfair Display',
  },
  main: {
    flex: 1,
  },
  listContent: {
    padding: 20,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.1)',
  },
  listItemText: {
    fontSize: 18,
    color: '#ffffff',
    fontFamily: 'Playfair Display',
  },
  gridContent: {
    padding: 12,
  },
  gridItem: {
    aspectRatio: 1,
    backgroundColor: 'rgba(212, 175, 55, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
  },
  gridItemSmall: {
    aspectRatio: 1,
    backgroundColor: 'rgba(212, 175, 55, 0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  gridItemText: {
    fontSize: 16,
    color: '#d4af37',
    fontWeight: '600',
    fontFamily: 'Playfair Display',
  },
  gridItemTextSmall: {
    fontSize: 13,
    color: '#f5d77a',
    fontWeight: '500',
  },
  contentContainer: {
    flex: 1,
    padding: 20,
  },
  contentCard: {
    backgroundColor: '#0f2a52',
    borderRadius: 24,
    padding: 30,
    borderWidth: 1,
    borderColor: '#d4af37',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  referenceText: {
    fontSize: 14,
    color: '#d4af37',
    fontFamily: 'Cinzel',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: 20,
  },
  verseBody: {
    fontSize: 18,
    color: '#ffffff',
    lineHeight: 30,
    textAlign: 'center',
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    marginBottom: 30,
  },
  actionButton: {
    backgroundColor: '#d4af37',
    paddingVertical: 15,
    borderRadius: 30,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#0b1e3d',
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 2,
  }
});
