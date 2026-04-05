export interface Song {
  id: string;
  title: string;
  artist: string;
  url: string;
  moods: string[];
  genre: string;
  coverUrl: string;
  searchableKeywords: string[];
  isAvailable?: boolean;
}

export const WORSHIP_SONGS: Song[] = [
  // R&B Gospel
  {
    id: 'rb1',
    title: 'Love Theory',
    artist: 'Kirk Franklin',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    moods: ['GRATEFUL', 'HOPEFUL', 'JOYFUL'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/lovetheory/300/300',
    searchableKeywords: ['kirk franklin', 'love theory', 'joy', 'upbeat', 'r&b'],
    isAvailable: true
  },
  {
    id: 'rb2',
    title: 'Take Me to the King',
    artist: 'Tamela Mann',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    moods: ['OVERWHELMED', 'SAD', 'STRESSED'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/king/300/300',
    searchableKeywords: ['tamela mann', 'king', 'heavy', 'surrender', 'r&b'],
    isAvailable: true
  },
  {
    id: 'rb3',
    title: 'Cycles',
    artist: 'Jonathan McReynolds',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    moods: ['ANXIOUS', 'SAD', 'STRESSED'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/cycles/300/300',
    searchableKeywords: ['jonathan mcreynolds', 'cycles', 'breaking', 'peace', 'r&b'],
    isAvailable: true
  },
  {
    id: 'rb4',
    title: 'Shackles (Praise You)',
    artist: 'Mary Mary',
    url: '',
    moods: ['GRATEFUL', 'JOYFUL', 'HOPEFUL'],
    genre: 'R&B Gospel',
    coverUrl: 'https://picsum.photos/seed/shackles/300/300',
    searchableKeywords: ['mary mary', 'shackles', 'praise', 'freedom', 'r&b'],
    isAvailable: false
  },

  // Contemporary Gospel
  {
    id: 'cont1',
    title: 'Jireh',
    artist: 'Maverick City Music',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    moods: ['HOPEFUL', 'GRATEFUL', 'OVERWHELMED', 'PEACEFUL'],
    genre: 'Contemporary Gospel',
    coverUrl: 'https://picsum.photos/seed/jireh/300/300',
    searchableKeywords: ['maverick city', 'jireh', 'enough', 'provision', 'contemporary'],
    isAvailable: true
  },
  {
    id: 'cont2',
    title: 'Break Every Chain',
    artist: 'Tasha Cobbs Leonard',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    moods: ['HOPEFUL', 'OVERWHELMED', 'ANGRY'],
    genre: 'Contemporary Gospel',
    coverUrl: 'https://picsum.photos/seed/chain/300/300',
    searchableKeywords: ['tasha cobbs', 'break', 'chain', 'power', 'contemporary'],
    isAvailable: true
  },
  {
    id: 'cont3',
    title: 'Intentional',
    artist: 'Travis Greene',
    url: '',
    moods: ['HOPEFUL', 'CONFUSED', 'STRESSED'],
    genre: 'Contemporary Gospel',
    coverUrl: 'https://picsum.photos/seed/intentional/300/300',
    searchableKeywords: ['travis greene', 'intentional', 'working', 'trust', 'contemporary'],
    isAvailable: false
  },

  // Traditional Gospel
  {
    id: 'trad1',
    title: 'Amazing Grace',
    artist: 'Mahalia Jackson',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    moods: ['PEACEFUL', 'GRATEFUL', 'SAD'],
    genre: 'Traditional Gospel',
    coverUrl: 'https://picsum.photos/seed/grace/300/300',
    searchableKeywords: ['mahalia jackson', 'amazing grace', 'hymn', 'classic', 'traditional'],
    isAvailable: true
  },
  {
    id: 'trad2',
    title: 'Oh Happy Day',
    artist: 'Edwin Hawkins Singers',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
    moods: ['JOYFUL', 'GRATEFUL'],
    genre: 'Traditional Gospel',
    coverUrl: 'https://picsum.photos/seed/happyday/300/300',
    searchableKeywords: ['edwin hawkins', 'happy day', 'classic', 'traditional'],
    isAvailable: true
  },

  // Worship / Praise
  {
    id: 'wp1',
    title: 'Believe For It',
    artist: 'CeCe Winans',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    moods: ['HOPEFUL', 'ANXIOUS', 'OVERWHELMED'],
    genre: 'Worship / Praise',
    coverUrl: 'https://picsum.photos/seed/believe/300/300',
    searchableKeywords: ['cece winans', 'believe', 'miracle', 'worship'],
    isAvailable: true
  },
  {
    id: 'wp2',
    title: 'Goodness of God',
    artist: 'CeCe Winans',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
    moods: ['GRATEFUL', 'HOPEFUL', 'PEACEFUL'],
    genre: 'Worship / Praise',
    coverUrl: 'https://picsum.photos/seed/goodness/300/300',
    searchableKeywords: ['cece winans', 'goodness', 'faithful', 'worship'],
    isAvailable: true
  },
  {
    id: 'wp3',
    title: 'Way Maker',
    artist: 'Sinach',
    url: '',
    moods: ['CONFUSED', 'LONELY', 'HOPEFUL', 'PEACEFUL'],
    genre: 'Worship / Praise',
    coverUrl: 'https://picsum.photos/seed/waymaker/300/300',
    searchableKeywords: ['sinach', 'way maker', 'miracle worker', 'worship'],
    isAvailable: false
  },

  // Country Gospel
  {
    id: 'cg1',
    title: 'Something in the Water',
    artist: 'Carrie Underwood',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
    moods: ['HOPEFUL', 'GRATEFUL', 'JOYFUL'],
    genre: 'Country Gospel',
    coverUrl: 'https://picsum.photos/seed/water/300/300',
    searchableKeywords: ['carrie underwood', 'water', 'baptism', 'country'],
    isAvailable: true
  },
  {
    id: 'cg2',
    title: 'Old Church Choir',
    artist: 'Zach Williams',
    url: '',
    moods: ['GRATEFUL', 'HOPEFUL', 'JOYFUL'],
    genre: 'Country Gospel',
    coverUrl: 'https://picsum.photos/seed/choir/300/300',
    searchableKeywords: ['zach williams', 'choir', 'joy', 'country'],
    isAvailable: false
  },

  // Pop Gospel
  {
    id: 'pg1',
    title: 'You Say',
    artist: 'Lauren Daigle',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3',
    moods: ['LONELY', 'ANXIOUS', 'CONFUSED'],
    genre: 'Pop Gospel',
    coverUrl: 'https://picsum.photos/seed/yousay/300/300',
    searchableKeywords: ['lauren daigle', 'you say', 'identity', 'pop'],
    isAvailable: true
  },
  {
    id: 'pg2',
    title: 'Rescue',
    artist: 'Lauren Daigle',
    url: '',
    moods: ['LONELY', 'SAD', 'OVERWHELMED'],
    genre: 'Pop Gospel',
    coverUrl: 'https://picsum.photos/seed/rescue/300/300',
    searchableKeywords: ['lauren daigle', 'rescue', 'help', 'pop'],
    isAvailable: false
  },

  // Urban Gospel
  {
    id: 'ug1',
    title: 'I\'ll Find You',
    artist: 'Lecrae ft. Tori Kelly',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3',
    moods: ['HOPEFUL', 'SAD', 'ANXIOUS'],
    genre: 'Urban Gospel',
    coverUrl: 'https://picsum.photos/seed/findyou/300/300',
    searchableKeywords: ['lecrae', 'tori kelly', 'find you', 'hope', 'urban', 'rap'],
    isAvailable: true
  },
  {
    id: 'ug2',
    title: 'Blessings',
    artist: 'Lecrae',
    url: '',
    moods: ['GRATEFUL', 'JOYFUL'],
    genre: 'Urban Gospel',
    coverUrl: 'https://picsum.photos/seed/blessings/300/300',
    searchableKeywords: ['lecrae', 'blessings', 'gratitude', 'urban', 'rap'],
    isAvailable: false
  },

  // Choir Gospel
  {
    id: 'ch1',
    title: 'Every Praise',
    artist: 'Hezekiah Walker',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3',
    moods: ['JOYFUL', 'GRATEFUL', 'HOPEFUL'],
    genre: 'Choir Gospel',
    coverUrl: 'https://picsum.photos/seed/everypraise/300/300',
    searchableKeywords: ['hezekiah walker', 'every praise', 'choir', 'unity'],
    isAvailable: true
  },
  {
    id: 'ch2',
    title: 'Total Praise',
    artist: 'Richard Smallwood',
    url: '',
    moods: ['PEACEFUL', 'OVERWHELMED', 'GRATEFUL'],
    genre: 'Choir Gospel',
    coverUrl: 'https://picsum.photos/seed/totalpraise/300/300',
    searchableKeywords: ['richard smallwood', 'total praise', 'choir', 'classic'],
    isAvailable: false
  }
];
