import { WORSHIP_SONGS, Song } from '../constants/songs';

export const findSong = (query: string): Song | null => {
  const normalizedQuery = query.toLowerCase().trim();
  
  // Try exact match
  let song = WORSHIP_SONGS.find(s => s.title.toLowerCase() === normalizedQuery);
  if (song) return song;

  // Try partial match in title
  song = WORSHIP_SONGS.find(s => s.title.toLowerCase().includes(normalizedQuery));
  if (song) return song;

  // Try partial match in artist
  song = WORSHIP_SONGS.find(s => s.artist.toLowerCase().includes(normalizedQuery));
  if (song) return song;

  // Try keywords
  song = WORSHIP_SONGS.find(s => s.searchableKeywords.some(k => k.toLowerCase().includes(normalizedQuery)));
  if (song) return song;

  return null;
};

export const extractSongTitle = (text: string): string | null => {
  // David-specific phrases (most specific first)
  const davidPhrases = [
    /I\s+am\s+playing\s+['"]?([^'"]+)['"]?\s+for\s+you\s+now/i,
    /I\s+am\s+putting\s+on\s+['"]?([^'"]+)['"]?\s+for\s+you\s+now/i,
    /I'm\s+playing\s+['"]?([^'"]+)['"]?\s+for\s+you\s+now/i,
    /I'm\s+putting\s+on\s+['"]?([^'"]+)['"]?\s+for\s+you\s+now/i,
    /playing\s+['"]?([^'"]+)['"]?\s+for\s+you\s+now/i,
    /putting\s+on\s+['"]?([^'"]+)['"]?\s+for\s+you\s+now/i
  ];

  for (const phrase of davidPhrases) {
    const match = text.match(phrase);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // Standard play intents (fallback)
  const playIntents = [
    /play\s+['"]?([^'"]+)['"]?/i,
    /listen\s+to\s+['"]?([^'"]+)['"]?/i,
    /put\s+on\s+['"]?([^'"]+)['"]?/i,
    /search\s+for\s+['"]?([^'"]+)['"]?/i,
    /playing\s+['"]?([^'"]+)['"]?/i,
    /putting\s+on\s+['"]?([^'"]+)['"]?/i
  ];
  
  for (const intent of playIntents) {
    const match = text.match(intent);
    if (match && match[1]) {
      // Clean up the extracted title (remove "now", "for you", etc.)
      let title = match[1].trim();
      title = title.replace(/\s+now\.*/i, '');
      title = title.replace(/\s+for\s+you\.*/i, '');
      return title;
    }
  }
  
  return null;
};

export const openYouTubeSearch = (songName: string) => {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(songName)}`;
  if (typeof window !== 'undefined') {
    window.open(url, '_blank');
  }
};
