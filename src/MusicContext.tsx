import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Song, WORSHIP_SONGS } from './constants/songs';

interface MusicContextType {
  currentSong: Song | null;
  isPlaying: boolean;
  playbackError: string | null;
  playSong: (song: Song) => void;
  pauseSong: () => void;
  resumeSong: () => void;
  stopSong: () => void;
  nextSong: () => void;
  prevSong: () => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackError: (error: string | null) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

export const MusicProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const playSong = (song: Song) => {
    if (song.isAvailable === false) {
      setPlaybackError("This song is coming soon!");
      return;
    }
    setPlaybackError(null);
    setCurrentSong(song);
    setIsPlaying(true);
  };

  const pauseSong = () => {
    setIsPlaying(false);
  };

  const resumeSong = () => {
    if (currentSong) {
      setIsPlaying(true);
    }
  };

  const stopSong = () => {
    setCurrentSong(null);
    setIsPlaying(false);
    setPlaybackError(null);
  };

  const nextSong = () => {
    if (!currentSong) return;
    setPlaybackError(null);
    const currentIndex = WORSHIP_SONGS.findIndex(s => s.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % WORSHIP_SONGS.length;
    setCurrentSong(WORSHIP_SONGS[nextIndex]);
    setIsPlaying(true);
  };

  const prevSong = () => {
    if (!currentSong) return;
    setPlaybackError(null);
    const currentIndex = WORSHIP_SONGS.findIndex(s => s.id === currentSong.id);
    const prevIndex = (currentIndex - 1 + WORSHIP_SONGS.length) % WORSHIP_SONGS.length;
    setCurrentSong(WORSHIP_SONGS[prevIndex]);
    setIsPlaying(true);
  };

  return (
    <MusicContext.Provider value={{ 
      currentSong, 
      isPlaying, 
      playbackError,
      playSong, 
      pauseSong, 
      resumeSong, 
      stopSong, 
      nextSong, 
      prevSong,
      setIsPlaying,
      setPlaybackError
    }}>
      {children}
    </MusicContext.Provider>
  );
};

export const useMusic = () => {
  const context = useContext(MusicContext);
  if (context === undefined) {
    throw new Error('useMusic must be used within a MusicProvider');
  }
  return context;
};
