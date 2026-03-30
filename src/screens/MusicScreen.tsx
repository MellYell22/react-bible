import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, TextInput, ActivityIndicator } from 'react-native';
import { Music, Play, Heart, ChevronRight, Download, CheckCircle2, Search, X, Filter, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WORSHIP_SONGS, Song } from '../constants/songs';

const MotionView = motion(View);
import { MusicPlayer } from '../components/MusicPlayer';
import { getDownloadedSongs, toggleDownload, isSongDownloaded } from '../services/storage';

const MOODS = ['ANXIOUS', 'SAD', 'LONELY', 'STRESSED', 'OVERWHELMED', 'HOPEFUL', 'GRATEFUL', 'ANGRY', 'CONFUSED', 'JOYFUL', 'PEACEFUL'];
const GENRES = [
  'R&B Gospel',
  'Contemporary Gospel',
  'Traditional Gospel',
  'Worship / Praise',
  'Country Gospel',
  'Pop Gospel',
  'Urban Gospel',
  'Choir Gospel'
];

export default function MusicScreen() {
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showDownloadsOnly, setShowDownloadsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [filteredSongs, setFilteredSongs] = useState<Song[]>(WORSHIP_SONGS);
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);

  useEffect(() => {
    setDownloadedIds(getDownloadedSongs());
  }, []);

  useEffect(() => {
    let filtered = WORSHIP_SONGS;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.title.toLowerCase().includes(query) || 
        s.artist.toLowerCase().includes(query) ||
        s.genre.toLowerCase().includes(query) ||
        s.moods.some(m => m.toLowerCase().includes(query)) ||
        s.searchableKeywords.some(k => k.toLowerCase().includes(query))
      );
    }

    if (showDownloadsOnly) {
      filtered = filtered.filter(s => downloadedIds.includes(s.id));
    }
    if (selectedMood) {
      filtered = filtered.filter(s => s.moods.includes(selectedMood));
    }
    if (selectedGenres.length > 0) {
      filtered = filtered.filter(s => selectedGenres.includes(s.genre));
    }
    setFilteredSongs(filtered);
  }, [selectedMood, selectedGenres, showDownloadsOnly, downloadedIds, searchQuery]);

  const handlePlaySong = (song: Song) => {
    if (currentSong?.id === song.id && isPlayerReady) return;
    
    setIsPlayerReady(false);
    setPlayerError(null);
    setCurrentSong(song);
  };

  const handleGenreToggle = (genre: string) => {
    setSelectedGenres(prev => 
      prev.includes(genre) 
        ? prev.filter(g => g !== genre) 
        : [...prev, genre]
    );
  };

  const handleDownload = (songId: string) => {
    toggleDownload(songId);
    setDownloadedIds(getDownloadedSongs());
  };

  const handleNext = () => {
    if (!currentSong) return;
    const currentIndex = filteredSongs.findIndex(s => s.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % filteredSongs.length;
    setCurrentSong(filteredSongs[nextIndex]);
  };

  const handlePrev = () => {
    if (!currentSong) return;
    const currentIndex = filteredSongs.findIndex(s => s.id === currentSong.id);
    const prevIndex = (currentIndex - 1 + filteredSongs.length) % filteredSongs.length;
    setCurrentSong(filteredSongs[prevIndex]);
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Music color="#d4af37" size={32} />
          <Text style={styles.title}>Gospel Music</Text>
          <Text style={styles.subtitle}>Modern sounds for the soul</Text>
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <Search size={18} color="rgba(212, 175, 55, 0.6)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by title, artist, genre, or mood..."
              placeholderTextColor="rgba(212, 175, 55, 0.4)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <X size={18} color="rgba(212, 175, 55, 0.6)" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {(selectedMood || selectedGenres.length > 0 || searchQuery || showDownloadsOnly) && (
          <View style={styles.activeFiltersContainer}>
            <Text style={styles.activeFiltersLabel}>ACTIVE FILTERS:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activeFiltersScroll}>
              <AnimatePresence>
                {searchQuery && (
                  <MotionView 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    style={styles.filterTag}
                  >
                    <Search size={10} color="#0b1e3d" />
                    <Text style={styles.filterTagText}>"{searchQuery}"</Text>
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                      <X size={10} color="#0b1e3d" />
                    </TouchableOpacity>
                  </MotionView>
                )}
                {selectedGenres.map(genre => (
                  <MotionView 
                    key={`filter-${genre}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    style={styles.filterTag}
                  >
                    <Filter size={10} color="#0b1e3d" />
                    <Text style={styles.filterTagText}>{genre}</Text>
                    <TouchableOpacity onPress={() => handleGenreToggle(genre)}>
                      <X size={10} color="#0b1e3d" />
                    </TouchableOpacity>
                  </MotionView>
                ))}
                {selectedMood && (
                  <MotionView 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    style={styles.filterTag}
                  >
                    <Tag size={10} color="#0b1e3d" />
                    <Text style={styles.filterTagText}>{selectedMood}</Text>
                    <TouchableOpacity onPress={() => setSelectedMood(null)}>
                      <X size={10} color="#0b1e3d" />
                    </TouchableOpacity>
                  </MotionView>
                )}
                {showDownloadsOnly && (
                  <MotionView 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    style={styles.filterTag}
                  >
                    <Download size={10} color="#0b1e3d" />
                    <Text style={styles.filterTagText}>Downloads</Text>
                    <TouchableOpacity onPress={() => setShowDownloadsOnly(false)}>
                      <X size={10} color="#0b1e3d" />
                    </TouchableOpacity>
                  </MotionView>
                )}
              </AnimatePresence>
            </ScrollView>
          </View>
        )}

        <View style={styles.moodSection}>
          <Text style={styles.sectionLabel}>BROWSE BY GENRE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moodScroll}>
            <TouchableOpacity 
              style={[styles.moodChip, selectedGenres.length === 0 && styles.moodChipActive]}
              onPress={() => setSelectedGenres([])}
            >
              <Text style={[styles.moodChipText, selectedGenres.length === 0 && styles.moodChipTextActive]}>ALL GENRES</Text>
            </TouchableOpacity>
            {GENRES.map(genre => (
              <TouchableOpacity 
                key={genre}
                style={[styles.moodChip, selectedGenres.includes(genre) && styles.moodChipActive]}
                onPress={() => handleGenreToggle(genre)}
              >
                <Text style={[styles.moodChipText, selectedGenres.includes(genre) && styles.moodChipTextActive]}>{genre.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.moodSection}>
          <Text style={styles.sectionLabel}>BROWSE BY MOOD</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.moodScroll}>
            <TouchableOpacity 
              style={[styles.moodChip, !selectedMood && styles.moodChipActive]}
              onPress={() => setSelectedMood(null)}
            >
              <Text style={[styles.moodChipText, !selectedMood && styles.moodChipTextActive]}>ALL</Text>
            </TouchableOpacity>
            {MOODS.map(mood => (
              <TouchableOpacity 
                key={mood}
                style={[styles.moodChip, selectedMood === mood && styles.moodChipActive]}
                onPress={() => setSelectedMood(mood)}
              >
                <Text style={[styles.moodChipText, selectedMood === mood && styles.moodChipTextActive]}>{mood}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.moodSection}>
          <Text style={styles.sectionLabel}>LIBRARY</Text>
          <TouchableOpacity 
            style={[styles.moodChip, showDownloadsOnly && styles.moodChipActive]}
            onPress={() => setShowDownloadsOnly(!showDownloadsOnly)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Download size={12} color={showDownloadsOnly ? '#0b1e3d' : '#d4af37'} />
              <Text style={[styles.moodChipText, showDownloadsOnly && styles.moodChipTextActive]}>DOWNLOADS ({downloadedIds.length})</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.songList}>
          <Text style={styles.sectionLabel}>
            {showDownloadsOnly 
              ? 'MY DOWNLOADED SONGS' 
              : (selectedMood || selectedGenres.length > 0 
                ? `${selectedGenres.join(', ') || ''} ${selectedMood || ''} GOSPEL`.trim() 
                : 'RECOMMENDED FOR YOU')}
          </Text>
          {filteredSongs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No songs found in this category.</Text>
            </View>
          ) : (
            filteredSongs.map((song, index) => (
              <MotionView
                key={song.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <TouchableOpacity 
                  style={[
                    styles.songItem, 
                    currentSong?.id === song.id && styles.songItemActive,
                    song.isAvailable === false && styles.songItemDisabled
                  ]}
                  onPress={() => song.isAvailable !== false && handlePlaySong(song)}
                  disabled={song.isAvailable === false}
                >
                  <Image source={{ uri: song.coverUrl }} style={[styles.songCover, song.isAvailable === false && { opacity: 0.5 }]} />
                  <View style={styles.songDetails}>
                    <Text style={[styles.songTitle, song.isAvailable === false && { color: 'rgba(255, 255, 255, 0.4)' }]}>
                      {song.title}
                    </Text>
                    <Text style={styles.songArtist}>{song.artist}</Text>
                    {song.isAvailable === false && (
                      <Text style={styles.unavailableBadge}>COMING SOON</Text>
                    )}
                  </View>
                  
                  <View style={styles.songActions}>
                    {song.isAvailable !== false && (
                      <TouchableOpacity 
                        style={styles.downloadButton}
                        onPress={() => handleDownload(song.id)}
                      >
                        {downloadedIds.includes(song.id) ? (
                           <CheckCircle2 size={18} color="#d4af37" />
                        ) : (
                          <Download size={18} color="rgba(212, 175, 55, 0.4)" />
                        )}
                      </TouchableOpacity>
                    )}
                    
                    <TouchableOpacity 
                      style={[
                        styles.playIconButton, 
                        song.isAvailable === false && { backgroundColor: 'transparent' }
                      ]}
                      disabled={song.isAvailable === false}
                    >
                      {song.isAvailable === false ? (
                        <X size={16} color="rgba(212, 175, 55, 0.2)" />
                      ) : (
                        <Play size={16} color={currentSong?.id === song.id ? '#0b1e3d' : '#d4af37'} fill={currentSong?.id === song.id ? '#0b1e3d' : 'transparent'} />
                      )}
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </MotionView>
            ))
          )}
        </View>
      </ScrollView>

      {currentSong && (
        <View style={styles.playerWrapper}>
          {!isPlayerReady && !playerError && (
            <View style={styles.validatingContainer}>
              <ActivityIndicator color="#d4af37" size="small" />
              <Text style={styles.validatingText}>Validating audio source...</Text>
            </View>
          )}
          
          {playerError && (
            <View style={styles.playerErrorContainer}>
              <View style={styles.playerErrorInfo}>
                <Text style={styles.playerErrorTitle}>{currentSong.title}</Text>
                <Text style={styles.playerErrorText}>{playerError}</Text>
              </View>
              <TouchableOpacity onPress={() => setCurrentSong(null)} style={styles.closeErrorButton}>
                <X size={20} color="#ff4444" />
              </TouchableOpacity>
            </View>
          )}

          <View style={{ display: isPlayerReady ? 'flex' : 'none' }}>
            <MusicPlayer 
              song={currentSong} 
              onNext={handleNext}
              onPrev={handlePrev}
              onReady={() => setIsPlayerReady(true)}
              onError={(err) => {
                setPlayerError(err);
                setIsPlayerReady(false);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 150, // Space for player
    maxWidth: 1000,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  searchSection: {
    paddingHorizontal: 20,
    marginBottom: 25,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 42, 82, 0.4)',
    borderRadius: 20,
    paddingHorizontal: 15,
    height: 45,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'Playfair Display',
  },
  activeFiltersContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  activeFiltersLabel: {
    color: '#d4af37',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 8,
    opacity: 0.5,
  },
  activeFiltersScroll: {
    flexDirection: 'row',
  },
  filterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d4af37',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginRight: 8,
    gap: 6,
  },
  filterTagText: {
    color: '#0b1e3d',
    fontSize: 10,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 28,
    color: '#d4af37',
    fontFamily: 'Playfair Display',
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 12,
    color: '#f5d77a',
    marginTop: 4,
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.8,
  },
  moodSection: {
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  sectionLabel: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 15,
    opacity: 0.6,
  },
  moodScroll: {
    flexDirection: 'row',
  },
  moodChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    marginRight: 10,
    alignSelf: 'flex-start',
  },
  moodChipActive: {
    backgroundColor: '#d4af37',
    borderColor: '#d4af37',
  },
  moodChipText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  moodChipTextActive: {
    color: '#0b1e3d',
  },
  songList: {
    paddingHorizontal: 20,
    marginTop: 10,
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 42, 82, 0.4)',
    padding: 12,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.1)',
  },
  songItemActive: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderColor: 'rgba(212, 175, 55, 0.4)',
  },
  songItemDisabled: {
    opacity: 0.7,
    backgroundColor: 'rgba(15, 42, 82, 0.2)',
  },
  songCover: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
  songDetails: {
    flex: 1,
    marginLeft: 15,
  },
  songTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'Playfair Display',
  },
  songArtist: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  unavailableBadge: {
    color: '#d4af37',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginTop: 4,
    opacity: 0.6,
  },
  songActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  downloadButton: {
    padding: 4,
  },
  playIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerWrapper: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    zIndex: 100,
  },
  validatingContainer: {
    backgroundColor: 'rgba(15, 42, 82, 0.9)',
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  validatingText: {
    color: '#d4af37',
    fontSize: 14,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
  },
  playerErrorContainer: {
    backgroundColor: 'rgba(15, 42, 82, 0.95)',
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.4)',
  },
  playerErrorInfo: {
    flex: 1,
  },
  playerErrorTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Playfair Display',
  },
  playerErrorText: {
    color: '#ff4444',
    fontSize: 12,
    marginTop: 4,
    fontWeight: 'bold',
  },
  closeErrorButton: {
    padding: 8,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: 12,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 14,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
  }
});

