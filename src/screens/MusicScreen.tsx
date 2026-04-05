import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Music, Play, Pause, Heart, ChevronRight, Download, CheckCircle2, Search, X, Filter, Tag, Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WORSHIP_SONGS, Song } from '../constants/songs';
import { openYouTubeSearch } from '../utils/music';

const MotionView = motion(View);
import { MusicPlayer } from '../components/MusicPlayer';
import { getDownloadedSongs, toggleDownload, isSongDownloaded } from '../services/storage';
import { useMusic } from '../MusicContext';

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
  const { currentSong, isPlaying, playSong, pauseSong, resumeSong, stopSong, playbackError, setPlaybackError } = useMusic();
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  useEffect(() => {
    if (playbackError) {
      Alert.alert(
        "Playback Error",
        "I found the song, but playback did not start. Let me try another way.",
        [{ text: "OK", onPress: () => setPlaybackError(null) }]
      );
    }
  }, [playbackError]);
  const [showDownloadsOnly, setShowDownloadsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredSongs, setFilteredSongs] = useState<Song[]>(WORSHIP_SONGS);
  const [downloadedIds, setDownloadedIds] = useState<string[]>([]);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

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
    if (selectedMoods.length > 0) {
      filtered = filtered.filter(s => s.moods.some(m => selectedMoods.includes(m)));
    }
    if (selectedGenres.length > 0) {
      filtered = filtered.filter(s => selectedGenres.includes(s.genre));
    }
    setFilteredSongs(filtered);
  }, [selectedMoods, selectedGenres, showDownloadsOnly, downloadedIds, searchQuery]);

  const handlePlaySong = (song: Song) => {
    if (song.isAvailable === false) {
      Alert.alert(
        "Coming Soon",
        `"${song.title}" by ${song.artist} is not available in our library yet. Would you like to search for it on YouTube?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Search YouTube", onPress: () => openYouTubeSearch(`${song.title} ${song.artist}`) }
        ]
      );
      return;
    }
    if (currentSong?.id === song.id) {
      if (isPlaying) {
        pauseSong();
      } else {
        resumeSong();
      }
      return;
    }
    playSong(song);
  };

  const handleMoodToggle = (mood: string) => {
    setSelectedMoods(prev => 
      prev.includes(mood) 
        ? prev.filter(m => m !== mood) 
        : [...prev, mood]
    );
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
    playSong(filteredSongs[nextIndex]);
  };

  const handlePrev = () => {
    if (!currentSong) return;
    const currentIndex = filteredSongs.findIndex(s => s.id === currentSong.id);
    const prevIndex = (currentIndex - 1 + filteredSongs.length) % filteredSongs.length;
    playSong(filteredSongs[prevIndex]);
  };

  const clearAllFilters = () => {
    setSelectedMoods([]);
    setSelectedGenres([]);
    setShowDownloadsOnly(false);
    setSearchQuery('');
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
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Search size={18} color="rgba(212, 175, 55, 0.6)" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search songs..."
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
            <TouchableOpacity 
              style={[styles.filterToggleButton, isFilterPanelOpen && styles.filterToggleButtonActive]}
              onPress={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
            >
              <Filter size={20} color={isFilterPanelOpen ? '#0b1e3d' : '#d4af37'} />
              {(selectedMoods.length > 0 || selectedGenres.length > 0 || showDownloadsOnly) && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>
                    {selectedMoods.length + selectedGenres.length + (showDownloadsOnly ? 1 : 0)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <AnimatePresence>
          {isFilterPanelOpen && (
            <MotionView
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              style={styles.filterPanel}
            >
              <View style={styles.filterPanelHeader}>
                <Text style={styles.filterPanelTitle}>Refine Music</Text>
                <TouchableOpacity onPress={clearAllFilters} style={styles.clearAllButton}>
                  <Trash2 size={14} color="#ff4444" />
                  <Text style={styles.clearAllText}>Clear All</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>GENRES</Text>
                <View style={styles.chipGrid}>
                  {GENRES.map(genre => (
                    <TouchableOpacity 
                      key={genre}
                      style={[styles.selectableChip, selectedGenres.includes(genre) && styles.selectableChipActive]}
                      onPress={() => handleGenreToggle(genre)}
                    >
                      {selectedGenres.includes(genre) && <Check size={12} color="#0b1e3d" style={{ marginRight: 4 }} />}
                      <Text style={[styles.selectableChipText, selectedGenres.includes(genre) && styles.selectableChipTextActive]}>
                        {genre}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>MOODS</Text>
                <View style={styles.chipGrid}>
                  {MOODS.map(mood => (
                    <TouchableOpacity 
                      key={mood}
                      style={[styles.selectableChip, selectedMoods.includes(mood) && styles.selectableChipActive]}
                      onPress={() => handleMoodToggle(mood)}
                    >
                      {selectedMoods.includes(mood) && <Check size={12} color="#0b1e3d" style={{ marginRight: 4 }} />}
                      <Text style={[styles.selectableChipText, selectedMoods.includes(mood) && styles.selectableChipTextActive]}>
                        {mood}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>LIBRARY</Text>
                <TouchableOpacity 
                  style={[styles.selectableChip, showDownloadsOnly && styles.selectableChipActive]}
                  onPress={() => setShowDownloadsOnly(!showDownloadsOnly)}
                >
                  <Download size={12} color={showDownloadsOnly ? '#0b1e3d' : '#d4af37'} style={{ marginRight: 4 }} />
                  <Text style={[styles.selectableChipText, showDownloadsOnly && styles.selectableChipTextActive]}>
                    DOWNLOADS ONLY ({downloadedIds.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </MotionView>
          )}
        </AnimatePresence>

        {(selectedMoods.length > 0 || selectedGenres.length > 0 || searchQuery || showDownloadsOnly) && (
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
                    key={`filter-genre-${genre}`}
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
                {selectedMoods.map(mood => (
                  <MotionView 
                    key={`filter-mood-${mood}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    style={styles.filterTag}
                  >
                    <Tag size={10} color="#0b1e3d" />
                    <Text style={styles.filterTagText}>{mood}</Text>
                    <TouchableOpacity onPress={() => handleMoodToggle(mood)}>
                      <X size={10} color="#0b1e3d" />
                    </TouchableOpacity>
                  </MotionView>
                ))}
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

        <View style={styles.songList}>
          <Text style={styles.sectionLabel}>
            {showDownloadsOnly 
              ? 'MY DOWNLOADED SONGS' 
              : (selectedMoods.length > 0 || selectedGenres.length > 0 
                ? `${selectedGenres.join(', ') || ''} ${selectedMoods.join(', ') || ''} GOSPEL`.trim() 
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
                  onPress={() => handlePlaySong(song)}
                >
                  <Image source={{ uri: song.coverUrl }} style={[styles.songCover, song.isAvailable === false && { opacity: 0.5 }]} />
                  <View style={styles.songDetails}>
                    <Text style={[styles.songTitle, song.isAvailable === false && { color: 'rgba(255, 255, 255, 0.4)' }]}>
                      {song.title}
                    </Text>
                    <Text style={styles.songArtist}>{song.artist}</Text>
                    {song.isAvailable === false && (
                      <View style={styles.comingSoonBadge}>
                        <Tag size={10} color="#d4af37" />
                        <Text style={styles.comingSoonText}>COMING SOON</Text>
                      </View>
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
                    <View 
                      style={[
                        styles.playIconButton, 
                        song.isAvailable === false && { backgroundColor: 'transparent' }
                      ]}
                    >
                      {song.isAvailable === false ? (
                        <X size={16} color="rgba(212, 175, 55, 0.2)" />
                      ) : (
                        currentSong?.id === song.id && isPlaying ? (
                          <Pause size={16} color="#0b1e3d" fill="#0b1e3d" />
                        ) : (
                          <Play size={16} color={currentSong?.id === song.id ? '#0b1e3d' : '#d4af37'} fill={currentSong?.id === song.id ? '#0b1e3d' : 'transparent'} />
                        )
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              </MotionView>
            ))
          )}
        </View>
      </ScrollView>

      {currentSong && (
        <View style={styles.playerWrapper}>
          {/* Global player in App.tsx handles the actual playback */}
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
    marginBottom: 15,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchBar: {
    flex: 1,
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
  filterToggleButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: 'rgba(15, 42, 82, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  filterToggleButtonActive: {
    backgroundColor: '#d4af37',
    borderColor: '#d4af37',
  },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#ff4444',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0b1e3d',
  },
  filterBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  filterPanel: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(15, 42, 82, 0.6)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    overflow: 'hidden',
  },
  filterPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  filterPanelTitle: {
    color: '#d4af37',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Playfair Display',
  },
  clearAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearAllText: {
    color: '#ff4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  filterSection: {
    marginBottom: 20,
  },
  filterLabel: {
    color: 'rgba(212, 175, 55, 0.6)',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  selectableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: 'rgba(212, 175, 55, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  selectableChipActive: {
    backgroundColor: '#d4af37',
    borderColor: '#d4af37',
  },
  selectableChipText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
  },
  selectableChipTextActive: {
    color: '#0b1e3d',
  },
  activeFiltersContainer: {
    paddingHorizontal: 20,
    marginBottom: 15,
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
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  comingSoonText: {
    color: '#d4af37',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1,
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

