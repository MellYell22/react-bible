export interface Song {
  id: string;
  title: string;
  artist: string;
  url: string;
  moods: string[];
  genre: string;
  coverUrl: string;
  searchableKeywords: string[];
}

export const WORSHIP_SONGS: Song[] = [
  // R&B Gospel
  {
    id: 'rb1',
    title: 'Love Theory',
    artist: 'Kirk Franklin',
    url: 'https://cdn.pixabay.com/audio/2022/10/14/audio_9939716c1d.mp3',
    moods: ['GRATEFUL', 'HOPEFUL', 'JOYFUL'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/lovetheory/300/300',
    searchableKeywords: ['kirk franklin', 'love theory', 'joy', 'upbeat', 'r&b']
  },
  {
    id: 'rb2',
    title: 'Take Me to the King',
    artist: 'Tamela Mann',
    url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3',
    moods: ['OVERWHELMED', 'SAD', 'STRESSED'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/king/300/300',
    searchableKeywords: ['tamela mann', 'king', 'heavy', 'surrender', 'r&b']
  },
  {
    id: 'rb3',
    title: 'Cycles',
    artist: 'Jonathan McReynolds',
    url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73084.mp3',
    moods: ['ANXIOUS', 'SAD', 'STRESSED'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/cycles/300/300',
    searchableKeywords: ['jonathan mcreynolds', 'cycles', 'breaking', 'peace', 'r&b']
  },
  {
    id: 'rb4',
    title: 'Shackles (Praise You)',
    artist: 'Mary Mary',
    url: 'https://cdn.pixabay.com/audio/2022/08/04/audio_2d6108473c.mp3',
    moods: ['GRATEFUL', 'JOYFUL', 'HOPEFUL'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/shackles/300/300',
    searchableKeywords: ['mary mary', 'shackles', 'praise', 'freedom', 'r&b']
  },

  // Contemporary Gospel
  {
    id: 'cont1',
    title: 'Jireh',
    artist: 'Maverick City Music',
    url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3', 
    moods: ['HOPEFUL', 'GRATEFUL', 'OVERWHELMED', 'PEACEFUL'],
    genre: 'Contemporary Gospel',
    coverUrl: 'https://picsum.photos/seed/jireh/300/300',
    searchableKeywords: ['maverick city', 'jireh', 'enough', 'provision', 'contemporary']
  },
  {
    id: 'cont2',
    title: 'Break Every Chain',
    artist: 'Tasha Cobbs Leonard',
    url: 'https://cdn.pixabay.com/audio/2022/01/26/audio_d0c6b1330d.mp3',
    moods: ['HOPEFUL', 'OVERWHELMED', 'ANGRY'],
    genre: 'Contemporary Gospel',
    coverUrl: 'https://picsum.photos/seed/chain/300/300',
    searchableKeywords: ['tasha cobbs', 'break', 'chain', 'power', 'contemporary']
  },
  {
    id: 'cont3',
    title: 'Intentional',
    artist: 'Travis Greene',
    url: 'https://cdn.pixabay.com/audio/2022/03/15/audio_783ed5a0f0.mp3',
    moods: ['HOPEFUL', 'CONFUSED', 'STRESSED'],
    genre: 'Contemporary Gospel',
    coverUrl: 'https://picsum.photos/seed/intentional/300/300',
    searchableKeywords: ['travis greene', 'intentional', 'working', 'trust', 'contemporary']
  },

  // Traditional Gospel
  {
    id: 'trad1',
    title: 'Amazing Grace',
    artist: 'Mahalia Jackson',
    url: 'https://cdn.pixabay.com/audio/2021/11/25/audio_91b32e02f9.mp3',
    moods: ['PEACEFUL', 'GRATEFUL', 'SAD'],
    genre: 'Traditional Gospel',
    coverUrl: 'https://picsum.photos/seed/grace/300/300',
    searchableKeywords: ['mahalia jackson', 'amazing grace', 'hymn', 'classic', 'traditional']
  },
  {
    id: 'trad2',
    title: 'Oh Happy Day',
    artist: 'Edwin Hawkins Singers',
    url: 'https://cdn.pixabay.com/audio/2022/05/17/audio_1997aed91f.mp3',
    moods: ['JOYFUL', 'GRATEFUL'],
    genre: 'Traditional Gospel',
    coverUrl: 'https://picsum.photos/seed/happyday/300/300',
    searchableKeywords: ['edwin hawkins', 'happy day', 'classic', 'traditional']
  },

  // Worship / Praise
  {
    id: 'wp1',
    title: 'Believe For It',
    artist: 'CeCe Winans',
    url: 'https://cdn.pixabay.com/audio/2022/03/15/audio_783ed5a0f0.mp3',
    moods: ['HOPEFUL', 'ANXIOUS', 'OVERWHELMED'],
    genre: 'Worship / Praise',
    coverUrl: 'https://picsum.photos/seed/believe/300/300',
    searchableKeywords: ['cece winans', 'believe', 'miracle', 'worship']
  },
  {
    id: 'wp2',
    title: 'Goodness of God',
    artist: 'CeCe Winans',
    url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a73084.mp3',
    moods: ['GRATEFUL', 'HOPEFUL', 'PEACEFUL'],
    genre: 'Worship / Praise',
    coverUrl: 'https://picsum.photos/seed/goodness/300/300',
    searchableKeywords: ['cece winans', 'goodness', 'faithful', 'worship']
  },
  {
    id: 'wp3',
    title: 'Way Maker',
    artist: 'Sinach',
    url: 'https://cdn.pixabay.com/audio/2022/08/04/audio_2d6108473c.mp3',
    moods: ['CONFUSED', 'LONELY', 'HOPEFUL', 'PEACEFUL'],
    genre: 'Worship / Praise',
    coverUrl: 'https://picsum.photos/seed/waymaker/300/300',
    searchableKeywords: ['sinach', 'way maker', 'miracle worker', 'worship']
  },

  // Country Gospel
  {
    id: 'cg1',
    title: 'Something in the Water',
    artist: 'Carrie Underwood',
    url: 'https://cdn.pixabay.com/audio/2021/11/25/audio_91b32e02f9.mp3',
    moods: ['HOPEFUL', 'GRATEFUL', 'JOYFUL'],
    genre: 'Country Gospel',
    coverUrl: 'https://picsum.photos/seed/water/300/300',
    searchableKeywords: ['carrie underwood', 'water', 'baptism', 'country']
  },
  {
    id: 'cg2',
    title: 'Old Church Choir',
    artist: 'Zach Williams',
    url: 'https://cdn.pixabay.com/audio/2022/08/04/audio_2d6108473c.mp3',
    moods: ['GRATEFUL', 'HOPEFUL', 'JOYFUL'],
    genre: 'Country Gospel',
    coverUrl: 'https://picsum.photos/seed/choir/300/300',
    searchableKeywords: ['zach williams', 'choir', 'joy', 'country']
  },

  // Pop Gospel
  {
    id: 'pg1',
    title: 'You Say',
    artist: 'Lauren Daigle',
    url: 'https://cdn.pixabay.com/audio/2021/08/09/audio_8816222b4d.mp3',
    moods: ['LONELY', 'ANXIOUS', 'CONFUSED'],
    genre: 'Pop Gospel',
    coverUrl: 'https://picsum.photos/seed/yousay/300/300',
    searchableKeywords: ['lauren daigle', 'you say', 'identity', 'pop']
  },
  {
    id: 'pg2',
    title: 'Rescue',
    artist: 'Lauren Daigle',
    url: 'https://cdn.pixabay.com/audio/2022/05/17/audio_1997aed91f.mp3',
    moods: ['LONELY', 'SAD', 'OVERWHELMED'],
    genre: 'Pop Gospel',
    coverUrl: 'https://picsum.photos/seed/rescue/300/300',
    searchableKeywords: ['lauren daigle', 'rescue', 'help', 'pop']
  },

  // Urban Gospel
  {
    id: 'ug1',
    title: 'I\'ll Find You',
    artist: 'Lecrae ft. Tori Kelly',
    url: 'https://cdn.pixabay.com/audio/2022/01/26/audio_d0c6b1330d.mp3',
    moods: ['HOPEFUL', 'SAD', 'ANXIOUS'],
    genre: 'Urban Gospel',
    coverUrl: 'https://picsum.photos/seed/findyou/300/300',
    searchableKeywords: ['lecrae', 'tori kelly', 'find you', 'hope', 'urban', 'rap']
  },
  {
    id: 'ug2',
    title: 'Blessings',
    artist: 'Lecrae',
    url: 'https://cdn.pixabay.com/audio/2022/03/15/audio_783ed5a0f0.mp3',
    moods: ['GRATEFUL', 'JOYFUL'],
    genre: 'Urban Gospel',
    coverUrl: 'https://picsum.photos/seed/blessings/300/300',
    searchableKeywords: ['lecrae', 'blessings', 'gratitude', 'urban', 'rap']
  },

  // Choir Gospel
  {
    id: 'ch1',
    title: 'Every Praise',
    artist: 'Hezekiah Walker',
    url: 'https://cdn.pixabay.com/audio/2022/05/17/audio_1997aed91f.mp3',
    moods: ['JOYFUL', 'GRATEFUL', 'HOPEFUL'],
    genre: 'Choir Gospel',
    coverUrl: 'https://picsum.photos/seed/everypraise/300/300',
    searchableKeywords: ['hezekiah walker', 'every praise', 'choir', 'unity']
  },
  {
    id: 'ch2',
    title: 'Total Praise',
    artist: 'Richard Smallwood',
    url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3',
    moods: ['PEACEFUL', 'OVERWHELMED', 'GRATEFUL'],
    genre: 'Choir Gospel',
    coverUrl: 'https://picsum.photos/seed/totalpraise/300/300',
    searchableKeywords: ['richard smallwood', 'total praise', 'choir', 'classic']
  }
];
