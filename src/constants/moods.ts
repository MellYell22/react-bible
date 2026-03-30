export interface Scripture {
  reference: string;
  verse: string;
}

export interface MoodData {
  key: string;
  label: string;
  scriptures: Scripture[];
}

export const MOODS_DATA: MoodData[] = [
  {
    key: 'ANXIOUS',
    label: 'Anxious',
    scriptures: [
      { reference: 'Philippians 4:6-7', verse: 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.' },
      { reference: '1 Peter 5:7', verse: 'Cast all your anxiety on him because he cares for you.' },
      { reference: 'Matthew 6:34', verse: 'Therefore do not worry about tomorrow, for tomorrow will worry about itself. Each day has enough trouble of its own.' },
      { reference: 'Psalm 94:19', verse: 'When anxiety was great within me, your consolation brought me joy.' },
      { reference: 'Isaiah 41:10', verse: 'So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.' }
    ]
  },
  {
    key: 'SAD',
    label: 'Sad',
    scriptures: [
      { reference: 'Psalm 34:18', verse: 'The Lord is close to the brokenhearted and saves those who are crushed in spirit.' },
      { reference: 'Matthew 5:4', verse: 'Blessed are those who mourn, for they will be comforted.' },
      { reference: 'Psalm 147:3', verse: 'He heals the brokenhearted and binds up their wounds.' },
      { reference: 'Revelation 21:4', verse: 'He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.' },
      { reference: 'John 16:22', verse: 'So with you: Now is your time of grief, but I will see you again and you will rejoice, and no one will take away your joy.' }
    ]
  },
  {
    key: 'LONELY',
    label: 'Lonely',
    scriptures: [
      { reference: 'Deuteronomy 31:6', verse: 'Be strong and courageous. Do not be afraid or terrified because of them, for the Lord your God goes with you; he will never leave you nor forsake you.' },
      { reference: 'Psalm 25:16', verse: 'Turn to me and be gracious to me, for I am lonely and afflicted.' },
      { reference: 'Matthew 28:20', verse: 'And surely I am with you always, to the very end of the age.' },
      { reference: 'Psalm 68:6', verse: 'God sets the lonely in families, he leads out the prisoners with singing; but the rebellious live in a sun-scorched land.' },
      { reference: 'Isaiah 43:1', verse: 'But now, this is what the Lord says—he who created you, Jacob, he who formed you, Israel: “Do not fear, for I have redeemed you; I have summoned you by name; you are mine.”' }
    ]
  },
  {
    key: 'STRESSED',
    label: 'Stressed',
    scriptures: [
      { reference: 'Matthew 11:28-30', verse: 'Come to me, all you who are weary and burdened, and I will give you rest. Take my yoke upon you and learn from me, for I am gentle and humble in heart, and you will find rest for your souls. For my yoke is easy and my burden is light.' },
      { reference: 'Psalm 55:22', verse: 'Cast your cares on the Lord and he will sustain you; he will never let the righteous be shaken.' },
      { reference: 'John 14:27', verse: 'Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.' },
      { reference: 'Psalm 46:1', verse: 'God is our refuge and strength, an ever-present help in trouble.' },
      { reference: 'Exodus 14:14', verse: 'The Lord will fight for you; you need only to be still.' }
    ]
  },
  {
    key: 'OVERWHELMED',
    label: 'Overwhelmed',
    scriptures: [
      { reference: 'Psalm 61:2', verse: 'From the ends of the earth I call to you, I call as my heart grows faint; lead me to the rock that is higher than I.' },
      { reference: '2 Corinthians 12:9', verse: 'But he said to me, “My grace is sufficient for you, for my power is made perfect in weakness.” Therefore I will boast all the more gladly about my weaknesses, so that Christ’s power may rest on me.' },
      { reference: 'Psalm 142:3', verse: 'When my spirit grows faint within me, it is you who watch over my way.' },
      { reference: 'Isaiah 40:31', verse: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.' },
      { reference: 'Psalm 18:6', verse: 'In my distress I called to the Lord; I cried to my God for help. From his temple he heard my voice; my cry came before him, into his ears.' }
    ]
  },
  {
    key: 'HOPEFUL',
    label: 'Hopeful',
    scriptures: [
      { reference: 'Jeremiah 29:11', verse: 'For I know the plans I have for you,” declares the Lord, “plans to prosper you and not to harm you, plans to give you hope and a future.' },
      { reference: 'Romans 15:13', verse: 'May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope by the power of the Holy Spirit.' },
      { reference: 'Lamentations 3:22-23', verse: 'Because of the Lord’s great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.' },
      { reference: 'Psalm 130:5', verse: 'I wait for the Lord, my whole being waits, and in his word I put my hope.' },
      { reference: 'Hebrews 11:1', verse: 'Now faith is confidence in what we hope for and assurance about what we do not see.' }
    ]
  },
  {
    key: 'GRATEFUL',
    label: 'Grateful',
    scriptures: [
      { reference: '1 Thessalonians 5:18', verse: 'Give thanks in all circumstances; for this is God’s will for you in Christ Jesus.' },
      { reference: 'Psalm 107:1', verse: 'Give thanks to the Lord, for he is good; his love endures forever.' },
      { reference: 'Colossians 3:17', verse: 'And whatever you do, whether in word or deed, do it all in the name of the Lord Jesus, giving thanks to God the Father through him.' },
      { reference: 'Psalm 100:4', verse: 'Enter his gates with thanksgiving and his courts with praise; give thanks to him and praise his name.' },
      { reference: 'James 1:17', verse: 'Every good and perfect gift is from above, coming down from the Father of the heavenly lights, who does not change like shifting shadows.' }
    ]
  },
  {
    key: 'ANGRY',
    label: 'Angry',
    scriptures: [
      { reference: 'Ephesians 4:26-27', verse: '“In your anger do not sin”: Do not let the sun go down while you are still angry, and do not give the devil a foothold.' },
      { reference: 'James 1:19-20', verse: 'My dear brothers and sisters, take note of this: Everyone should be quick to listen, slow to speak and slow to become angry, because human anger does not produce the righteousness that God desires.' },
      { reference: 'Proverbs 15:1', verse: 'A gentle answer turns away wrath, but a harsh word stirs up anger.' },
      { reference: 'Psalm 37:8', verse: 'Refrain from anger and turn from wrath; do not fret—it leads only to evil.' },
      { reference: 'Proverbs 14:29', verse: 'Whoever is patient has great understanding, but one who is quick-tempered displays folly.' }
    ]
  },
  {
    key: 'CONFUSED',
    label: 'Confused',
    scriptures: [
      { reference: 'Proverbs 3:5-6', verse: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.' },
      { reference: '1 Corinthians 14:33', verse: 'For God is not a God of disorder but of peace—as in all the congregations of the Lord’s people.' },
      { reference: 'James 1:5', verse: 'If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.' },
      { reference: 'Psalm 119:105', verse: 'Your word is a lamp for my feet, a light on my path.' },
      { reference: 'Isaiah 55:8-9', verse: '“For my thoughts are not your thoughts, neither are your ways my ways,” declares the Lord. “As the heavens are higher than the earth, so are my ways higher than your ways and my thoughts than your thoughts.' }
    ]
  },
  {
    key: 'JOYFUL',
    label: 'Joyful',
    scriptures: [
      { reference: 'Psalm 16:11', verse: 'You make known to me the path of life; you will fill me with joy in your presence, with eternal pleasures at your right hand.' },
      { reference: 'Nehemiah 8:10', verse: 'Do not grieve, for the joy of the Lord is your strength.' },
      { reference: 'Romans 15:13', verse: 'May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope by the power of the Holy Spirit.' },
      { reference: 'Psalm 126:5', verse: 'Those who sow with tears will reap with songs of joy.' },
      { reference: 'Habakkuk 3:18', verse: 'Yet I will rejoice in the Lord, I will be joyful in God my Savior.' }
    ]
  },
  {
    key: 'PEACEFUL',
    label: 'Peaceful',
    scriptures: [
      { reference: 'John 14:27', verse: 'Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.' },
      { reference: 'Philippians 4:7', verse: 'And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.' },
      { reference: 'Isaiah 26:3', verse: 'You will keep in perfect peace those whose minds are steadfast, because they trust in you.' },
      { reference: 'Psalm 29:11', verse: 'The Lord gives strength to his people; the Lord blesses his people with peace.' },
      { reference: 'Romans 8:6', verse: 'The mind governed by the flesh is death, but the mind governed by the Spirit is life and peace.' }
    ]
  }
];
