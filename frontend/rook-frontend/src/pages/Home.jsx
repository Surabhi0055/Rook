import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, apiFetch, dedup } from '../hooks/useBooks'
import { BookModal } from '../components/BookCard'
import BookRow from '../components/BookRow'
import { GenrePage } from './GenrePage'
import { AuthorPage } from './AuthorPage'
import { TrendingPage } from './TrendingPage'
import { ForYouPage } from './ForYouPage'
import { DescribePage } from './DescribePage'
import TopRatedPage, { TopRatedSection } from "./TopRatedPage"
import { YourRatingsPage } from "./YourRatingsPage"
import { useApp } from '../context/AppContext'
import StarRating from "../components/StarRating"
import { cleanImageUrl, fetchGBCover, CoverImg } from '../utils/imageUtils'
 
function olCover(book, size = 'L') {
  const isbn = book.isbn_13 || book.isbn_10 || book.isbn || ''
  if (isbn) {
    const cleaned = String(isbn).replace(/[^0-9Xx]/g, '')
    if (cleaned.length === 10 || cleaned.length === 13)
      return `https://covers.openlibrary.org/b/isbn/${cleaned}-${size}.jpg`
  }
  const olid = book.openlibrary_id || book.ol_id || book.work_id || ''
  if (olid) {
    const prefix = String(olid).startsWith('OL') ? String(olid) : `OL${olid}`
    return `https://covers.openlibrary.org/b/olid/${prefix}-${size}.jpg`
  }
  const coverId = book.cover_id || book.cover_i || ''
  if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`
  return ''
}
 function fixCovers(books) {
  return (books || []).map(b => {
    if (!b) return b
    const existing = cleanImageUrl(b.image_url || '')
    if (existing) return { ...b, image_url: existing }
    const ol = olCover(b)
    if (ol) return { ...b, image_url: ol }
    return b
  })
}
function getServerOrigin() {
  try { return new URL(API_BASE).origin } catch { return API_BASE }
}
function makeAbsoluteImageUrl(raw) {
  if (!raw) return ''
  if (raw.startsWith('http')) return raw
  return `${getServerOrigin()}${raw}`
}

async function resolveBookCoverAsync(book) {
  // 1. Try stored URL first
  const stored = cleanImageUrl(book.image_url || '')
  if (stored) return stored
  // 2. Try OpenLibrary via ISBN
  const ol = olCover(book)
  if (ol) return ol
  // 3. Fetch from Google Books (queued, cached via imageUtils)
  try {
    const gb = await fetchGBCover(book.title || '', book.authors || '')
    if (gb) return gb
  } catch {}
  return ''
}

// Genres rotate every 24h; within the same day the same genre order is used so the carousel feels consistent per day but different each day.
const CAROUSEL_GENRES = [
  'fiction', 'fantasy', 'mystery', 'thriller', 'romance',
  'science fiction', 'biography', 'history', 'horror', 'classics',
  'adventure', 'literary', 'crime', 'young-adult', 'comedy',
]

const CAROUSEL_CACHE_KEY = 'rook_hero_carousel_v2'

function getDayKey() {
  // Changes every 24h — YYYY-MM-DD in UTC
  return new Date().toISOString().slice(0, 10)
}

function loadCarouselCache() {
  try {
    const raw = localStorage.getItem(CAROUSEL_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Invalidate if it's from a different day
    if (parsed.day !== getDayKey()) return null
    return parsed
  } catch { return null }
}

function saveCarouselCache(books, genre) {
  try {
    localStorage.setItem(CAROUSEL_CACHE_KEY, JSON.stringify({
      day: getDayKey(),
      genre,
      books,
    }))
  } catch {}
}

// Pick today's genre deterministically from day string
function getTodayGenre() {
  const day = getDayKey() 
  const seed = day.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  return CAROUSEL_GENRES[seed % CAROUSEL_GENRES.length]
}

// Seeded shuffle — same seed = same order, deterministic per day
function seededShuffle(arr, seed) {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function getDaySeed() {
  const day = getDayKey()
  return day.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
}

const _BLOCKED = [
  'harry potter','sherlock holmes','the adventures of sherlock',
  'the hound of the baskervilles','a study in scarlet','the sign of four',
  'sputnik sweetheart','message in a bottle','a million little pieces',
  'the deep end of the ocean','the complete short novels','the sea','war and peace'
]
const _BLOCKED_EXACT = new Set([
  'the great gatsby','to kill a mockingbird','1984','animal farm','brave new world',
  'the alchemist','the little prince','pride and prejudice','jane eyre','wuthering heights',
])
function isBlocked(titleLower) {
  if (_BLOCKED_EXACT.has(titleLower)) return true
  return _BLOCKED.some(p => titleLower.startsWith(p) || titleLower.includes(p))
}

function isMetadataDesc(desc) {
  if (!desc) return true
  const trimmed = desc.trim()
  // Looks like "Title AuthorName YYYY" — short metadata string
  if (/^.{0,120}\s+\d{4}$/.test(trimmed) && trimmed.split(' ').length < 12) return true
  // All words are title-cased/caps with a year at end — typical CSV metadata
  if (/^[\w\s,.'!?:;\-–—()/]+\s+\d{4}$/.test(trimmed) && trimmed.length < 200) return true
  // Less than 80 chars with no sentence-ending punctuation
  if (trimmed.length < 80 && !/[.!?]/.test(trimmed)) return true
  return false
}

const _authorImgCache = new Map();
async function fetchAuthorImg(name) {
  if (_authorImgCache.has(name)) return _authorImgCache.get(name);
  try {
    const r = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`,
      { headers: { Accept: "application/json" } },
    );
    if (!r.ok) throw new Error();
    const data = await r.json();
    const url = data?.thumbnail?.source || data?.originalimage?.source || "";
    _authorImgCache.set(name, url);
    return url;
  } catch {
    _authorImgCache.set(name, "");
    return "";
  }
}
function AuthorImg({ name, style }) {
  const [imgSrc, setImgSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const hue = name.split('').reduce((acc,ch) => acc+ch.charCodeAt(0), 0) % 360
  const ini = name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()
  useEffect(() => {
    setFailed(false); setLoading(true); setImgSrc('')
    fetchAuthorImg(name).then(url => {
      setImgSrc(url || '')
      setLoading(false)
    })
  }, [name])
  const avatarStyle = {
    ...style, borderRadius:'50%',
    background:`hsl(${hue},35%,28%)`,
    border:`2px solid hsl(${hue},45%,42%)`,
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily:'Montserrat Alternates,sans-serif',
    fontSize:22, fontWeight:700, color:`hsl(${hue},55%,72%)`
  }
  if (loading) return (
    <div style={avatarStyle}>
      <div style={{width:20,height:20,borderRadius:'50%',
        border:'2px solid rgba(201,168,76,0.15)',
        borderTopColor:'rgba(201,168,76,0.5)',
        animation:'spin 0.8s linear infinite'}}/>
    </div>
  )
  if (failed || !imgSrc) return <div style={avatarStyle}>{ini}</div>
  return (
    <img src={imgSrc} alt={name}
      style={{...style, objectFit:'cover', objectPosition:'center top', borderRadius:'50%'}}
      onError={() => setFailed(true)}/>
  )
}

function useUserProfileImage() {
  const [imageUrl, setImageUrl] = useState(() => {
    const fromCache = localStorage.getItem('rook_profile_image') || ''
    if (fromCache) return fromCache
    try {
      const user = JSON.parse(localStorage.getItem('rook_user') || '{}')
      const raw = user.image_url || ''
      if (!raw) return ''
      return makeAbsoluteImageUrl(raw)
    } catch { return '' }
  })
  const refresh = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('rook_user') || '{}')
      if (!user.id) return
      const token = localStorage.getItem('rook_access_token')
      const r = await fetch(`${API_BASE}/users/${user.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!r.ok) return
      const data = await r.json()
      if (data.image_url) {
        const full = makeAbsoluteImageUrl(data.image_url)
        setImageUrl(full)
        localStorage.setItem('rook_profile_image', full)
      } else {
        setImageUrl('')
        localStorage.removeItem('rook_profile_image')
      }
    } catch {}
  }
  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [])
  return { imageUrl, setImageUrl, refresh }
}

const FEATURED_AUTHORS = [
  { name:'Jane Austen', query:'Austen' },
  { name:'J.K. Rowling', query:'Rowling' },
  { name:'Stephen King', query:'Stephen King' },
  { name:'Agatha Christie', query:'Christie' },
  { name:'George Orwell', query:'Orwell' },
  { name:'J.R.R. Tolkien', query:'J. R. R. Tolkien' },
  { name:'F. Scott Fitzgerald', query:'Fitzgerald' },
  { name:'Fyodor Dostoevsky', query:'Dostoevsky' },
  { name:'Haruki Murakami', query:'Murakami' },
  { name:'Ernest Hemingway', query:'Hemingway' },
  { name:'Mark Twain', query:'Mark Twain' },
  { name:'Leo Tolstoy', query:'Tolstoy' },
  { name:'Charles Dickens', query:'Dickens' },
  { name:'Oscar Wilde', query:'Oscar Wilde' },
  { name:'Virginia Woolf', query:'Virginia Woolf' },
  { name:'Dan Brown', query:'Dan Brown' },
]
const CATEGORIES = [
  { name:'Fantasy', cls:'cat-fantasy', query:'fantasy', color:'linear-gradient(135deg,#1a0f3d,#3d2a7a)',
    book:'The Lord of the Rings', bookImg:'https://covers.openlibrary.org/b/isbn/9780618640157-L.jpg' },
  { name:'Mystery', cls:'cat-mystery', query:'mystery', color:'linear-gradient(135deg,#0d2020,#1c5050)',
    book:'And Then There Were None', bookImg:'https://covers.openlibrary.org/b/isbn/9780062073556-L.jpg' },
  { name:'Romance', cls:'cat-romance', query:'romance', color:'linear-gradient(135deg,#4a0d1e,#9e3058)',
    book:'Pride and Prejudice', bookImg:'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg' },
  { name:'Thriller', cls:'cat-thriller', query:'thriller', color:'linear-gradient(135deg,#0a0a18,#2a1845)',
    book:'Gone Girl', bookImg:'https://covers.openlibrary.org/b/isbn/9780307588371-L.jpg' },
  { name:'Sci-Fi', cls:'cat-scifi', query:'science fiction', color:'linear-gradient(135deg,#071828,#0e3d60)',
    book:'Dune', bookImg:'https://covers.openlibrary.org/b/isbn/9780441013593-L.jpg' },
  { name:'Biography', cls:'cat-bio', query:'biography', color:'linear-gradient(135deg,#1e1600,#5a4400)',
    book:'Leonardo da Vinci', bookImg:'https://covers.openlibrary.org/b/isbn/9781501139154-L.jpg' },
  { name:'Horror', cls:'cat-horror', query:'horror', color:'linear-gradient(135deg,#120000,#400808)',
    book:'The Shining', bookImg:'https://covers.openlibrary.org/b/isbn/9780307743657-L.jpg' },
  { name:'Classics', cls:'cat-classics', query:'classics', color:'linear-gradient(135deg,#140e00,#42300a)',
    book:'Anna Karenina', bookImg:'https://covers.openlibrary.org/b/isbn/9780143035008-L.jpg' },
]
const GENRE_PILLS = ['Fiction','Fantasy','Mystery','Romance','Thriller','Comedy','Biography','Self-Help']
const MOOD_DATA = {
  happy: {
    label:'Happy', desc:'Feel-good stories, joyful endings and books that make you smile',
    accent:'#f0a030',
    key:'hopeful',
    query:'uplifting redemptive second-chance inspiring overcoming obstacles optimistic warm triumphant resilience healing growth transformation',
    genres:['romance','comedy','young-adult','fiction'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2.5 4 2.5 4-2.5 4-2.5"/><line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3"/><line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3"/></svg>,
  },
  sad: {
    label:'Sad', desc:'Emotional, cathartic reads that let you feel deeply and cry freely',
    accent:'#6a9fd8',
    key:'emotional',
    query:'grief longing loss love cathartic beautifully written emotional literary deeply moving heartbreak',
    genres:['literary','romance','classics','biography'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3"/><line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3"/><path d="M8 17.5q1 1.5 2 0" strokeWidth="1.4"/><path d="M14 17.5q1 1.5 2 0" strokeWidth="1.4"/></svg>,
  },
  adventurous: {
    label:'Adventurous', desc:'Epic quests, bold heroes, high stakes and worlds to explore',
    accent:'#e07840',
    key:'adventurous',
    query:'high-stakes action-packed daring bold fast-paced journey survival discovery risk courage exciting page-turner adrenaline',
    genres:['adventure','thriller','crime','young-adult'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
  },
  romantic: {
    label:'Romantic', desc:'Love stories, slow burns, tender moments and happy-ever-afters',
    accent:'#e06080',
    key:'romantic',
    query:'sweeping love story slow burn enemies to lovers second chance romance tender passionate heartwarming happily ever after emotional chemistry yearning desire falling in love couple relationship',
    genres:['romance','paranormal','classics','literary'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  },
  dark: {
    label:'Dark', desc:'Gritty, disturbing, morally complex stories with real menace',
    accent:'#9a7ab8',
    key:'dark',
    query:'gritty unsettling morally complex disturbing bleak sinister menacing psychological tension dark atmosphere dread',
    genres:['horror','thriller','crime','mystery'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  },
  cosy: {
    label:'Cosy', desc:'Warm, safe, small-town charm and gentle stories for quiet afternoons',
    accent:'#c88040',
    key:'cosy',
    query:'warm safe gentle comforting quiet village community charming fireside cozy small-town feel-good heartwarming soft',
    genres:['mystery','romance','comedy','classics'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  intellectual: {
    label:'Intellectual', desc:'Ideas, philosophy and arguments that challenge your assumptions',
    accent:'#5a9ab8',
    key:'intellectual',
    query:'thought-provoking philosophical challenging ideas complex argument intellectual depth nuanced analysis stimulating dense rewarding',
    genres:['philosophy','classics','literary','biography'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="3"/></svg>,
  },
  tense: {
    label:'Tense', desc:'Relentless thrillers, paranoia and suspense you cannot put down',
    accent:'#c84040',
    key:'tense',
    query:'unbearable suspense relentless pacing paranoia unstoppable countdown nail-biting gripping anxiety high-stakes nerve-shredding thriller',
    genres:['thriller','horror','mystery','crime'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><polyline points="22 7 13.5 15.5 8.5 10.5 1 18"/><polyline points="16 7 22 7 22 13"/></svg>,
  },
  dreamy: {
    label:'Dreamy', desc:'Lyrical, surreal, softly magical stories that feel like a waking dream',
    accent:'#8080d4',
    key:'dreamy',
    query:'lyrical poetic atmospheric otherworldly magical surreal lush languid evocative sensory immersive soft ethereal enchanting',
    genres:['paranormal','romance','literary','poetry'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>,
  },
  hopeful: {
    label:'Hopeful', desc:'Second chances, resilience and stories where kindness wins',
    accent:'#50a870',
    key:'hopeful',
    query:'uplifting redemptive second-chance inspiring overcoming obstacles optimistic warm triumphant resilience healing growth transformation',
    genres:['romance','literary','young-adult','fiction'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  },
  funny: {
    label:'Funny', desc:'Laugh-out-loud wit, absurdist comedy and sharp satirical humour',
    accent:'#d4c040',
    key:'funny',
    query:'laugh-out-loud witty comic absurdist satirical humorous clever wordplay banter sharp funny lighthearted amusing quirky',
    genres:['comedy','young-adult','romance','fiction'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 3 4 3 4-3 4-3"/><line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3"/><line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3"/></svg>,
  },
  reflective: {
    label:'Reflective', desc:'Quiet, introspective books that slow you down and make you think',
    accent:'#78a0b8',
    key:'reflective',
    query:'quiet contemplative introspective meditative inner-life prose slow-burn character study melancholic thoughtful consciousness',
    genres:['literary','classics','biography','philosophy'],
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="22" height="22"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  },
}

const SEASON_DATA = {
  summer: {
    label: "Summer",
    desc: "Beach reads, sun-drenched adventures & feel-good summer stories",
    bgDark: "linear-gradient(135deg,#ffbb33 0%,#ffcd6c 50%,#d8631f 100%)",
    bgLight: "linear-gradient(135deg,#f2d6a1 0%,#ffcd6c 50%,#ffbb33 100%)",
    accentDark: "#d8631f", accentLight: "#d8631f",
    mood: "summer beach young adult romance feel-good holiday",
    contextVal: "summer", genres: ["romance", "young-adult", "adventure", "fiction"],
    query: "summer beach romance young adult warm sun vacation coming-of-age",
    searchTerms: [
      "the summer i turned pretty","it's not summer without you","we'll always have summer","call me by your name", "we were liars","beach read","one italian summer", "every summer after","the seven husbands of evelyn hugo","daisy jones and the six",
      "the hating game","it ends with us","me before you", "beach house","summer sisters","a room with a view forster","cider with rosie laurie lee","the song of achilles", "dandelion wine",
    ],
  },
  spring: {
    label: "Spring",
    desc: "Jane Austen romance, Regency classics & charming love stories for blossom season",
    bgDark: "linear-gradient(135deg,#ecc4c3 0%,#f2aebc 50%,#ecc4c3 100%)",
    bgLight: "linear-gradient(135deg,#f2aebc 0%,#ecc4c3 50%,#f2aebc 100%)",
    accentDark: "#b03070", accentLight: "#b03070",
    mood: "jane austen regency romance witty social comedy manners persuasion emma sense sensibility northanger abbey",
    contextVal: "spring", genres: ["romance", "classics", "literary", "fiction"],
    query: "jane austen regency romance witty social manners love marriage courtship blossoms spring renewal",
    searchTerms: [
      "pride and prejudice","anne of green gables","call me by your name","to all the boys ive loved before",
      "in her shoes","emma","persuasion","one day","sense and sensibility","the duke and i bridgertons","little women","howls moving castle","northanger abbey","the crown","the selection","much ado about nothing","the secret garden","a midsummer nights dream",
    ],
  },
  rainy: {
    label: "Rainy",
    desc: "Mystery, thriller, sci-fi & paranormal for stormy grey days",
    bgDark: "linear-gradient(135deg,#28536b 0%,#16394c 50%,#28536b 100%)",
    bgLight: "linear-gradient(135deg,#5b6f7b 0%,#344753 50%,#344753 100%)",
    accentDark: "#aacfe2", accentLight: "#aacfe2",
    mood: "rainy mystery thriller suspense psychological paranormal dark moody atmospheric enclosed",
    contextVal: "rainy", genres: ["mystery", "thriller", "paranormal", "sci-fi"],
    query: "mystery thriller paranormal sci-fi suspense dark moody atmospheric rain",
    searchTerms: [
      "gone girl","girl on the train","the silent patient",
      "big little lies","sharp objects gillian flynn",
      "in the woods tana french","the woman in the window",
      "behind closed doors","the guest list lucy foley",
      "one by one ruth ware","the it girl ruth ware",
      "the turn of the screw","rebecca daphne du maurier",
      "the haunting of hill house","mexican gothic",
      "house of leaves","the strange case of dr jekyll and mr hyde",
    ],
  },
  fall: {
    label: "Autumn",
    desc: "Gothic classics, dark academia & atmospheric mysteries for amber evenings",
    bgDark: "linear-gradient(135deg,#84592b 0%,#84592b 50%,#442d1c 100%)",
    bgLight: "linear-gradient(135deg,#84592b 0%,#84592b 50%,#442d1c 100%)",
    accentDark: "#e8d1a7", accentLight: "#e8d1a7",
    mood: "autumn gothic classics dark academia mystery atmospheric melancholic haunting",
    contextVal: "autumn", genres: ["classics", "mystery", "gothic", "literary"],
    query: "gothic classics dark academia atmospheric autumn mystery haunting melancholic literary",
    searchTerms: [
      "dead poets society","caraval","rebecca","red queen","gone girl","twilight","the secret history ","something wicked this way comes",
      "wuthering heights","jane eyre","dracula","the haunting of hill house","the great gatsby","the picture of dorian gray","frankenstein","great expectations dickens","six of crows","a discovery of witches","the historian elizabeth kostova","dark academia",
    ],
  },
  winter: {
    label: "Winter",
    desc: "Chilling thrillers, cosy mysteries & gripping suspense for cold dark nights",
    bgDark: "linear-gradient(135deg,#c3cfd7 0%,#8ea1ae 50%,#8ea1ae 100%)",
    bgLight: "linear-gradient(135deg,#c3cfd7 0%,#8ea1ae 50%,#8ea1ae 100%)",
    accentDark: "#1c394d", accentLight: "#1c394d",
    mood: "winter thriller suspense mystery psychological chilling gripping cosy crime",
    contextVal: "winter", genres: ["thriller", "mystery", "crime", "horror"],
    query: "winter thriller mystery suspense psychological chilling cosy crime murder gripping",
    searchTerms: [
      "no exit ","blood on snow ","an unwanted guest","the winter people","the hunting party","the writing retreat","dead of winter",  "the shining stephen king",
      "murder on the orient express","hercule poirot christmas agatha christie","midwinter murder agatha christie","one by one ruth ware","the christmas shoes","the snowman jo nesbo","let it snow ","a christmas carol","the lady in the lake ","winter in madrid",
    ],
  },
};

const TRAVEL_TABS = [
  { id:'flight', label:'Long Flight', sub:'8h+ in the air', mood:'long flight', contextVal:'long flight', genres:['fantasy','sci-fi','adventure','thriller'] },
  { id:'train', label:'Train Journey', sub:'1–4h through countryside', mood:'train', contextVal:'train', genres:['classics','history','mystery','romance'] },
  { id:'beach', label:'Beach Holiday', sub:'Poolside & slow mornings', mood:'beach', contextVal:'beach', genres:['romance','comedy','young-adult','adventure'] },
  { id:'road', label:'Road Trip', sub:'Open roads, good company', mood:'road trip', contextVal:'road trip', genres:['biography','self-help','adventure','literary'] },
]
const WEEKEND_BUCKETS = [
  { id:'quick', label:'30-Minute Read', sub:'Short, sharp and satisfying', key:'30 minutes', accent:'#d4a043',
    mood:'quick short fast read compact story under 200 pages novella light fun breezy comedic slice-of-life easy quick bite' },
  { id:'two', label:'2-Hour Read', sub:'Perfect for a lazy afternoon', key:'2 hours', accent:'#e06080',
    mood:'gripping medium-length novel under 300 pages fast-paced page-turner thriller mystery romance satisfying complete single-sitting read' },
  { id:'novel', label:'Weekend Novel', sub:'Lose yourself all weekend', key:'weekend', accent:'#8080d4',
    mood:'long immersive epic saga multi-generational sprawling world-building fantasy classics literary masterpiece weekend read rich detailed' },
]
const TS_SLOTS = [
  { slot:'early_morning', hours:[5,6,7], label:'Rise and Shine', sub:'Books that set the tone for the day.', mood:'early_morning', genres:['philosophy','poetry','self-help','biography'] },
  { slot:'morning', hours:[8,9,10,11], label:'Morning Reads', sub:'Something engaging to carry through the day.', mood:'morning', genres:['crime','thriller','mystery','fiction'] },
  { slot:'afternoon', hours:[12,13], label:'Lunch Break', sub:'Something you can start and stop cleanly.', mood:'afternoon', genres:['comedy','young-adult','adventure','romance'] },
  { slot:'late_afternoon',hours:[14,15,16,17], label:'Afternoon Escape', sub:'Sink into something absorbing.', mood:'late_afternoon', genres:['history','literary','classics','fiction'] },
  { slot:'evening', hours:[18,19,20], label:'Evening Wind-Down', sub:'Leave the day behind in a good story.', mood:'evening', genres:['thriller','mystery','horror','crime'] },
  { slot:'night', hours:[21,22,23], label:'Bedtime Picks', sub:'The right book before sleep.', mood:'night', genres:['paranormal','romance','literary','classics'] },
  { slot:'late_night', hours:[0,1,2,3,4], label:'Past Midnight', sub:'For those who stay up too late reading.', mood:'late_night', genres:['horror','thriller','sci-fi','crime'] },
]

  //  HELPERS
function dedupBooks(books) {
  const seen = new Set()
  const deduped = (books||[]).filter(b => {
    const k = (b.title||'').toLowerCase().trim()
    if (!k || seen.has(k) || isBlocked(k)) return false
    seen.add(k); return true
  })
  return fixCovers(deduped)
}
function detectSeason() {
  const m = new Date().getMonth()
  if (m>=2&&m<=4) return 'spring'; if (m>=5&&m<=7) return 'summer'; if (m>=8&&m<=10) return 'fall'; return 'winter'
}
function getTsSlot() {
  const h = new Date().getHours()
  return TS_SLOTS.find(s=>s.hours.includes(h)) || TS_SLOTS[4]
}
function hexDarken(hex, f) {
  try { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})` } catch { return hex }
}
const lsKey = (u,l) => `rook_${l}_${u||'guest'}`
const loadList=(u,l)=>{try{return JSON.parse(localStorage.getItem(lsKey(u,l))||'[]')}catch{return[]}}
const saveList=(u,l,d)=>{try{localStorage.setItem(lsKey(u,l),JSON.stringify(d))}catch{}}
const _TRACKER_KEY='rook_user_actions'
function _loadActions(){try{return JSON.parse(localStorage.getItem(_TRACKER_KEY)||'[]')}catch{return[]}}
function _saveActions(a){try{localStorage.setItem(_TRACKER_KEY,JSON.stringify(a.slice(-120)))}catch{}}
function trackAction(type,book){if(!book?.title)return;const a=_loadActions();a.push({type,title:book.title,authors:book.authors||'',genre:book.genre||'',ts:Date.now()});_saveActions(a)}
function getTopGenres(limit=5){const freq={};_loadActions().forEach(a=>{(a.genre||'').split(',').map(g=>g.trim().toLowerCase()).filter(Boolean).forEach(g=>{freq[g]=(freq[g]||0)+(a.type==='liked'?3:a.type==='read'?2:1)})});return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([g])=>g)}

  //  TIME-BASED GREETING
function getTimeGreeting(name) {
  const hour = new Date().getHours()
  let greeting
  if (hour >= 5 && hour < 8) {
    greeting = 'Early bird'
  } else if (hour >= 8 && hour < 12) {
    greeting = 'Good morning'
  } else if (hour >= 12 && hour < 14) {
    greeting = 'Good afternoon'
  } else if (hour >= 14 && hour < 17) {
    greeting = 'Hey there'
  } else if (hour >= 17 && hour < 20) {
    greeting = 'Good evening'
  } else if (hour >= 20 && hour < 23) {
    greeting = 'Good night'
  } else {
    greeting = 'Night owl'
  }
  return { greeting }
}

  //  API ENGINE
const _cache=new Map(); const _TTL=30*60_000
function _ck(t,p){return t+'::'+JSON.stringify(p).slice(0,200)}
function _cGet(k){
  const m=_cache.get(k); if(m){if(Date.now()-m.ts>_TTL){_cache.delete(k)}else return m.data}
  try{const s=sessionStorage.getItem('rook_'+k);if(s){const e=JSON.parse(s);if(Date.now()-e.ts<_TTL){_cache.set(k,e);return e.data}else sessionStorage.removeItem('rook_'+k)}}catch{}
  return null
}
function _cSet(k,d){
  const e={data:d,ts:Date.now()}; _cache.set(k,e)
  try{sessionStorage.setItem('rook_'+k,JSON.stringify(e))}catch{}
}
async function fetchMood(mood,{top_n=20,use_llm=false,context={},user_genres=[],liked=[],saved=[]}={},signal){
  const k=_ck('mood',{mood,context,top_n}); const cached=_cGet(k); if(cached) return cached
  try{
    const r=await fetch(`${API_BASE}/recommend/mood`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      mood, top_n:top_n+6, use_llm,
      season:context.season||null,
      time_of_day:context.time_of_day||null,
      travel:context.travel||null,
      reading_time:context.reading_time||null,
      user_genres, liked_titles:liked, saved_titles:saved,
    }),signal})
    if(!r.ok) throw new Error()
    const d=await r.json(); const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
    if(list.length) _cSet(k,list); return list
  }catch(e){if(e?.name==='AbortError')throw e; return[]}
}
async function fetchHybrid({liked=[],saved=[],top_n=20,title=null,uid=null}={},signal){
  const k=_ck('hybrid',{liked:liked.slice(0,4),saved:saved.slice(0,4),title}); const cached=_cGet(k); if(cached) return cached
  try{
    const qs=new URLSearchParams(); if(uid)qs.set('user_id',uid); if(title)qs.set('title',title)
    const r=await fetch(`${API_BASE}/recommend/hybrid${qs.toString()?'?'+qs:''}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({liked_titles:liked,saved_titles:saved,top_n:top_n+6}),signal})
    if(!r.ok) throw new Error()
    const d=await r.json(); const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
    if(list.length) _cSet(k,list); return list
  }catch(e){if(e?.name==='AbortError')throw e; return[]}
}
async function fetchSaved({liked=[],saved=[],read=[],user_genres=[],top_n=24,user_action=null,context_title=null}={},signal){
  const allKeys=[...liked,...saved,...read].slice(0,4); if(!allKeys.length) return[]
  const k=_ck('saved',{allKeys,user_action}); const cached=_cGet(k); if(cached) return cached
  try{
    const r=await fetch(`${API_BASE}/recommend/saved`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({liked_titles:liked,saved_titles:saved,read_titles:read,user_genres,user_action,context_title,top_n}),signal})
    if(!r.ok) throw new Error()
    const d=await r.json(); const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
    if(list.length) _cSet(k,list); return list
  }catch(e){if(e?.name==='AbortError')throw e; return[]}
}
async function fetchGenre(genre,top_n=20,signal){
  const k=_ck('genre',{genre,top_n}); const cached=_cGet(k); if(cached) return cached
  try{
    const r=await fetch(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(genre)}&top_n=${top_n}`,signal?{signal}:{})
    if(!r.ok) throw new Error()
    const d=await r.json(); const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
    if(list.length) _cSet(k,list); return list
  }catch(e){if(e?.name==='AbortError')throw e; return[]}
}
async function fetchTrending(top_n=20){
  const k=_ck('trending',{top_n}); const cached=_cGet(k); if(cached) return cached
  try{const d=await apiFetch(`${API_BASE}/trending?top_n=${top_n}`);const list=dedupBooks(Array.isArray(d)?d:[]);if(list.length)_cSet(k,list);return list}catch{return[]}
}
async function fetchPersonalised({likedTitles=[],savedTitles=[],readTitles=[],userGenres=[],top_n=24,mood=null,use_llm=false,context_title=null,signal=null}={}){
  const allSeeds=[...likedTitles,...savedTitles,...readTitles]
  if(allSeeds.length){
    try{const l=await fetchSaved({liked:likedTitles,saved:savedTitles,read:readTitles,user_genres:userGenres,top_n,context_title},signal);if(l.length>=4)return l}catch(e){if(e?.name==='AbortError')throw e}
    try{const l=await fetchHybrid({liked:likedTitles,saved:savedTitles,top_n,title:context_title},signal);if(l.length>=4)return l}catch(e){if(e?.name==='AbortError')throw e}
  }
  if(mood){try{const l=await fetchMood(mood,{top_n,use_llm,liked:likedTitles,saved:savedTitles},signal);if(l.length)return l}catch(e){if(e?.name==='AbortError')throw e}}
  if(userGenres[0]){try{return await fetchGenre(userGenres[0],top_n,signal)}catch{}}
  return fetchTrending(top_n)
}
  //  HOOKS
function useInView(rootMargin='300px'){
  const ref=useRef(null); const [inView,setInView]=useState(false)
  useEffect(()=>{
    const el=ref.current; if(!el) return
    const rect=el.getBoundingClientRect(); if(rect.top<window.innerHeight+400){setInView(true);return}
    const obs=new IntersectionObserver(([e])=>{if(e.isIntersecting){setInView(true);obs.disconnect()}},{rootMargin})
    obs.observe(el); return()=>obs.disconnect()
  },[])
  return[ref,inView]
}

  //  MICRO COMPONENTS
function Toast({msg}){if(!msg)return null;return<div className="toast show">{msg}</div>}
function SectionLabel({eyebrow,title,accent='var(--gold)',children}){
  return(
    <div className="hs-header">
      <div>
        {eyebrow&&<p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:accent,letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 3px'}}>{eyebrow}</p>}
        <h3 className="hs-title">{title}</h3>
      </div>
      {children}
    </div>
  )
}
function BookShelf({books,loading}){
  if(loading)return<div style={{padding:'24px 36px',fontFamily:'Montaga,serif',fontSize:13,color:'var(--text-muted)'}}>Loading…</div>
  if(!books?.length)return null
  return<BookRow books={dedupBooks(books)} loading={false}/>
}
function HeroCarousel({ onOpen, savedSet, wishedSet, onSave, onWish }) {
  const [books, setBooks] = useState([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const timer = useRef(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const cached = loadCarouselCache()
      if (cached && cached.books && cached.books.length >= 6) {
        if (!cancelled) {
          setBooks(cached.books)
          setIdx(0)
          setLoading(false)
        }
        return
      }
      try {
        const todayGenre = getTodayGenre()
        const daySeed    = getDaySeed()
        const [genreRaw, trendingRaw] = await Promise.all([
          fetch(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(todayGenre)}&top_n=60`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => []),
          apiFetch(`${API_BASE}/trending?top_n=60`).catch(() => []),
        ])
        if (cancelled) return
        const seen = new Set()
        const merged = []
        for (const b of [...(Array.isArray(genreRaw) ? genreRaw : []), ...(Array.isArray(trendingRaw) ? trendingRaw : [])]) {
          const k = (b.title || '').toLowerCase().trim()
          if (!k || seen.has(k) || isBlocked(k)) continue
          seen.add(k)
          merged.push(b)
        }
        const shuffled = seededShuffle(merged, daySeed)
        const candidates = []
        const BATCH = 8 // process 8 at a time, take first 20 with image
        for (let i = 0; i < shuffled.length && candidates.length < 20; i += BATCH) {
          if (cancelled) return
          const batch = shuffled.slice(i, i + BATCH)

          const resolved = await Promise.all(
            batch.map(async (book) => {
              // 1. Try stored/OL URL first (no network)
              const stored = cleanImageUrl(book.image_url || '')
              const ol     = !stored ? olCover(book) : ''
              const fastUrl = stored || ol

              if (fastUrl) return { ...book, image_url: fastUrl }
              // 2. Fetch from Google Books via imageUtils queue
              try {
                const gb = await fetchGBCover(book.title || '', book.authors || '')
                if (gb) return { ...book, image_url: gb }
              } catch {}
              // No image found — exclude
              return null
            })
          )
          for (const b of resolved) {
            if (b && candidates.length < 20) candidates.push(b)}
        }
        if (cancelled) return
        if (candidates.length === 0) {
          setLoading(false)
          return
        }
        // Save to 24-hour cache
        saveCarouselCache(candidates, todayGenre)
        setBooks(candidates)
        setIdx(0)
        setLoading(false)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!books.length) return
    timer.current = setInterval(() => setIdx(i => (i + 1) % books.length), 7000)
    return () => clearInterval(timer.current)
  }, [books.length])
  function goTo(i) {
    clearInterval(timer.current)
    setIdx(i)
    timer.current = setInterval(() => setIdx(p => (p + 1) % books.length), 7000)
  }
  if (loading) {
    return (
      <div className="hero-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 420 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '2.5px solid rgba(201,168,76,0.15)', borderTopColor: 'rgba(201,168,76,0.7)', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: 'rgba(240,233,227,0.35)', fontFamily: 'Montaga,serif', fontSize: 13 }}>Loading featured books…</p>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    )
  }
  if (!books.length) return (
    <div className="hero-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 420 }}>
      <p style={{ color: 'rgba(240,233,227,0.35)', fontFamily: 'Montaga,serif' }}>Start your backend to load content</p>
    </div>
  )

  const b = books[idx]
  const heroUrl = b.image_url || ''
  const rawDesc = b.description || ''
  const displayDesc = isMetadataDesc(rawDesc) ? '' : rawDesc
  const genres = (b.genre || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 3)
  const isSaved = savedSet?.has(b.title)
  const isWished = wishedSet?.has(b.title)
 
  return (
    <div className="hero-section">
      {heroUrl && <div className="hero-bg-blur" style={{ backgroundImage: `url(${heroUrl})` }} />}
      <div className="hero-overlay" />
      <div className="hero-content">
        <div className="hero-inner-wrap">
          <div className="hero-left">
            <h1 className="hero-title">{b.title}</h1>
            {b.authors && <p className="hero-author-line">by {b.authors}</p>}
            <div className="hero-chips">
              {genres.map(g => <span key={g} className="hero-chip">{g}</span>)}
              {b.average_rating && <span className="hero-chip">{Number(b.average_rating).toFixed(1)} ★</span>}
            </div>
            {displayDesc && (
              <p className="hero-desc">
                {displayDesc.slice(0, 260)}{displayDesc.length > 260 ? '…' : ''}
              </p>
            )}
            <div className="hero-actions">
              <button className={`hero-btn-primary${isSaved ? ' active' : ''}`} onClick={() => onSave?.(b)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="13" height="13"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                {isSaved ? 'Saved' : 'Save'}
              </button>
              <button className={`hero-btn-secondary${isWished ? ' active' : ''}`} onClick={() => onWish?.(b)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="13" height="13"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                Wishlist
              </button>
              <button className="hero-btn-info" onClick={() => onOpen(b)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="13" height="13"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                More Info
              </button>
            </div>
          </div>
          <div className="hero-right">
            <div className="hero-cover-wrap" onClick={() => onOpen(b)} style={{ cursor: 'pointer' }}>
              <img
                src={heroUrl}
                alt={b.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={async (e) => {
                  // Fallback: try fetchGBCover on error (cache miss race condition)
                  if (!e.target._triedFallback) {
                    e.target._triedFallback = true
                    try {
                      const gb = await fetchGBCover(b.title || '', b.authors || '')
                      if (gb) {
                        e.target.src = gb
                        return
                      }
                    } catch {}
                  }
                  // Hide just the img — show a book icon fallback
                  e.target.style.display = 'none'
                  const parent = e.target.parentElement
                  if (parent && !parent.querySelector('.hero-img-fallback')) {
                    const fb = document.createElement('div')
                    fb.className = 'hero-img-fallback'
                    fb.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;'
                    fb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(201,168,76,0.3)" stroke-width="1.4" width="64" height="64"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
                    parent.appendChild(fb)
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="hero-dots">
        {books.map((bk, i) => {
          const u = bk.image_url || ''
          return (
            <div key={i} className={`hero-thumb${i === idx ? ' active' : ''}`} onClick={() => goTo(i)} title={bk.title}>
              {u && <img src={u} alt={bk.title} loading="lazy" onError={e => e.target.style.display = 'none'} />}
              <div className="hero-thumb-overlay" />
              <div className="hero-thumb-tip">{bk.title}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
function SearchBar({ onSearch, onOpenBook, userName, onGenre }) {
  const [query, setQuery] = useState('') 
  const [acItems, setAcItems] = useState([])
  const [acOpen, setAcOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const glintRef = useRef(null)
  const timer = useRef(null)
  const { greeting } = useMemo(() => getTimeGreeting(userName), [])
  const rotatingBooks = useMemo(() => ['The Alchemist', 'Lord of the Rings', 'Pride and Prejudice','Harry Potter', 'And Then There Were None',], [])
  // Close autocomplete on outside click
  useEffect(() => {
    const fn = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setAcOpen(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])
  // Rotate placeholder when input is empty
  useEffect(() => {
    if (query.trim()) return
    const id = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % rotatingBooks.length)
    }, 2200)
    return () => clearInterval(id)
  }, [query, rotatingBooks.length])
  function onInput(val) {
    setQuery(val)
    clearTimeout(timer.current)
    if (val.trim().length < 2) { setAcItems([]); setAcOpen(false); return }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/search?query=${encodeURIComponent(val.trim())}&limit=7`)
        if (!r.ok) throw new Error()
        const d = await r.json()
        const items = fixCovers(Array.isArray(d) ? d : (d?.results || d?.books || []))
        setAcItems(items); setAcOpen(items.length > 0)
      } catch { setAcItems([]); setAcOpen(false) }
    }, 280)
  }
  function submit() { setAcOpen(false); if (query.trim()) onSearch(query.trim()) }
  // Glint follows cursor inside button
  function handleBtnMouseMove(e) {
    if (!btnRef.current || !glintRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * 100
    const y = ((e.clientY - r.top) / r.height) * 100
    glintRef.current.style.left = x + '%'
    glintRef.current.style.top = y + '%'
  }
  function handleBtnMouseLeave() {
    if (glintRef.current) { glintRef.current.style.left = '30%'; glintRef.current.style.top = '30%' }
  }
  const dynamicPlaceholder = `Search "${rotatingBooks[placeholderIndex]}"`
  return (
    <div className="home-body">
      <div className="home-welcome-strip">
        <span className="hw-label">
          {greeting}, <span className="hw-name">{userName || 'Reader'}</span>
        </span>
      </div>
      <div className="home-search-center">
        <h2 className="home-tagline">Discover Your Next Great Read</h2>
        <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 1000, margin: '0 auto' }}>
          <div
            className="home-sw"
            style={{
              transition: 'all 0.28s ease',
              boxShadow: isFocused
                ? '0 14px 34px rgba(0,0,0,0.28), 0 0 0 1px rgba(212,161,94,0.22)'
                : '0 8px 20px rgba(0,0,0,0.16)',
              borderRadius: 999,
            }}>
            <input
              className="home-search"
              type="text"
              placeholder={dynamicPlaceholder}
              value={query}
              onChange={e => onInput(e.target.value)}
              onFocus={() => { setIsFocused(true); if (acItems.length) setAcOpen(true) }}
              onBlur={() => setIsFocused(false)}
              onKeyDown={e => {
                if (e.key === 'Enter') { setAcOpen(false); submit() }
                if (e.key === 'Escape') setAcOpen(false)
              }}
              autoComplete="off"/>
            {/* Animated search button with cursor-tracking glint */}
            <button
              ref={btnRef}
              className="home-sbtn"
              onClick={submit}
              onMouseMove={handleBtnMouseMove}
              onMouseLeave={handleBtnMouseLeave}>
              <span ref={glintRef} className="sbtn-glint" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="22" y2="22" />
              </svg>
            </button>
          </div>
          {/* Autocomplete dropdown */}
          {acOpen && acItems.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
              zIndex: 9999, background: 'var(--bg2)',
              border: '1px solid rgba(114,57,63,0.15)', borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)', overflow: 'hidden',
            }}>
              {acItems.map((book, i) => {
                const imgUrl = cleanImageUrl(book.image_url)
                return (
                  <div key={i}
                    onMouseDown={e => { e.preventDefault(); setAcOpen(false); setQuery(book.title); onOpenBook(book) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
                      cursor: 'pointer',
                      borderBottom: i < acItems.length - 1 ? '1px solid rgba(114,57,63,0.08)' : 'none',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(114,57,63,0.07)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 36, height: 50, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: 'rgba(114,57,63,0.15)' }}>
                      {imgUrl && <img src={imgUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{book.title}</div>
                      <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{book.authors || ''}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="home-pills">
          {GENRE_PILLS.map(g => (
            <button key={g} className="pill" onClick={() => onGenre ? onGenre(g.toLowerCase()) : onSearch(g.toLowerCase())}>{g}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

  //  GENERIC LAZY SECTION
function LazySection({eyebrow,title,accent='var(--gold)',fetchFn,extraStyle,children}){
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true)
  const[ref,inView]=useInView(); const fetched=useRef(false)
  useEffect(()=>{
    if(!inView||fetched.current)return; fetched.current=true; let cancelled=false
    fetchFn().then(l=>{if(!cancelled)setBooks(l)}).catch(()=>{}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[inView])
  if(!loading&&!books.length)return null
  return(
    <section className="home-section" style={extraStyle} ref={ref}>
      <SectionLabel eyebrow={eyebrow} title={title} accent={accent}>{children}</SectionLabel>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}

  //  PERSONALISED SECTIONS
function BecauseYouSection({seedBook,label,accent='#e06080',likedTitles,savedTitles}){
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true)
  const[ref,inView]=useInView('200px')
  useEffect(()=>{
    if(!inView||!seedBook?.title)return
    let cancelled=false; setLoading(true); setBooks([])
    const ctrl=new AbortController()
    const tid=setTimeout(()=>ctrl.abort(),14000)
    const seedGenre=(seedBook.genre||'').split(',')[0].trim().toLowerCase()
    const allOwned=new Set([seedBook.title,...likedTitles,...savedTitles].map(t=>t.toLowerCase()))
    async function load(){
      try{
        const r=await fetch(`${API_BASE}/recommend/title?title=${encodeURIComponent(seedBook.title)}&top_n=28`,{signal:ctrl.signal})
        if(r.ok){
          const d=await r.json()
          const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
            .filter(b=>!allOwned.has((b.title||'').toLowerCase()))
          if(list.length>=4){if(!cancelled)setBooks(list.slice(0,24));return}
        }
      }catch(e){if(e?.name==='AbortError')return}
      try{
        const r=await fetch(`${API_BASE}/recommend/hybrid?title=${encodeURIComponent(seedBook.title)}`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({liked_titles:[seedBook.title],saved_titles:[],top_n:28}),
          signal:ctrl.signal,
        })
        if(r.ok){
          const d=await r.json()
          const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
            .filter(b=>!allOwned.has((b.title||'').toLowerCase()))
          if(list.length>=4){if(!cancelled)setBooks(list.slice(0,24));return}
        }
      }catch(e){if(e?.name==='AbortError')return}
      const seedDesc=(seedBook.description||'').replace(/<[^>]+>/g,'').trim()
      if(seedDesc.length>40){
        try{
          const r=await fetch(`${API_BASE}/recommend/description`,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({description:seedDesc.slice(0,300),liked_titles:[seedBook.title],saved_titles:[],top_n:28}),
            signal:ctrl.signal,
          })
          if(r.ok){
            const d=await r.json()
            const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]))
              .filter(b=>!allOwned.has((b.title||'').toLowerCase()))
            if(list.length>=4){if(!cancelled)setBooks(list.slice(0,24));return}
          }
        }catch(e){if(e?.name==='AbortError')return}
      }
      if(seedGenre){
        try{
          const list=await fetchGenre(seedGenre,28,ctrl.signal)
          if(!cancelled)setBooks(
            dedupBooks(list).filter(b=>!allOwned.has((b.title||'').toLowerCase())).slice(0,24)
          )
        }catch(e){if(e?.name==='AbortError')return}
      }
    }
    load().catch(()=>{}).finally(()=>{clearTimeout(tid);if(!cancelled)setLoading(false)})
    return()=>{cancelled=true;clearTimeout(tid);ctrl.abort()}
  },[inView,seedBook?.title])
  if(!seedBook)return null
  return(
    <section className="home-section" ref={ref}>
      <div className="hs-header">
        <div>
          <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:accent,letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 3px'}}>{label}</p>
          <h3 className="hs-title" style={{color:'var(--marron)'}}>{seedBook.title}</h3>
        </div>
        {seedBook.authors&&(
          <p style={{fontFamily:'Montaga,serif',fontSize:11,color:'var(--text-muted)',margin:0,alignSelf:'center',flexShrink:0}}>
            by {seedBook.authors.split(',')[0].trim()}
          </p>
        )}
      </div>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}
function YouMightLike({likedBooks,savedBooks,readBooks,wishlistBooks}){
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true)
  const likedTitles = useMemo(()=>likedBooks.map(b=>b.title).filter(Boolean),[likedBooks])
  const savedTitles = useMemo(()=>savedBooks.map(b=>b.title).filter(Boolean),[savedBooks])
  const wishTitles = useMemo(()=>(wishlistBooks||[]).map(b=>b.title).filter(Boolean),[wishlistBooks])
  const readTitles = useMemo(()=>(readBooks||[]).map(b=>b.title).filter(Boolean),[readBooks])
  const allOwned = useMemo(()=>new Set([...likedTitles,...savedTitles,...wishTitles,...readTitles].map(t=>t.toLowerCase())),[likedTitles,savedTitles,wishTitles,readTitles])
  const hasAny = likedTitles.length>0||savedTitles.length>0||wishTitles.length>0||readTitles.length>0
  const topGenres = useMemo(()=>getTopGenres(6),[likedTitles.join(),savedTitles.join()])
  const tasteLabel = useMemo(()=>{
    const freq={}
    ;[...likedBooks,...savedBooks,...(wishlistBooks||[]),...(readBooks||[])].forEach(b=>{
      (b.genre||'').split(',').map(g=>g.trim().toLowerCase()).filter(Boolean).forEach(g=>{freq[g]=(freq[g]||0)+1})
    })
    return Object.entries(freq).sort((a,b)=>b[1]-a[1])[0]?.[0]||null
  },[likedBooks,savedBooks,wishlistBooks,readBooks])
  useEffect(()=>{
    let cancelled=false; setLoading(true)
    const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),14000)
    async function load(){
      if(!hasAny){
        const list=await fetchTrending(28)
        if(!cancelled)setBooks(dedupBooks(list))
        return
      }
      try{
        const list=await fetchSaved({
          liked:likedTitles.slice(0,8),
          saved:[...wishTitles,...savedTitles].slice(0,8),
          read:readTitles.slice(0,5),
          user_genres:topGenres,
          top_n:32,
          user_action:'you_might_like',
        },ctrl.signal)
        if(list.length>=4){
          if(!cancelled)setBooks(dedupBooks(list).filter(b=>!allOwned.has((b.title||'').toLowerCase())))
          return
        }
      }catch(e){if(e?.name==='AbortError')return}
      if(topGenres[0]){
        try{
          const list=await fetchGenre(topGenres[0],28,ctrl.signal)
          if(!cancelled)setBooks(dedupBooks(list).filter(b=>!allOwned.has((b.title||'').toLowerCase())))
          return
        }catch(e){if(e?.name==='AbortError')return}
      }
      const list=await fetchTrending(28)
      if(!cancelled)setBooks(dedupBooks(list).filter(b=>!allOwned.has((b.title||'').toLowerCase())))
    }
    load().catch(()=>{}).finally(()=>{clearTimeout(tid);if(!cancelled)setLoading(false)})
    return()=>{cancelled=true;clearTimeout(tid);ctrl.abort()}
  },[likedTitles.join('|'),savedTitles.join('|'),wishTitles.join('|')])
  if(!loading&&!books.length)return null
  return(
    <section className="home-section">
      <SectionLabel eyebrow="Smart Picks" title="You Might Like" accent="var(--gold)">
        {tasteLabel&&<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,color:'var(--gold)',background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.25)',borderRadius:20,padding:'2px 10px',textTransform:'capitalize'}}>{tasteLabel}</span>}
      </SectionLabel>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}

  //  POPULAR NOW
const POPULAR_SEARCHES = [
  "harry potter sorcerer's stone", 'sherlock holmes', 'pride and prejudice','jane austen sense sensibility', 'to kill a mockingbird', 'the great gatsby','lord of the rings', 'agatha christie murder orient express','game of thrones', 'dune frank herbert', '1984 george orwell','the alchemist paulo coelho', 'little women', 'jane eyre charlotte bronte',
  'gone with the wind', 'the count of monte cristo', 'les miserables','crime and punishment dostoevsky', 'war and peace tolstoy','wuthering heights emily bronte', 'great expectations dickens','the catcher in the rye', 'of mice and men steinbeck','the hobbit tolkien', 'brave new world huxley',
]

const _BLOCK_POPULAR = [
  'harry potter boxed','harry potter collection','harry potter books 1','lord of the rings art','lord of the rings box','jrr tolkien 4book','complete works','collected works','boxed set','box set','omnibus',
]
function _cleanPopular(list) {
  const seen = new Set()
  return (list||[]).filter(b => {
    const k = (b.title||'').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    if (_BLOCK_POPULAR.some(bl => k.includes(bl))) return false
    seen.add(k); return true
  })
}

function PopularNowSection({onNav}){
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true); const fetched=useRef(false)
  useEffect(()=>{
    if(fetched.current)return; fetched.current=true
    const ck='popular_now_v3'
    const cached=_cGet(ck); if(cached){setBooks(cached);setLoading(false);return}
    async function load(){
      const seen=new Set(); const results=[]
      await Promise.allSettled(POPULAR_SEARCHES.map(async term=>{
        try{
          const r=await fetch(`${API_BASE}/search?query=${encodeURIComponent(term)}&limit=3`)
          if(!r.ok)return; const d=await r.json()
          ;(Array.isArray(d)?d:(d?.books||d?.results||[])).forEach(b=>{
            const k=(b.title||'').toLowerCase()
            if(!seen.has(k)&&b.title){seen.add(k);results.push(b)}
          })
        }catch{}
      }))
      try{
        const d=await apiFetch(`${API_BASE}/trending?top_n=100`)
        ;(Array.isArray(d)?d:[]).forEach(b=>{
          const k=(b.title||'').toLowerCase()
          if(!seen.has(k)&&b.title){seen.add(k);results.push(b)}
        })
      }catch{}
      results.sort((a,b)=>(Number(b.average_rating)||0)-(Number(a.average_rating)||0))
      const deduped=fixCovers(_cleanPopular(results)).slice(0,24)
      _cSet(ck,deduped); setBooks(deduped); setLoading(false)
    }
    load().catch(()=>setLoading(false))
  },[])
  if(!loading&&!books.length)return null
  return(
    <section className="home-section">
      <SectionLabel eyebrow="All Time Favourites" title="Most Popular Books">
        <button className="hs-link" onClick={()=>onNav('trending')}>See More →</button>
      </SectionLabel>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}
  //  RIGHT NOW
function RightNow(){
  const slot=useMemo(()=>getTsSlot(),[])
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true)
  const[ref,inView]=useInView(); const fetched=useRef(false)
  useEffect(()=>{
    if(!inView||fetched.current)return; fetched.current=true
    let cancelled=false
    fetchMood(slot.mood,{top_n:24,use_llm:false,context:{time_of_day:slot.slot},user_genres:slot.genres||[]})
      .then(l=>{if(!cancelled)setBooks(l)}).catch(()=>{}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[inView,slot.slot])
  if(!loading&&!books.length)return null
  return(
    <section className="home-section time-rec-section" ref={ref}>
      <div className="ts-banner"><div className="ts-text"><p className="ts-eyebrow">Right Now</p><h3 className="ts-title">{slot.label}</h3><p className="ts-sub">{slot.sub}</p></div></div>
      <div className="hs-header" style={{paddingTop:18}}><h3 className="hs-title">Books for this moment</h3></div>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}
  //  MOOD SECTION
function MoodSection({isLight}){
  const hour=new Date().getHours()
  const def=hour<8?'reflective':hour<12?'intellectual':hour<17?'adventurous':hour<21?'cosy':'dreamy'
  const[active,setActive]=useState(def)
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(false)
  const[ref,inView]=useInView(); const cache=useRef({})
  const m=MOOD_DATA[active]||MOOD_DATA.happy
  const accent=isLight?hexDarken(m.accent,0.7):m.accent
  useEffect(()=>{
    if(!inView)return
    if(cache.current[active]){setBooks(cache.current[active]);return}
    let cancelled=false; setLoading(true)
    const _moodBlock={
      happy:['horror','sci-fi','philosophy','manga','graphic'],
      sad:['comedy','humor','sci-fi','manga','graphic'],
      adventurous:['romance-novel','chick-lit','non-fiction','philosophy','manga'],
      romantic:['horror','thriller','crime','mystery','sci-fi','manga','graphic','stephen king','king stephen','james patterson'],
      dark:['comedy','humor','romance-novel','chick-lit','children','self-help'],
      cosy:['horror','sci-fi','thriller','philosophy','manga'],
      intellectual:['romance-novel','chick-lit','comedy','horror','manga'],
      tense:['romance-novel','chick-lit','comedy','humor','self-help','children'],
      dreamy:['non-fiction','biography','history','sci-fi','children','manga'],
      hopeful:['horror','sci-fi','philosophy','economics','manga'],
      funny:['horror','sci-fi','philosophy','non-fiction','biography','romance-novel','manga'],
      reflective:['sci-fi','horror','comedy','humor','manga','children'],
    }
    const blockList=_moodBlock[m.key]||[]
    fetchMood(m.key,{top_n:32,use_llm:false,user_genres:m.genres||[]})
      .then(l=>{
        if(cancelled)return
        const filtered=dedupBooks(l).filter(b=>{
          const g=(b.genre||'').toLowerCase()
          const a=(b.authors||'').toLowerCase()
          const t=(b.title||'').toLowerCase()
          if(blockList.some(bl=>g.includes(bl)||a.includes(bl)||t.includes(bl)))return false
          return true
        }).slice(0,24)
        cache.current[active]=filtered.length>=4?filtered:dedupBooks(l).slice(0,24)
        setBooks(cache.current[active])
      })
      .catch(()=>{}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[inView,active])
  return(
    <section className="home-section mood-rec-section" id="moodSection" ref={ref}>
      <div className="mood-banner">
        <div className="mood-icon-pill" style={{width:56,height:56,borderRadius:16,background:`${accent}20`,border:`1.5px solid ${accent}60`,display:'flex',alignItems:'center',justifyContent:'center',color:accent,flexShrink:0,boxShadow:`0 4px 18px ${accent}28`}}>
          {m.icon}
        </div>
        <div className="mood-text">
          <p className="mood-eyebrow" style={{color:accent}}>Reading by Mood</p>
          <h3 className="mood-title">{m.label}</h3>
          <p className="mood-desc">{m.desc}</p>
        </div>
      </div>
      <div className="mood-pills">
        {Object.entries(MOOD_DATA).map(([key,md])=>{
          const a=isLight?hexDarken(md.accent,0.7):md.accent
          const isActive=active===key
          return(
            <button key={key} className={`mood-pill${isActive?' active':''}`}
              onClick={()=>setActive(key)}
              style={isActive?{borderColor:a,background:`${a}20`,color:a,boxShadow:`0 2px 10px ${a}28`}:{}}>
              <span style={{display:'inline-flex',alignItems:'center',gap:5,verticalAlign:'middle'}}>
                <span style={{display:'inline-flex',transform:'scale(0.85)',opacity:isActive?1:0.6,color:isActive?a:'currentColor'}}>{md.icon}</span>
                {md.label}
              </span>
            </button>
          )
        })}
      </div>
      <div className="hs-header" style={{paddingTop:12}}>
        <h3 className="hs-title">{m.label}</h3>
      </div>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}
function SeasonSection({ isLight }) {
  const [active, setActive] = useState(detectSeason)
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [ref, inView] = useInView()
  const cache = useRef({})
 
  function termsHash(sd) {
    const terms = (sd.searchTerms || []).join('|')
    let h = 0
    for (let i = 0; i < terms.length; i++) {
      h = ((h << 5) - h + terms.charCodeAt(i)) | 0
    }
    return (h >>> 0).toString(36)
  }
  async function fetchSeasonBooks(key) {
    const sd = SEASON_DATA[key]
    const cacheKey = `season_${key}_${termsHash(sd)}`
    // 1. Check sessionStorage cache (busts automatically when terms change)
    const cached = _cGet(cacheKey)
    if (cached && cached.length > 0) {
      cache.current[key] = cached
      return cached
    }
    const seen = new Set()
    let results = []
    function absorb(list) {
      ;(list || []).forEach(b => {
        const k = (b.title || '').toLowerCase().trim()
        if (k && !seen.has(k)) { seen.add(k); results.push(b) }
      })
    }
    // 2. Search each term individually (all seasons)
    if (sd.searchTerms && sd.searchTerms.length > 0) {
      await Promise.allSettled(
        sd.searchTerms.map(async term => {
          try {
            const r = await fetch(
              `${API_BASE}/search?query=${encodeURIComponent(term.trim())}&limit=4`
            )
            if (!r.ok) return
            const d = await r.json()
            absorb(Array.isArray(d) ? d : d?.books || d?.results || [])
          } catch {}
        })
      )
    }
    // 3. Top-up with mood fetch if we don't have enough yet
    if (results.length < 12) {
      try {
        const moodResults = await fetchMood(
          sd.query || sd.mood,
          {top_n: 32,use_llm: false,context: { season: sd.contextVal },user_genres: sd.genres || [],}
        )
        absorb(moodResults)
      } catch {}
    }
    // 4. Final genre fallback
    if (results.length < 8 && sd.genres?.[0]) {
      try {
        const genreResults = await fetchGenre(sd.genres[0], 24)
        absorb(genreResults)
      } catch {}
    }
    const final = dedupBooks(results).slice(0, 24)
    // Save to sessionStorage cache with the versioned key
    _cSet(cacheKey, final)
    cache.current[key] = final
    return final
  }
 
  useEffect(() => {
    if (!inView) return
    let cancelled = false
    async function load() {
      if (cache.current[active]) {
        setBooks(cache.current[active])
        setLoading(false)
      } else {
        setLoading(true)
      }
      const data = await fetchSeasonBooks(active)
      if (!cancelled) {
        setBooks(data)
        setLoading(false)
      }
    }
    load()
    Object.keys(SEASON_DATA).forEach(key => {
      if (key !== active) {
        setTimeout(() => fetchSeasonBooks(key), 1200)
      }
    })
    return () => { cancelled = true }
  }, [inView, active])
 
  const SEASON_ICONS = {
    summer: (
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
        <circle cx="18" cy="18" r="7" fill="currentColor" opacity="0.9" />
        <circle cx="18" cy="18" r="5" fill="currentColor" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
          const r = Math.PI * deg / 180
          const x1 = 18 + 10 * Math.cos(r), y1 = 18 + 10 * Math.sin(r)
          const x2 = 18 + 14 * Math.cos(r), y2 = 18 + 14 * Math.sin(r)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        })}
        <path d="M4 28 Q10 22 18 26 Q26 30 32 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.6" />
      </svg>
    ),
    spring: (
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
        <path d="M18 32 L18 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="13" cy="11" rx="5" ry="7" fill="currentColor" opacity="0.75" transform="rotate(-20 13 11)" />
        <ellipse cx="23" cy="11" rx="5" ry="7" fill="currentColor" opacity="0.75" transform="rotate(20 23 11)" />
        <ellipse cx="18" cy="8" rx="4" ry="6" fill="currentColor" opacity="0.9" />
        <circle cx="18" cy="8" r="2.5" fill="currentColor" opacity="0.5" />
        <path d="M10 28 Q14 24 18 26 Q22 28 26 25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.5" />
      </svg>
    ),
    rainy: (
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
        <path d="M28 20A7 7 0 0 0 22 8h-1.5A10 10 0 1 0 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        <line x1="11" y1="25" x2="9" y2="31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="18" y1="24" x2="16" y2="31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="25" y1="25" x2="23" y2="31" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
    fall: (
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
        <path d="M18 32 C18 32 6 24 6 14 A12 12 0 0 1 18 4 A10 10 0 0 0 30 10 C32 16 30 24 18 32Z"
          fill="currentColor" opacity="0.85" />
        <path d="M4 30 C6 26 10 22 14 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="22" cy="14" r="2" fill="currentColor" opacity="0.4" />
        <circle cx="16" cy="18" r="1.5" fill="currentColor" opacity="0.35" />
      </svg>
    ),
    winter: (
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
        <line x1="18" y1="3" x2="18" y2="33" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="3" y1="18" x2="33" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="7" y1="7" x2="29" y2="29" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="29" y1="7" x2="7" y2="29" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <polyline points="13,8 18,3 23,8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <polyline points="13,28 18,33 23,28" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <polyline points="8,13 3,18 8,23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <polyline points="28,13 33,18 28,23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="18" cy="18" r="3" fill="currentColor" />
      </svg>
    ),
  }
  const s = SEASON_DATA[active]
  const bg = isLight ? s.bgLight : s.bgDark
  const accent = isLight ? s.accentLight : s.accentDark
  return (
    <section id="seasonSection" style={{ paddingBottom: 8, background: bg, transition: 'background 0.8s ease' }} ref={ref}>
      <div className="season-banner">
        <div style={{
          width: 58, height: 58, borderRadius: 18,
          background: `${accent}22`, border: `1.5px solid ${accent}60`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent, flexShrink: 0, boxShadow: `0 4px 18px ${accent}30`,
        }}>
          {SEASON_ICONS[active]}
        </div>
        <div className="season-text">
          <p className="season-eyebrow" style={{ color: accent }}>Reading by Season</p>
          <h3 className="season-title" style={{ color: isLight ? accent : '#fff' }}>{s.label} Reads</h3>
          <p className="season-desc" style={{ color: isLight ? `${accent}cc` : 'rgba(255,255,255,0.65)' }}>{s.desc}</p>
        </div>
      </div>
 
      <div className="season-pills">
        {Object.entries(SEASON_DATA).map(([key, sd]) => {
          const a = isLight ? sd.accentLight : sd.accentDark
          const isActive = active === key
          return (
            <button
              key={key}
              className={`season-pill${isActive ? ' active' : ''}`}
              onClick={() => setActive(key)}
              style={isActive ? { borderColor: a, color: a, background: `${a}22`, boxShadow: `0 2px 10px ${a}30` } : {}}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                color: 'currentColor', opacity: 0.7,
                transform: 'scale(0.75)', verticalAlign: 'middle',
              }}>
                {SEASON_ICONS[key]}
              </span>
              {sd.label}
            </button>
          )
        })}
      </div>
 
      <div className="hs-header" style={{ paddingTop: 6, position: 'relative', zIndex: 1 }}>
        <h3 className="hs-title" style={{ color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,.4)' }}>
          Books for This Season
        </h3>
      </div>
      <BookShelf books={books} loading={loading} />
    </section>
  )
}
  //  WEEKEND GATEWAY
function WeekendGateway(){
  const[active,setActive]=useState('quick')
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(false)
  const[ref,inView]=useInView(); const cache=useRef({})
  const bucket=WEEKEND_BUCKETS.find(b=>b.id===active)||WEEKEND_BUCKETS[0]
  useEffect(()=>{
    if(!inView)return
    if(cache.current[active]){setBooks(cache.current[active]);return}
    let cancelled=false; setLoading(true)
    fetchMood(bucket.mood||bucket.key,{top_n:18,use_llm:false,context:{reading_time:bucket.key}})
      .then(l=>{if(cancelled)return;cache.current[active]=l;setBooks(l)})
      .catch(()=>{}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[inView,active])
  return(
    <section className="home-section" id="wgSection" ref={ref}>
      <div className="wg-banner"><div className="wg-banner-left"><div className="wg-banner-text"><p className="wg-banner-eyebrow">Weekend Gateway</p><h3 className="wg-banner-title" style={{color:bucket.accent}}>{bucket.label}</h3><p className="wg-banner-sub">{bucket.sub}</p></div></div></div>
      <div className="wg-tabs">
        {WEEKEND_BUCKETS.map(b=>{const isActive=active===b.id;return(
          <button key={b.id} className={`wg-tab${isActive?' active':''}`} onClick={()=>setActive(b.id)} style={isActive?{borderColor:b.accent,background:`${b.accent}18`,color:b.accent}:{}}>
            <span className="wg-tab-label" style={isActive?{color:b.accent}:{}}>{b.label}</span>
            <span className="wg-tab-sub">{b.sub}</span>
          </button>
        )})}
      </div>
      <div className="hs-header" style={{paddingTop:8}}><h3 className="hs-title">Pick Your Reading Window</h3></div>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}

  //  TRAVEL SECTION
function TravelSection(){
  const[active,setActive]=useState('flight')
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(false)
  const[ref,inView]=useInView(); const cache=useRef({})
  const tab=TRAVEL_TABS.find(t=>t.id===active)||TRAVEL_TABS[0]
  function fetchTab(t){
    if(cache.current[t.id]!==undefined)return
    cache.current[t.id]=null
    fetchMood(t.mood,{top_n:28,use_llm:false,context:{travel:t.contextVal},user_genres:t.genres||[]})
      .then(raw=>{
        cache.current[t.id]=dedupBooks(raw).slice(0,20)
        if(t.id===active){setBooks(cache.current[t.id]);setLoading(false)}
      })
      .catch(()=>{cache.current[t.id]=[];if(t.id===active)setLoading(false)})
  }
  useEffect(()=>{
    if(!inView)return
    const t=TRAVEL_TABS.find(x=>x.id===active)||TRAVEL_TABS[0]
    if(cache.current[active]!=null){setBooks(cache.current[active]);setLoading(false)}
    else{setLoading(true);fetchTab(t)}
    TRAVEL_TABS.forEach(x=>{if(x.id!==active)setTimeout(()=>fetchTab(x),800)})
  },[inView])
  useEffect(()=>{
    if(!inView)return
    if(cache.current[active]!=null){setBooks(cache.current[active]);setLoading(false);return}
    const t=TRAVEL_TABS.find(x=>x.id===active)||TRAVEL_TABS[0]
    setLoading(true); fetchTab(t)
  },[active])
  return(
    <section className="home-section" id="travelSection" ref={ref}>
      <div className="travel-banner"><div className="travel-text"><p className="travel-eyebrow">Travel Companions</p><h3 className="travel-title">Books for Every Journey</h3><p className="travel-subtitle">The perfect read for wherever you're headed</p></div></div>
      <div className="travel-tabs">
        {TRAVEL_TABS.map(t=><button key={t.id} className={`tv-tab${active===t.id?' active':''}`} onClick={()=>setActive(t.id)}><span className="tv-tab-label">{t.label}</span><span className="tv-tab-sub">{t.sub}</span></button>)}
      </div>
      <div className="hs-header" style={{paddingTop:4}}><div><span className="travel-current-label">{tab.label}</span><span style={{marginLeft:10,fontSize:11,color:'var(--text-muted)'}}>{tab.sub}</span></div></div>
      <BookShelf books={books} loading={loading}/>
    </section>
  )
}
  //  AUTHORS ROW
function AuthorsRow({onNav,onAuthor}){
  return(
    <section className="home-section home-section-dark">
      <div className="hs-header"><h3 className="hs-title">Top Authors</h3><button className="hs-link" onClick={()=>onNav('author')}>See All</button></div>
      <div className="authors-scroll-wrap"><div className="authors-row">
        {FEATURED_AUTHORS.map(a=>(
          <div key={a.name} className="author-card" onClick={()=>onAuthor(a.name)} style={{cursor:'pointer'}}>
            <div className="author-avatar">
              <AuthorImg src={a.img} name={a.name} style={{width:'100%',height:'100%',borderRadius:'50%',display:'block'}}/>
            </div>
            <div className="author-card-info"><span className="author-card-name">{a.name}</span><span className="author-card-books">Author</span></div>
          </div>
        ))}
      </div></div>
    </section>
  )
}
  //  CATEGORIES GRID
function CategoryCard({cat, onSearch, onGenre}){
  const[imgFailed,setImgFailed]=useState(false)
  const[hov,setHov]=useState(false)
  return(
    <div className={`category-card ${cat.cls}`} onClick={()=> onGenre ? onGenre(cat.query) : onSearch(cat.query)}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        cursor:'pointer', position:'relative', borderRadius:14,
        overflow:'hidden',
        minHeight:160,
        height:160,
        display:'flex', alignItems:'flex-end',
        transform:hov?'translateY(-5px)':'none',
        transition:'transform 0.25s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s ease',
        boxShadow:hov?'0 20px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)':'0 4px 16px rgba(0,0,0,0.35)',
        background: cat.color,
      }}>
      {cat.bookImg&&!imgFailed&&(
        <img src={cat.bookImg} alt={cat.book}
          onError={()=>setImgFailed(true)}
          style={{
            position:'absolute', inset:0, width:'100%', height:'100%',
            objectFit:'cover', objectPosition:'center top', zIndex:1,
            opacity: hov ? 0.65 : 0.5,
            transform: hov ? 'scale(1.10)' : 'scale(1.0)',
            transition:'transform 0.55s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease',
          }}/>
      )}
      <div style={{
        position:'absolute', inset:0, zIndex:2,
        background:'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.05) 100%)',
      }}/>
      <div style={{position:'relative', zIndex:3, padding:'10px 14px 14px'}}>
        <div style={{
          fontFamily:'Montserrat Alternates,sans-serif', fontSize:15, fontWeight:700,
          color:'#fff', letterSpacing:'.02em', marginBottom:3,
          textShadow:'0 2px 10px rgba(0,0,0,0.7)',
          transform: hov ? 'translateY(-2px)' : 'none',
          transition:'transform 0.25s ease',
        }}>{cat.name}</div>
        <div style={{
          fontFamily:'Montserrat Alternates,sans-serif', fontSize:8.5, fontWeight:600,
          color: hov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)',
          letterSpacing:'.18em', textTransform:'uppercase',
          transition:'color 0.25s ease',
        }}>Explore →</div>
      </div>
    </div>
  )
}
function CategoriesGrid({onSearch, onGenre}){
  return(
    <section className="home-section" style={{padding:'20px 0'}}>
      <div style={{padding:'0 28px 14px'}}>
        <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 4px'}}>Browse</p>
        <h3 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:20,fontWeight:700,color:'var(--cream)',margin:0}}>Discover by Categories</h3>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:14,padding:'0 28px 8px'}}>
        {CATEGORIES.map(cat=>(
          <CategoryCard key={cat.name} cat={cat} onSearch={onSearch} onGenre={onGenre}/>
        ))}
      </div>
    </section>
  )
}
//   RECENTLY VIEWED
function RecentlyViewed({books,onClear}){
  if(!books.length)return null
  return(<section className="home-section"><SectionLabel title="Recently Viewed"><button className="hs-link" onClick={onClear}>Clear</button></SectionLabel><BookRow books={books.slice(0,12)} loading={false}/></section>)
}
  //  SEARCH RESULTS
function SearchResultsPage({query,onOpen}){
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true)
  const normQ=(query||'').trim().toLowerCase()
  useEffect(()=>{
    if(!normQ)return; let cancelled=false; setLoading(true); setBooks([])
    const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),12000)
    async function run(){
      try{const r=await fetch(`${API_BASE}/search?query=${encodeURIComponent(normQ)}&limit=200`,{signal:ctrl.signal});if(r.ok){const d=await r.json();const l=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[]));if(l.length>=3){if(!cancelled){setBooks(l);setLoading(false)};return}}}catch(e){if(e?.name==='AbortError'){if(!cancelled)setLoading(false);return}}
      try{const l=await fetchMood(normQ,{top_n:40,use_llm:false},ctrl.signal);if(l.length>=3){if(!cancelled){setBooks(l);setLoading(false)};return}}catch(e){if(e?.name==='AbortError'){if(!cancelled)setLoading(false);return}}
      try{const l=await fetchHybrid({liked:[],saved:[],top_n:100,title:normQ},ctrl.signal);if(!cancelled)setBooks(l)}catch{}
      if(!cancelled)setLoading(false)
    }
    run().catch(()=>{if(!cancelled)setLoading(false)}).finally(()=>clearTimeout(tid))
    return()=>{cancelled=true;clearTimeout(tid);ctrl.abort()}
  },[normQ])
  return(
    <div style={{minHeight:'100%',background:'var(--bg)'}}>
      <div style={{padding:'28px 32px 20px',borderBottom:'1px solid rgba(201,168,76,0.08)',background:'linear-gradient(135deg,rgba(114,57,63,0.12) 0%,transparent 100%)'}}>
        <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,fontWeight:600,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 6px'}}>Search Results</p>
        <h2 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:24,fontWeight:700,color:'var(--cream)',margin:'0 0 4px'}}>"{query}"</h2>
        {!loading&&<p style={{fontFamily:'Montaga,serif',fontSize:13,color:'var(--text-muted)',margin:0}}>{books.length} books found</p>}
      </div>
      {loading?<div style={{display:'flex',justifyContent:'center',padding:'64px 0'}}><span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,color:'var(--text-muted)',letterSpacing:'.1em'}}>Searching…</span></div>
        :books.length===0?<div style={{textAlign:'center',padding:'64px 36px',fontFamily:'Montaga,serif',color:'var(--text-muted)',fontSize:14}}>No books found for "{query}".</div>
        :<div style={{padding:'24px 32px 48px'}}><BookRow books={books} loading={false} useGrid/></div>}
    </div>
  )
}
  //  NAVBAR
function Navbar({currentPage,onNav,onToggle,savedCount,wishCount,isLight,onTheme,userName,userInitial,onLogoClick,profileImageUrl}){
  const links=[{key:'home',label:'Home'},{key:'genre',label:'Genre'},{key:'author',label:'Author'},{key:'trending',label:'Trending'},{key:'foryou',label:'For You'},{key:'description',label:'Describe'}]
  return(
    <header className="navbar">
      <div className="navbar-left">
        <button className="nb-toggle" onClick={onToggle} style={{cursor:'pointer'}}><span/><span/><span/></button>
        <a href="#" className="nb-logo" onClick={e=>{e.preventDefault();onLogoClick?.()}}>
          <img src="/assets/rook.png" alt="ROOK" className="nb-rook-img" onError={e=>e.target.style.display='none'}/>
          <span className="nb-logo-text">ROOK</span>
        </a>
      </div>
      <nav className="nb-links">{links.map(l=><button key={l.key} className={`nb-link${currentPage===l.key?' active':''}`} onClick={()=>onNav(l.key)}>{l.label}</button>)}</nav>
      <div className="navbar-right">
        <div className="theme-toggle" onClick={()=>onTheme(!isLight)} style={{cursor:'pointer'}}>
          <div className="theme-track">
            <div className="theme-thumb" style={{transform:isLight?'translateX(20px)':'translateX(0)',background:isLight?'var(--maroon)':'var(--gold)',transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1),background 0.3s'}}>
              {isLight?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                :<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
            </div>
          </div>
        </div>
        <button className="nb-icon-btn" onClick={()=>onNav('wishlist')} title="Wishlist" style={{position:'relative'}}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          {wishCount>0&&<span className="nb-badge">{wishCount}</span>}
        </button>
        <button className="nb-icon-btn" onClick={()=>onNav('saved')} title="Saved" style={{position:'relative'}}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          {savedCount>0&&<span className="nb-badge">{savedCount}</span>}
        </button>
        <button className="nb-icon-btn nb-profile-btn" onClick={()=>onNav('profile')} title={userName||'Profile'}>
          <div className="nb-profile-avatar" style={{display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Montserrat Alternates,sans-serif',fontSize:13,fontWeight:700,color:'var(--gold)',overflow:'hidden',borderRadius:'50%'}}>
            {profileImageUrl
              ? <img src={profileImageUrl} alt={userName} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} onError={e=>e.target.style.display='none'}/>
              : (userInitial||'?')
            }
          </div>
        </button>
      </div>
    </header>
  )
}
  //  SIDEBAR
function Sidebar({isDesktop,sidebarOpen,sidebarCollapsed,onClose,onNav,onGenre,profileImageUrl,userName}){
  const[genreOpen,setGenreOpen]=useState(true); const[recOpen,setRecOpen]=useState(false)
  const isVisible=isDesktop||sidebarOpen; const isCollapsed=isDesktop&&sidebarCollapsed; const w=isCollapsed?62:230
  const SIDEBAR_GENRES=['fiction','fantasy','mystery','romance','thriller','science fiction','horror','biography','comedy','self-help']
  const navItems=[
    {key:'home', label:'Home', icon:<svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>},
    {key:'trending',label:'Trending', icon:<svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>},
    {key:'saved', label:'Saved Books', icon:<svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>},
    {key:'wishlist',label:'Wishlist', icon:<svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>},
    {key:'read', label:'Already Read', icon:<svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>},
    {key:'ratings', label:'Your Ratings', icon:<svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>},
  ]
  const initial = (userName||'R').charAt(0).toUpperCase()
  const hue = (userName||'Reader').split('').reduce((a,c)=>a+c.charCodeAt(0),0)%360
  return(
    <>
      {!isDesktop&&sidebarOpen&&<div onClick={onClose} style={{position:'fixed',inset:0,zIndex:299,background:'rgba(0,0,0,0.55)',backdropFilter:'blur(2px)',cursor:'pointer'}}/>}
      <aside style={{position:'fixed',top:0,left:0,width:w,height:'100vh',background:'var(--sidebar-bg)',borderRight:'1px solid rgba(201,168,76,0.08)',zIndex:300,overflowY:'auto',overflowX:'hidden',display:'flex',flexDirection:'column',transform:isVisible?'translateX(0)':'translateX(-100%)',transition:'transform 0.22s cubic-bezier(0.22,1,0.36,1),width 0.22s ease',scrollbarWidth:'thin'}}>
        <div className="sb-brand" style={{justifyContent:isCollapsed?'center':undefined}}>
          {!isCollapsed?<span className="sb-brand-name">ROOK</span>:<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontWeight:700,fontSize:16,color:'var(--gold)'}}></span>}
        </div>
        <div className="sb-profile" onClick={()=>onNav('profile')} style={{cursor:'pointer',justifyContent:isCollapsed?'center':undefined}}>
          <div className="sb-avatar" style={{overflow:'hidden',borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:`hsl(${hue},35%,28%)`,fontFamily:'Montserrat Alternates,sans-serif',fontSize:13,fontWeight:700,color:`hsl(${hue},55%,72%)`}}>
            {profileImageUrl
              ? <img src={profileImageUrl} alt={userName} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} onError={e=>e.target.style.display='none'}/>
              : initial
            }
          </div>
          {!isCollapsed&&<span className="sb-profile-lbl">{userName||'User Profile'}</span>}
        </div>
        <nav className="sb-nav">
          {navItems.map(item=>(
            <div key={item.key} className="sb-item" onClick={()=>onNav(item.key)} style={{cursor:'pointer',justifyContent:isCollapsed?'center':undefined,padding:isCollapsed?'12px':undefined}}>
              {item.icon}{!isCollapsed&&<span className="sb-label">{item.label}</span>}
            </div>
          ))}
          {!isCollapsed?(
            <>
              <div className={`sb-item sb-has-sub${recOpen?' open':''}`} onClick={()=>setRecOpen(o=>!o)} style={{cursor:'pointer'}}>
                <svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
                <span className="sb-label">Recommendation</span>
                <svg className="sb-chevron" viewBox="0 0 24 24" style={{transform:recOpen?'rotate(180deg)':'none',transition:'transform 0.25s'}}><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <ul className={`sb-sub${recOpen?' open':''}`}>
                <li onClick={()=>onNav('foryou')} style={{cursor:'pointer'}}>For You</li>
                <li onClick={()=>onNav('description')} style={{cursor:'pointer'}}>By Description</li>
                <li onClick={()=>onNav('hybrid')} style={{cursor:'pointer'}}>Hybrid</li>
              </ul>
              <div className={`sb-item sb-has-sub${genreOpen?' open':''}`} onClick={()=>setGenreOpen(o=>!o)} style={{cursor:'pointer'}}>
                <svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                <span className="sb-label">Genre Categories</span>
                <svg className="sb-chevron" viewBox="0 0 24 24" style={{transform:genreOpen?'rotate(180deg)':'none',transition:'transform 0.25s'}}><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <ul className={`sb-sub${genreOpen?' open':''}`}>
                {SIDEBAR_GENRES.map(g=><li key={g} onClick={()=>onGenre(g)} style={{cursor:'pointer'}}>{g.charAt(0).toUpperCase()+g.slice(1)}</li>)}
              </ul>
            </>
          ):(
            <>
              <div className="sb-item" onClick={()=>onNav('foryou')} style={{cursor:'pointer',justifyContent:'center',padding:'12px'}}>
                <svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
              </div>
              <div className="sb-item" onClick={()=>setGenreOpen(o=>!o)} style={{cursor:'pointer',justifyContent:'center',padding:'12px'}}><svg className="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></div>
            </>
          )}
        </nav>
      </aside>
    </>
  )
}

  //  LIBRARY PAGE
function LibraryPage({title,books,accent,onClearAll,emptyMsg}){
  const[q,setQ]=useState('')
  const filtered=q.trim()?books.filter(b=>(b.title||'').toLowerCase().includes(q.toLowerCase())||(b.authors||'').toLowerCase().includes(q.toLowerCase())):books
  return(
    <div style={{minHeight:'100%',background:'var(--bg)'}}>
      <div style={{display:'flex',alignItems:'center',gap:16,padding:'14px 28px',borderBottom:'1px solid rgba(201,168,76,0.08)',background:'var(--bg2)'}}>
        <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:700,letterSpacing:'.18em',textTransform:'uppercase',color:accent,whiteSpace:'nowrap'}}>{title}</span>
        <div style={{position:'relative',flex:1,maxWidth:460}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} style={{width:'100%',padding:'9px 40px 9px 16px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(201,168,76,0.18)',borderRadius:30,color:'var(--text)',fontFamily:'Montaga,serif',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 28px 8px'}}>
        <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:700,letterSpacing:'.18em',textTransform:'uppercase',color:accent}}>{books.length>0?`${books.length} Book${books.length!==1?'s':''}`:''}</span>
        {books.length>0&&<button onClick={onClearAll} style={{padding:'7px 18px',background:'transparent',border:'1px solid rgba(114,57,63,0.5)',borderRadius:6,color:'var(--text-dim)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,fontWeight:600,letterSpacing:'.12em',textTransform:'uppercase',cursor:'pointer'}}>Clear All</button>}
      </div>
      {filtered.length===0?<div style={{padding:'80px 36px',textAlign:'center'}}><p style={{fontFamily:'Montaga,serif',fontSize:14,color:'var(--text-muted)'}}>{q?'No books match.':emptyMsg}</p></div>:<BookRow books={filtered} loading={false} useGrid/>}
    </div>
  )
}

  //  PROFILE PAGE
function ProfilePage({
  savedBooks, likedBooks, wishlistBooks, recentBooks, readBooks,
  onNav, onLogout, userName, profileImageUrl, onImageUploaded, onNameSaved
}) {
  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem('rook_user') || '{}') }
    catch { return {} }
  }
  const storedUser = getStoredUser()
  const displayName = userName || storedUser.username || storedUser.name || storedUser.email || 'Reader'
  const profileKeyName = `rook_name_${storedUser.username || storedUser.email || 'guest'}`
  const profileKeyBio = `rook_bio_${storedUser.username || storedUser.email || 'guest'}`
  const [name, setName] = useState(() => localStorage.getItem(profileKeyName) || displayName)
  const [bio, setBio] = useState(() => localStorage.getItem(profileKeyBio) || '')
  const [saved2, setSaved2] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  function getRawUrl() {
    const fromProp = (profileImageUrl || '').split('?')[0]
    if (fromProp) return fromProp
    const fromCache = (localStorage.getItem('rook_profile_image') || '').split('?')[0]
    if (fromCache) return fromCache
    const fromUser = (getStoredUser().image_url || '')
    return fromUser ? makeAbsoluteImageUrl(fromUser).split('?')[0] : ''
  }
  const [localImageUrl, setLocalImageUrl] = useState(() => { const raw = getRawUrl(); return raw ? `${raw}?t=${Date.now()}` : '' })
  useEffect(() => { const newBase = (profileImageUrl || '').split('?')[0]; if (!newBase) return; setLocalImageUrl(`${newBase}?t=${Date.now()}`) }, [profileImageUrl])
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef(null)
  function triggerUpload() { if (uploadLoading) return; if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click() } }
  async function handleImageUpload(e) {
    const file = e.target.files?.[0]; if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['jpg','jpeg','png','webp'].includes(ext)) { setUploadError('Please choose a jpg, png, or webp file.'); return }
    if (file.size > 5 * 1024 * 1024) { setUploadError('File too large — maximum size is 5 MB.'); return }
    setUploadError(''); setUploadLoading(true)
    try {
      const freshUser = getStoredUser(); const userId = freshUser.id || storedUser.id
      if (!userId) throw new Error('No user ID found. Please log in again.')
      const token = localStorage.getItem('rook_access_token')
      if (!token || token.trim() === '') throw new Error('Session expired. Please log out and log back in.')
      const form = new FormData(); form.append('file', file)
      const r = await fetch(`${API_BASE}/users/${userId}/upload-image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
      const responseText = await r.text()
      if (r.status === 401) { localStorage.removeItem('rook_access_token'); throw new Error('Session expired. Please log out and log back in.') }
      if (!r.ok) { let errMsg = 'Upload failed'; try { errMsg = JSON.parse(responseText).detail || errMsg } catch {}; throw new Error(errMsg) }
      const data = JSON.parse(responseText); const raw = data?.image_url
      if (!raw) throw new Error('No image URL returned from server')
      const absoluteBase = makeAbsoluteImageUrl(raw).split('?')[0]; const cacheBusted = `${absoluteBase}?t=${Date.now()}`
      localStorage.setItem('rook_profile_image', cacheBusted)
      const userToUpdate = getStoredUser(); userToUpdate.image_url = raw; localStorage.setItem('rook_user', JSON.stringify(userToUpdate))
      setLocalImageUrl(cacheBusted); onImageUploaded?.(cacheBusted)
    } catch (err) { setUploadError(err.message || 'Upload failed. Please try again.') }
    finally { setUploadLoading(false) }
  }
  const topGenres = useMemo(() => {
    const freq = {}
    likedBooks.forEach(b => (b.genre||'').split(',').map(g=>g.trim()).filter(Boolean).forEach(g=>{freq[g]=(freq[g]||0)+3}))
    readBooks.forEach(b => (b.genre||'').split(',').map(g=>g.trim()).filter(Boolean).forEach(g=>{freq[g]=(freq[g]||0)+2}))
    savedBooks.forEach(b => (b.genre||'').split(',').map(g=>g.trim()).filter(Boolean).forEach(g=>{freq[g]=(freq[g]||0)+1}))
    wishlistBooks.forEach(b => (b.genre||'').split(',').map(g=>g.trim()).filter(Boolean).forEach(g=>{freq[g]=(freq[g]||0)+1}))
    return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([g,cnt])=>({genre:g,count:cnt}))
  }, [likedBooks,savedBooks,readBooks,wishlistBooks])
  const totalBooks = savedBooks.length + likedBooks.length + wishlistBooks.length + readBooks.length
  const topAuthor = useMemo(() => { const freq = {}; ;[...likedBooks,...readBooks,...savedBooks].forEach(b=>{const a=(b.authors||'').split(',')[0].trim();if(a)freq[a]=(freq[a]||0)+1}); return Object.entries(freq).sort((a,b)=>b[1]-a[1])[0]?.[0]||null }, [likedBooks,readBooks,savedBooks])
  const avgRating = useMemo(() => { const rated = [...likedBooks,...readBooks,...savedBooks].filter(b=>b.average_rating>0); if(!rated.length) return null; return (rated.reduce((s,b)=>s+Number(b.average_rating),0)/rated.length).toFixed(1) }, [likedBooks,readBooks,savedBooks])
  function saveProfile() {
    const kName = `rook_name_${storedUser.username || storedUser.email || 'guest'}`
    const kBio = `rook_bio_${storedUser.username || storedUser.email || 'guest'}`
    localStorage.setItem(kName, name)
    localStorage.setItem(kBio, bio)
    onNameSaved?.(name)
    setSaved2(true)
    setTimeout(()=>setSaved2(false), 2500)
  }
  const initial = (name||displayName).charAt(0).toUpperCase()
  const hue = (name||displayName).split('').reduce((a,c)=>a+c.charCodeAt(0),0)%360
  const loginEmail = storedUser.email || ''; const loginUsername = storedUser.username || ''
  const TABS = [{id:'overview',label:'Overview'},{id:'settings',label:'Settings'}]
  const infoRow = (label, val) => val ? (<div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid rgba(201,168,76,0.06)'}}><span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,fontWeight:600,color:'var(--text-muted)',letterSpacing:'.12em',textTransform:'uppercase',minWidth:90}}>{label}</span><span style={{fontFamily:'Montaga,serif',fontSize:13,color:'var(--text)'}}>{val}</span></div>) : null
  return (
    <div style={{minHeight:'100%',background:'var(--bg)',overflowY:'auto'}}>
      <div style={{position:'relative',background:'linear-gradient(135deg,rgba(80,10,20,0.95) 0%,rgba(30,5,5,0.98) 100%)',borderBottom:'1px solid rgba(201,168,76,0.12)',overflow:'hidden',padding:'40px 36px 32px'}}>
        <div style={{position:'absolute',inset:0,opacity:0.04,backgroundImage:'radial-gradient(circle at 20% 50%, #c9a84c 1px, transparent 1px)',backgroundSize:'40px 40px',pointerEvents:'none'}}/>
        <div style={{position:'relative',display:'flex',alignItems:'center',gap:28,flexWrap:'wrap'}}>
          <div style={{position:'relative',flexShrink:0}}>
            <div style={{width:96,height:96,borderRadius:'50%',background:localImageUrl?'transparent':`linear-gradient(135deg,hsl(${hue},45%,28%),hsl(${hue+30},55%,38%))`,border:'3px solid rgba(201,168,76,0.4)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Montserrat Alternates,sans-serif',fontSize:38,fontWeight:700,color:'#fff',boxShadow:'0 0 0 6px rgba(201,168,76,0.08), 0 8px 32px rgba(0,0,0,0.5)',overflow:'hidden',cursor:'pointer',position:'relative'}} onClick={triggerUpload} title="Click to change profile photo">
              {localImageUrl?<img key={localImageUrl} src={localImageUrl} alt={displayName} style={{width:'100%',height:'100%',objectFit:'cover'}} onError={()=>setLocalImageUrl('')}/>:initial}
              <div style={{position:'absolute',inset:0,borderRadius:'50%',background:'rgba(0,0,0,0)',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.2s'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(0,0,0,0.45)';e.currentTarget.querySelector('svg').style.opacity='1'}} onMouseLeave={e=>{e.currentTarget.style.background='rgba(0,0,0,0)';e.currentTarget.querySelector('svg').style.opacity='0'}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" width="24" height="24" style={{opacity:0,transition:'opacity 0.2s',pointerEvents:'none'}}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
            </div>
            {uploadLoading&&(<div style={{position:'absolute',bottom:0,right:0,width:28,height:28,borderRadius:'50%',background:'var(--bg2)',border:'2px solid rgba(201,168,76,0.4)',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{width:14,height:14,borderRadius:'50%',border:'2px solid rgba(201,168,76,0.2)',borderTopColor:'var(--gold)',animation:'spin 0.8s linear infinite'}}/></div>)}
            <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{display:'none'}} onChange={handleImageUpload}/>
          </div>
          {uploadError&&(<p style={{fontFamily:'Montaga,serif',fontSize:11,color:'#e57b8b',margin:'6px 0 0',textAlign:'center',maxWidth:120,alignSelf:'flex-start',marginTop:8}}>{uploadError}</p>)}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4,flexWrap:'wrap'}}>
              <h2 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:24,fontWeight:700,color:'var(--cream)',margin:0}}>{name||displayName}</h2>
              {totalBooks>0&&<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:600,color:'rgba(201,168,76,0.8)',background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.25)',borderRadius:20,padding:'2px 10px',letterSpacing:'.15em',textTransform:'uppercase'}}>Reader</span>}
            </div>
            {bio&&<p style={{fontFamily:'Montaga,serif',fontSize:13,color:'rgba(240,233,227,0.55)',margin:'0 0 8px',lineHeight:1.6}}>{bio}</p>}
            <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
              {loginUsername&&<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'rgba(201,168,76,0.55)'}}>@{loginUsername}</span>}
              {loginEmail&&<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'rgba(201,168,76,0.55)'}}>{loginEmail}</span>}
              {topAuthor&&<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'rgba(201,168,76,0.55)'}}>Fav: <span style={{color:'rgba(201,168,76,0.85)',fontWeight:600}}>{topAuthor}</span></span>}
            </div>
          </div>
        </div>
      </div>
      <div style={{display:'flex',borderBottom:'1px solid rgba(201,168,76,0.08)',padding:'0 32px'}}>
        {TABS.map(t=>(<button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:'14px 20px',background:'none',border:'none',borderBottom:`2px solid ${activeTab===t.id?'var(--gold)':'transparent'}`,color:activeTab===t.id?'var(--gold)':'var(--text-muted)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:600,letterSpacing:'.12em',textTransform:'uppercase',cursor:'pointer',transition:'all 0.18s',marginBottom:-1}}>{t.label}</button>))}
      </div>
      <div style={{maxWidth:760,margin:'0 auto',padding:'28px 32px 80px'}}>
        {activeTab==='overview'&&(
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:14,marginBottom:32}}>
              {[{label:'Total Books',value:totalBooks,color:'#c9a84c',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="22" height="22"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>},{label:'Your Ratings',value:`${avgRating?avgRating+' ★':'—'}`,onClick:()=>onNav('ratings'),color:'#f0c040',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="22" height="22"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>},{label:'History',value:recentBooks.length,color:'#7ab8e0',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="22" height="22"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}].map(card=>(<div key={card.label} style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(201,168,76,0.1)',borderRadius:14,padding:'18px 20px',display:'flex',alignItems:'center',gap:14,cursor:card.onClick?'pointer':'default',transition:'all 0.2s'}} onClick={card.onClick} onMouseEnter={card.onClick?e=>e.currentTarget.style.background='rgba(201,168,76,0.08)':undefined} onMouseLeave={card.onClick?e=>e.currentTarget.style.background='rgba(255,255,255,0.03)':undefined}><div style={{color:card.color,opacity:0.7,flexShrink:0}}>{card.icon}</div><div><div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:20,fontWeight:700,color:card.color}}>{card.value}</div><div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,color:'var(--text-muted)',letterSpacing:'.1em',textTransform:'uppercase',marginTop:2}}>{card.label}</div></div></div>))}
            </div>
            {topGenres.length>0&&(<div style={{marginBottom:32}}><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 14px'}}>Your Top Genres</p><div style={{display:'flex',flexWrap:'wrap',gap:10}}>{topGenres.map(({genre,count},i)=>{const maxCount=topGenres[0].count;const pct=Math.round((count/maxCount)*100);const colors=['#c9a84c','#e06080','#7ab8e0','#50a870','#9a7ab8','#e07840'];const col=colors[i%colors.length];return(<div key={genre} onClick={()=>onNav('genre')} style={{position:'relative',background:'rgba(255,255,255,0.03)',border:`1px solid ${col}30`,borderRadius:10,padding:'10px 16px',minWidth:120,overflow:'hidden',cursor:'pointer'}}><div style={{position:'absolute',left:0,top:0,bottom:0,width:`${pct}%`,background:`${col}12`,transition:'width 0.6s ease'}}/><div style={{position:'relative',fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:600,color:col,textTransform:'capitalize'}}>{genre}</div><div style={{position:'relative',fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,color:'var(--text-muted)',marginTop:2}}>{count} book{count!==1?'s':''}</div></div>)})}</div></div>)}
            {recentBooks.length>0&&(<div><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 14px'}}>Recently Viewed</p><div style={{display:'flex',flexDirection:'column',gap:1,borderRadius:12,overflow:'hidden',border:'1px solid rgba(201,168,76,0.08)'}}>{recentBooks.slice(0,6).map((b,i)=>(<div key={b.title+i} style={{display:'flex',alignItems:'center',gap:14,padding:'11px 16px',background:i%2===0?'rgba(255,255,255,0.02)':'transparent'}} onMouseEnter={e=>e.currentTarget.style.background='rgba(201,168,76,0.05)'} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'rgba(255,255,255,0.02)':'transparent'}><div style={{width:36,height:52,borderRadius:5,overflow:'hidden',flexShrink:0,background:'rgba(114,57,63,0.25)'}}>{b.image_url&&<img key={b.image_url} src={b.image_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.target.style.display='none'}/>}</div><div style={{flex:1,minWidth:0}}><div style={{fontFamily:'Montaga,serif',fontSize:12.5,color:'var(--text)',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{b.title}</div><div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,color:'var(--text-muted)',marginTop:2}}>{b.authors}</div></div>{b.average_rating>0&&<div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'var(--gold)',flexShrink:0}}>{Number(b.average_rating).toFixed(1)} ★</div>}</div>))}</div></div>)}
            {totalBooks===0&&(<div style={{textAlign:'center',padding:'48px 0'}}><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" width="48" height="48" style={{color:'rgba(201,168,76,0.2)',marginBottom:16}}><path d="M8 40V10a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v30"/><path d="M4 40h40"/><path d="M16 6v16l4-3 4 3V6"/></svg><h3 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:16,color:'var(--cream)',marginBottom:8}}>Your Library is Empty</h3><p style={{fontFamily:'Montaga,serif',fontSize:13,color:'var(--text-muted)',marginBottom:20}}>Start adding books to see your reading profile here.</p><button onClick={()=>onNav('trending')} style={{padding:'10px 24px',background:'var(--maroon)',border:'none',borderRadius:8,color:'var(--cream)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:600,letterSpacing:'.1em',textTransform:'uppercase',cursor:'pointer'}}>Browse Books →</button></div>)}
          </>
        )}
        {activeTab==='settings'&&(
          <div style={{maxWidth:520}}>
            <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(201,168,76,0.1)',borderRadius:16,padding:'24px',marginBottom:20}}><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 12px',paddingBottom:10,borderBottom:'1px solid rgba(201,168,76,0.08)'}}>Account Information</p>{infoRow('Username',loginUsername)}{infoRow('Email',loginEmail)}</div>
            <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(201,168,76,0.1)',borderRadius:16,padding:'24px',marginBottom:20}}><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 20px',paddingBottom:12,borderBottom:'1px solid rgba(201,168,76,0.08)'}}>Profile</p>{[{label:'Display Name',ph:'Your name',val:name,setter:setName},{label:'Bio',ph:'A short bio about your reading taste…',val:bio,setter:setBio,textarea:true}].map(({label,ph,val,setter,textarea})=>(<div key={label} style={{marginBottom:18}}><label style={{display:'block',fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,fontWeight:600,color:'var(--text-muted)',letterSpacing:'.12em',textTransform:'uppercase',marginBottom:7}}>{label}</label>{textarea?<textarea value={val} onChange={e=>setter(e.target.value)} placeholder={ph} rows={3} style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(201,168,76,0.18)',borderRadius:8,color:'var(--text)',fontFamily:'Montaga,serif',fontSize:13,outline:'none',boxSizing:'border-box',resize:'vertical',lineHeight:1.6}} onFocus={e=>e.target.style.borderColor='rgba(201,168,76,0.45)'} onBlur={e=>e.target.style.borderColor='rgba(201,168,76,0.18)'}/>:<input value={val} onChange={e=>setter(e.target.value)} placeholder={ph} style={{width:'100%',padding:'10px 14px',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(201,168,76,0.18)',borderRadius:8,color:'var(--text)',fontFamily:'Montaga,serif',fontSize:13,outline:'none',boxSizing:'border-box'}} onFocus={e=>e.target.style.borderColor='rgba(201,168,76,0.45)'} onBlur={e=>e.target.style.borderColor='rgba(201,168,76,0.18)'}/>}</div>))}<button onClick={saveProfile} style={{padding:'11px 28px',background:saved2?'rgba(80,168,112,0.2)':'var(--maroon)',border:`1px solid ${saved2?'rgba(80,168,112,0.4)':'transparent'}`,borderRadius:8,color:saved2?'#50a870':'var(--cream)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:600,letterSpacing:'.1em',textTransform:'uppercase',cursor:'pointer',transition:'all 0.2s',display:'flex',alignItems:'center',gap:7}}>{saved2&&<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>}{saved2?'Saved!':'Save Changes'}</button></div>
            <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(201,168,76,0.1)',borderRadius:16,padding:'24px',marginBottom:20}}><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 14px',paddingBottom:12,borderBottom:'1px solid rgba(201,168,76,0.08)'}}>Your Library</p>{[{label:'Saved Books',count:savedBooks.length,color:'#c9a84c',page:'saved'},{label:'Liked Books',count:likedBooks.length,color:'#e57b8b',page:'liked'},{label:'Wishlist',count:wishlistBooks.length,color:'#7ab8e0',page:'wishlist'},{label:'Already Read',count:readBooks.length,color:'#50a870',page:'read'}].map(item=>(<div key={item.label} onClick={()=>onNav(item.page)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:'1px solid rgba(201,168,76,0.06)',cursor:'pointer',transition:'padding-left 0.15s'}} onMouseEnter={e=>e.currentTarget.style.paddingLeft='6px'} onMouseLeave={e=>e.currentTarget.style.paddingLeft='0px'}><span style={{fontFamily:'Montaga,serif',fontSize:13,color:'var(--text)'}}>{item.label}</span><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:12,fontWeight:700,color:item.color}}>{item.count}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{color:'var(--text-muted)'}}><polyline points="9 18 15 12 9 6"/></svg></div></div>))}</div>
            <div style={{background:'rgba(114,20,30,0.08)',border:'1px solid rgba(114,57,63,0.2)',borderRadius:16,padding:'24px'}}><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'#e57b8b',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 14px'}}>Account</p><button onClick={onLogout} style={{display:'flex',alignItems:'center',gap:8,padding:'11px 20px',background:'rgba(114,57,63,0.14)',border:'1px solid rgba(114,57,63,0.35)',borderRadius:8,color:'#e57b8b',fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:500,letterSpacing:'.1em',cursor:'pointer',textTransform:'uppercase',transition:'all 0.2s'}} onMouseEnter={e=>e.currentTarget.style.background='rgba(114,57,63,0.28)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(114,57,63,0.14)'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Log Out</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
const _MANGA_AUTHOR_SIGNALS = ['toriyama','oda','kishimoto','kubo','arakawa','isayama','takeuchi','togashi','takahashi','miura','ito','inoue','tezuka','otomo','shirow','fujimoto','gege akutami','akutami','horikoshi','murata','one','araki','adachi','urasawa','obata','ohba','yuki midorikawa','midorikawa']
const _MANGA_TITLE_SIGNALS = ['naruto','bleach','one piece','dragon ball','fullmetal','attack on titan','death note','my hero academia','demon slayer','jujutsu','chainsaw man','hunter x hunter','yu yu hakusho','fairy tail','sword art','tokyo ghoul','sailor moon','cardcaptor','evangelion','cowboy bebop','berserk','vagabond','slam dunk','ranma','inuyasha','black clover','dr stone','vinland saga','spy x family','blue period','a silent voice','your lie in april','fruits basket','nana','ouran','clannad','angel beats']
function _isManga(b){const t=(b.title||'').toLowerCase();const a=(b.authors||'').toLowerCase();const g=(b.genre||'').toLowerCase();if(_MANGA_TITLE_SIGNALS.some(s=>t.includes(s)))return true;if(_MANGA_AUTHOR_SIGNALS.some(s=>a.includes(s)))return true;if(g.includes('manga')||g.includes('anime'))return true;return false}
function ComicsMangaRows(){
  const[comicBooks,setComicBooks]=useState([]);const[mangaBooks,setMangaBooks]=useState([]);const[comicLoading,setComicLoading]=useState(true);const[mangaLoading,setMangaLoading]=useState(true);const[ref,inView]=useInView();const fetched=useRef(false)
  useEffect(()=>{
    if(!inView||fetched.current)return;fetched.current=true
    async function loadAll(){
      const mangaSeen=new Set();const mangaRaw=[]
      const topAuthors=['Eiichiro Oda','Masashi Kishimoto','Tite Kubo','Hiromu Arakawa','Hajime Isayama','Junji Ito']
      await Promise.allSettled(topAuthors.map(async author=>{try{const r=await fetch(`${API_BASE}/recommend/author?author=${encodeURIComponent(author)}&top_n=5`);if(!r.ok)return;const d=await r.json();(Array.isArray(d)?d:[]).forEach(b=>{const k=(b.title||'').toLowerCase();if(!mangaSeen.has(k)){mangaSeen.add(k);mangaRaw.push(b)}})}catch{}}))
      if(mangaRaw.length<6){const searchTerms=['bleach','naruto','one piece','fullmetal alchemist','attack on titan','death note','demon slayer','jujutsu kaisen','my hero academia','dragon ball'];await Promise.allSettled(searchTerms.map(async term=>{try{const r=await fetch(`${API_BASE}/search?query=${encodeURIComponent(term)}&limit=4`);if(!r.ok)return;const d=await r.json();(Array.isArray(d)?d:[]).forEach(b=>{const k=(b.title||'').toLowerCase();if(!mangaSeen.has(k)&&_isManga(b)){mangaSeen.add(k);mangaRaw.push(b)}})}catch{}}))}
      const finalManga=dedupBooks(mangaRaw.sort((a,b)=>(Number(b.average_rating)||0)-(Number(a.average_rating)||0))).slice(0,24);setMangaBooks(finalManga);setMangaLoading(false)
      try{const raw=await fetchGenre('graphic novel',48);const comics=dedupBooks(raw).filter(b=>{const k=(b.title||'').toLowerCase();if(mangaSeen.has(k))return false;if(_isManga(b))return false;return true}).slice(0,24);setComicBooks(comics)}catch{};setComicLoading(false)
    }
    loadAll()
  },[inView])
  return(
    <div ref={ref}>
      {(comicLoading||comicBooks.length>0)&&(<section className="home-section"><div className="hs-header"><div><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'#9a7ab8',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 3px'}}>Panels and Pages</p><h3 className="hs-title">Comics and Graphic Novels</h3></div></div><BookShelf books={comicBooks} loading={comicLoading}/></section>)}
      {(mangaLoading||mangaBooks.length>0)&&(<section className="home-section" style={{background:'linear-gradient(135deg,#8fb78f 0%,#8fb78f 50%,#8fb78f 100%)'}}><div className="hs-header"><div><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'#4e674e',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 3px'}}>Anime and Manga</p><h3 className="hs-title">Manga Series</h3></div></div><BookShelf books={mangaBooks} loading={mangaLoading}/></section>)}
    </div>
  )
}

function MovieAdaptationsSection(){
  const[books,setBooks]=useState([]);const[loading,setLoading]=useState(true);const[ref,inView]=useInView();const fetched=useRef(false)
  useEffect(()=>{
    if(!inView||fetched.current)return;fetched.current=true
    async function load(){
      const seen=new Set();const results=[];function absorb(list){dedupBooks(list).forEach(b=>{const k=(b.title||'').toLowerCase().trim();if(!seen.has(k)){seen.add(k);results.push(b)}})}
      const mck='movie_adaptations_v2';const mCached=_cGet(mck);if(mCached){setBooks(mCached);setLoading(false);return}
      const searchTerms=['pride and prejudice','sherlock holmes','game of thrones','the shining stephen king','the da vinci code','lord of the rings tolkien','dune frank herbert','murder on the orient express','girl with the dragon tattoo','the fault in our stars','little women','gone girl']
      const fetches=await Promise.allSettled(searchTerms.map(t=>fetch(`${API_BASE}/search?query=${encodeURIComponent(t)}&limit=3`).then(r=>r.json()).catch(()=>[])))
      fetches.forEach(f=>{if(f.status==='fulfilled')absorb(Array.isArray(f.value)?f.value:(f.value?.books||[]))})
      if(results.length<16){try{absorb(await fetchGenre('classics',24))}catch{}}
      const final=results.slice(0,36);_cSet(mck,final);setBooks(final);setLoading(false)
    }
    load().catch(()=>setLoading(false))
  },[inView])
  if(!loading&&!books.length)return null
  return(<section className="home-section" style={{background:'linear-gradient(135deg,#b2a18f 0%,#b2a18f 50%,#b2a18f 100%)'}} ref={ref}><div className="hs-header"><div><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'#8c3204',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 3px'}}>Now Showing</p><h3 className="hs-title">Books with Movie Adaptations</h3></div></div><BookShelf books={books} loading={loading}/></section>)
}

function SimilarBooksPage({seedBook,onOpen,onBack}){
  const[books,setBooks]=useState([]); const[loading,setLoading]=useState(true)
  const[phase,setPhase]=useState('Finding similar books…')
  useEffect(()=>{
    if(!seedBook?.title)return
    let cancelled=false; const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),18000)
    const owned=new Set([(seedBook.title||'').toLowerCase()])
    const genre=(seedBook.genre||'').split(',')[0].trim().toLowerCase()
    const desc=(seedBook.description||'').replace(/<[^>]+>/g,'').trim()
    async function load(){
      setPhase('Searching by content similarity…')
      try{const r=await fetch(`${API_BASE}/recommend/title?title=${encodeURIComponent(seedBook.title)}&top_n=40`,{signal:ctrl.signal});if(r.ok){const d=await r.json();const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[])).filter(b=>!owned.has((b.title||'').toLowerCase()));if(list.length>=6){if(!cancelled)setBooks(list.slice(0,36));return}}}catch(e){if(e?.name==='AbortError')return}
      setPhase('Analysing reading patterns…')
      try{const r=await fetch(`${API_BASE}/recommend/hybrid?title=${encodeURIComponent(seedBook.title)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({liked_titles:[seedBook.title],saved_titles:[],top_n:40}),signal:ctrl.signal});if(r.ok){const d=await r.json();const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[])).filter(b=>!owned.has((b.title||'').toLowerCase()));if(list.length>=6){if(!cancelled)setBooks(list.slice(0,36));return}}}catch(e){if(e?.name==='AbortError')return}
      if(desc.length>60){setPhase('Matching by themes and style…');try{const r=await fetch(`${API_BASE}/recommend/description`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:desc.slice(0,400),liked_titles:[seedBook.title],saved_titles:[],top_n:40}),signal:ctrl.signal});if(r.ok){const d=await r.json();const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[])).filter(b=>!owned.has((b.title||'').toLowerCase()));if(list.length>=6){if(!cancelled)setBooks(list.slice(0,36));return}}}catch(e){if(e?.name==='AbortError')return}}
      setPhase('Finding books with similar atmosphere…')
      try{const moodQuery=`${genre} books with same atmosphere and emotional depth as ${seedBook.title}`;const r=await fetch(`${API_BASE}/recommend/mood`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mood:moodQuery,top_n:40,use_llm:false,user_genres:[genre].filter(Boolean)}),signal:ctrl.signal});if(r.ok){const d=await r.json();const list=dedupBooks(Array.isArray(d)?d:(d?.books||d?.results||[])).filter(b=>!owned.has((b.title||'').toLowerCase()));if(!cancelled)setBooks(list.slice(0,36))}}catch(e){if(e?.name==='AbortError')return}
      if(genre){try{const list=await fetchGenre(genre,36,ctrl.signal);if(!cancelled)setBooks(dedupBooks(list).filter(b=>!owned.has((b.title||'').toLowerCase())).slice(0,36))}catch{}}
    }
    load().catch(()=>{}).finally(()=>{clearTimeout(tid);if(!cancelled)setLoading(false)})
    return()=>{cancelled=true;clearTimeout(tid);ctrl.abort()}
  },[seedBook?.title])
  const genres=(seedBook?.genre||'').split(',').map(g=>g.trim()).filter(Boolean).slice(0,3)
  const coverUrl=cleanImageUrl(seedBook?.image_url)
  return(
    <div style={{minHeight:'100%',background:'var(--bg)'}}>
      <div style={{padding:'20px 28px 18px',borderBottom:'1px solid rgba(201,168,76,0.08)',background:'linear-gradient(135deg,rgba(114,57,63,0.14) 0%,transparent 100%)'}}>
        <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:'var(--text-muted)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,fontWeight:600,letterSpacing:'.15em',textTransform:'uppercase',cursor:'pointer',marginBottom:16,padding:0,transition:'color 0.18s'}} onMouseEnter={e=>e.currentTarget.style.color='var(--gold)'} onMouseLeave={e=>e.currentTarget.style.color='var(--text-muted)'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="13" height="13"><polyline points="15 18 9 12 15 6"/></svg>Back
        </button>
        <div style={{display:'flex',alignItems:'center',gap:18,flexWrap:'wrap'}}>
          {coverUrl&&(<div style={{width:52,height:78,borderRadius:6,overflow:'hidden',flexShrink:0,boxShadow:'0 4px 16px rgba(0,0,0,0.4)'}}><img key={coverUrl} src={coverUrl} alt={seedBook.title} style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>)}
          <div style={{flex:1,minWidth:0}}>
            <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:700,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 4px'}}>More Like This</p>
            <h2 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:20,fontWeight:700,color:'var(--cream)',margin:'0 0 6px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{seedBook.title}</h2>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {genres.map(g=><span key={g} style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,fontWeight:600,color:'var(--gold)',background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.22)',borderRadius:20,padding:'2px 10px',textTransform:'uppercase',letterSpacing:'.1em'}}>{g}</span>)}
              {seedBook.authors&&<span style={{fontFamily:'Montaga,serif',fontSize:11,color:'var(--text-muted)'}}>by {seedBook.authors.split(',')[0].trim()}</span>}
            </div>
          </div>
          {!loading&&<span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'var(--text-muted)',letterSpacing:'.1em',flexShrink:0}}>{books.length} books found</span>}
        </div>
      </div>
      {loading?(<div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:14,padding:'72px 0'}}><div style={{width:32,height:32,borderRadius:'50%',border:'2.5px solid rgba(201,168,76,0.15)',borderTopColor:'rgba(201,168,76,0.7)',animation:'spin 0.8s linear infinite'}}/><p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,color:'var(--text-muted)',letterSpacing:'.1em'}}>{phase}</p><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>):books.length===0?(<div style={{textAlign:'center',padding:'72px 36px',fontFamily:'Montaga,serif',color:'var(--text-muted)',fontSize:14}}>No similar books found for "{seedBook.title}".</div>):(<div style={{padding:'24px 28px 56px'}}><BookRow books={books} loading={false} useGrid/></div>)}
    </div>
  )
}

  //  HOME (main export)
export default function Home() {
  const navigate = useNavigate()
  const { setHandleAuthor, modalBook, setModalBook, readBooks, setReadBooks } = useApp()
  const [storedUser] = useState(() => { try { return JSON.parse(localStorage.getItem('rook_user') || '{}') } catch { return {} } })
  const userKey = storedUser.username || storedUser.email || 'guest'
  const profileKeyName = `rook_name_${userKey}`
  const [userName, setUserName] = useState(() => localStorage.getItem(profileKeyName) || storedUser.username || storedUser.name || storedUser.email || 'Reader')
  const userInitial = userName.charAt(0).toUpperCase()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('rook_sb_collapsed') === '1')
  const [currentPage, setCurrentPage] = useState('home')
  const [genreParam, setGenreParam] = useState('')
  const [authorParam, setAuthorParam] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [similarBook, setSimilarBook] = useState(null)
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth > 900)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [isLight, setIsLight] = useState(() => document.documentElement.getAttribute('data-theme') === 'light')
  const [savedBooks, setSavedBooks] = useState(() => loadList(userKey, 'saved'))
  const [likedBooks, setLikedBooks] = useState(() => loadList(userKey, 'liked'))
  const [wishlistBooks, setWishlistBooks] = useState(() => loadList(userKey, 'wishlist'))
  const [recentBooks, setRecentBooks] = useState(() => loadList(userKey, 'recent'))
  const { imageUrl: profileImageUrl, setImageUrl: setProfileImageUrl } = useUserProfileImage()
  useEffect(() => { saveList(userKey, 'saved', savedBooks) }, [savedBooks])
  useEffect(() => { saveList(userKey, 'liked', likedBooks) }, [likedBooks])
  useEffect(() => { saveList(userKey, 'wishlist', wishlistBooks) }, [wishlistBooks])
  useEffect(() => { saveList(userKey, 'recent', recentBooks) }, [recentBooks])
  useEffect(() => { if (readBooks) saveList(userKey, 'read', readBooks) }, [readBooks])
  useEffect(() => { const s = loadList(userKey, 'read'); if (s.length && setReadBooks) setReadBooks(s) }, [userKey])
  useEffect(() => { document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark') }, [isLight])
  useEffect(() => { const fn = () => setIsDesktop(window.innerWidth > 900); window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn) }, [])
  useEffect(() => { const fn = e => { if (e.key === 'Escape') setModalBook(null) }; window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn) }, [])
  useEffect(() => { if (isDesktop) setSidebarOpen(false) }, [isDesktop])
  useEffect(() => { setHandleAuthor(() => handleAuthor) }, [authorParam])
  const savedSet = useMemo(() => new Set(savedBooks.map(b => b.title)), [savedBooks])
  const likedSet = useMemo(() => new Set(likedBooks.map(b => b.title)), [likedBooks])
  const wishedSet = useMemo(() => new Set(wishlistBooks.map(b => b.title)), [wishlistBooks])
  const likedTitles = useMemo(() => likedBooks.map(b => b.title).filter(Boolean), [likedBooks])
  const savedTitles = useMemo(() => savedBooks.map(b => b.title).filter(Boolean), [savedBooks])
  const hasLibrary = likedBooks.length > 0 || savedBooks.length > 0 || (readBooks || []).length > 0
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500) }
  function handleNav(page) { setCurrentPage(page); if (!isDesktop) setSidebarOpen(false) }
  function handleToggle() {
    if (isDesktop) { setSidebarCollapsed(c => { const n = !c; localStorage.setItem('rook_sb_collapsed', n ? '1' : '0'); return n }) }
    else { setSidebarOpen(o => !o) }
  }
  function handleGenre(g) { setGenreParam(g); handleNav('genre') }
  function handleAuthor(a) { setAuthorParam(a); handleNav('author') }
  function handleSave(book) {
    if (savedSet.has(book.title)) { setSavedBooks(s => s.filter(b => b.title !== book.title)); showToast('Removed from Saved') }
    else { setSavedBooks(s => [{ ...book, savedAt: Date.now() }, ...s]); trackAction('saved', book); showToast(`Saved "${book.title}"`) }
  }
  function handleRead(book) {
    if ((readBooks || []).some(b => b.title === book.title)) { const updated = (readBooks || []).filter(b => b.title !== book.title); if (setReadBooks) setReadBooks(updated); saveList(userKey, 'read', updated); showToast('Removed from Read') }
    else { const updated = [{ ...book, readAt: Date.now() }, ...(readBooks || [])]; if (setReadBooks) setReadBooks(updated); saveList(userKey, 'read', updated); trackAction('read', book); showToast(`Marked "${book.title}" as read`) }
  }
  function handleLike(book) {
    if (likedSet.has(book.title)) { setLikedBooks(l => l.filter(b => b.title !== book.title)); showToast('Removed from Liked') }
    else { setLikedBooks(l => [{ ...book, likedAt: Date.now() }, ...l]); trackAction('liked', book); showToast(`Liked "${book.title}"`) }
  }
  function handleWish(book) {
    if (wishedSet.has(book.title)) { setWishlistBooks(w => w.filter(b => b.title !== book.title)); showToast('Removed from Wishlist') }
    else { setWishlistBooks(w => [{ ...book, wishedAt: Date.now() }, ...w]); trackAction('wished', book); showToast('Added to Wishlist') }
  }
  function handleOpen(book) { setModalBook(book); trackAction('opened', book); setRecentBooks(r => [{ ...book, viewedAt: Date.now() }, ...r.filter(b => b.title !== book.title)].slice(0, 20)) }
  function handleSearch(q) { setSearchQuery(q.toLowerCase()); handleNav('search') }
  function handleSimilar(book) { setSimilarBook(book); handleNav('similar') }
  function handleLogout() {
    // Only clear session keys, keep namespaced data like rook_saved_username
    const sessionKeys = ['rook_access_token', 'rook_refresh_token', 'rook_user']
    sessionKeys.forEach(k => localStorage.removeItem(k))
    sessionStorage.clear()
    window.location.href = '/auth'
  }
  const bookProps = { savedSet, likedSet, wishedSet, onSave: handleSave, onLike: handleLike, onWish: handleWish }
  const sbW = isDesktop ? (sidebarCollapsed ? 62 : 230) : 0
  const knownPages = ['home','genre','author','trending','foryou','description','search','saved','wishlist','liked','profile','read','similar','ratings','toprated']

  const [modalBookResolved, setModalBookResolved] = useState(null)
  useEffect(() => {
    if (!modalBook) { setModalBookResolved(null); return }
    // Show immediately with whatever we have
    setModalBookResolved(modalBook)
    // Async resolve best cover via imageUtils (queued, cached)
    resolveBookCoverAsync(modalBook).then(url => {
      if (url && url !== modalBook.image_url) {
        setModalBookResolved(prev => prev ? { ...prev, image_url: url } : prev)
      }
    }).catch(() => {})
  }, [modalBook?.title, modalBook?.image_url])
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg2)', position: 'relative' }}>
      <Sidebar isDesktop={isDesktop} sidebarOpen={sidebarOpen} sidebarCollapsed={sidebarCollapsed} onClose={() => setSidebarOpen(false)} onNav={handleNav} onGenre={handleGenre} profileImageUrl={profileImageUrl} userName={userName}/>
      <div style={{ marginLeft: sbW, flex: 1, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, transition: 'margin-left 0.22s cubic-bezier(0.22,1,0.36,1)' }}>
        <Navbar currentPage={currentPage} onNav={handleNav} onToggle={handleToggle} savedCount={savedBooks.length} wishCount={wishlistBooks.length} isLight={isLight} onTheme={setIsLight} userName={userName} userInitial={userInitial} onLogoClick={() => navigate('/')} profileImageUrl={profileImageUrl}/>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {currentPage === 'home' && (
            <>
              <HeroCarousel onOpen={handleOpen} savedSet={savedSet} wishedSet={wishedSet} onSave={handleSave} onWish={handleWish} />
              <SearchBar onSearch={handleSearch} onOpenBook={handleOpen} userName={userName} onGenre={handleGenre} />
              <RecentlyViewed books={recentBooks} onClear={() => { setRecentBooks([]); saveList(userKey, 'recent', []) }} />
              <PopularNowSection onNav={handleNav} />
              <TopRatedSection likedBooks={likedBooks} savedBooks={savedBooks} readBooks={readBooks || []} onOpen={handleOpen} onLike={handleLike} onSave={handleSave} onRead={handleRead} onNav={handleNav}/>
              <RightNow />
              <YouMightLike likedBooks={likedBooks} savedBooks={savedBooks} readBooks={readBooks || []} wishlistBooks={wishlistBooks} />
              {hasLibrary && likedBooks[0] && (<BecauseYouSection key={'l0-' + likedBooks[0].title} seedBook={likedBooks[0]} label="Because You Liked" accent="#e06080" likedTitles={likedTitles} savedTitles={savedTitles} />)}
              {!hasLibrary && (
                <>
                  <LazySection eyebrow="Popular Now" title="Trending Books" fetchFn={() => fetchTrending(24)}><button className="hs-link" onClick={() => handleNav('trending')}>See All →</button></LazySection>
                  <section className="home-section" style={{ background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.12)', borderRadius: 16, margin: '16px 0' }}>
                    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                      <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: 'var(--gold)', letterSpacing: '.2em', textTransform: 'uppercase', margin: 0 }}>Personalise Your Feed</p>
                      <h3 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 18, fontWeight: 600, color: 'var(--cream)', margin: 0 }}>Save books to get personalised picks</h3>
                      <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>Like, save, or mark books as read and we'll tailor every section to your taste.</p>
                      <button className="ctrl-btn" style={{ marginTop: 4 }} onClick={() => handleNav('trending')}>Browse Trending Books →</button>
                    </div>
                  </section>
                </>
              )}
              {hasLibrary && (readBooks || [])[0] && (<BecauseYouSection key={'r0-' + (readBooks || [])[0].title} seedBook={(readBooks || [])[0]} label="Because You Read" accent="#50a870" likedTitles={likedTitles} savedTitles={savedTitles} />)}
              <LazySection eyebrow="High Rated" title="Critically Acclaimed" accent="#c9a84c" fetchFn={() => fetchMood('literary fiction award-winning critically acclaimed Booker Prize Nobel profound', { top_n: 20, use_llm: false })} />
              <WeekendGateway />
              {hasLibrary && likedBooks[1] && (<BecauseYouSection key={'l1-' + likedBooks[1].title} seedBook={likedBooks[1]} label="Because You Liked" accent="#e06080" likedTitles={likedTitles} savedTitles={savedTitles} />)}
              <MoodSection isLight={isLight} />
              <MovieAdaptationsSection />
              <AuthorsRow onNav={handleNav} onAuthor={handleAuthor} />
              {hasLibrary && savedBooks.find(b => !likedBooks.some(l => l.title === b.title)) && (() => { const sb = savedBooks.find(b => !likedBooks.some(l => l.title === b.title)); return <BecauseYouSection key={'s0-' + sb.title} seedBook={sb} label="Because You Saved" accent="#7ab8e0" likedTitles={likedTitles} savedTitles={savedTitles} /> })()}
              <SeasonSection isLight={isLight} />
              <CategoriesGrid onSearch={handleSearch} onGenre={handleGenre} />
              <TravelSection />
              {hasLibrary && (readBooks || [])[1] && (<BecauseYouSection key={'r1-' + (readBooks || [])[1].title} seedBook={(readBooks || [])[1]} label="Because You Read" accent="#50a870" likedTitles={likedTitles} savedTitles={savedTitles} />)}
              <LazySection eyebrow="Comfort Reads" title="Cosy Reads" fetchFn={() => fetchMood('cosy', { top_n: 20, use_llm: false })} />
              <ComicsMangaRows />
              {hasLibrary && likedBooks[2] && (<BecauseYouSection key={'l2-' + likedBooks[2].title} seedBook={likedBooks[2]} label="Because You Liked" accent="#e06080" likedTitles={likedTitles} savedTitles={savedTitles} />)}
              <LazySection eyebrow="Edge of Your Seat" title="Thriller & Suspense" fetchFn={() => fetchMood('tense', { top_n: 20, use_llm: false })} />
              <div style={{ height: 48 }} />
            </>
          )}
          {currentPage === 'similar' && similarBook && <SimilarBooksPage seedBook={similarBook} onOpen={handleOpen} onBack={() => handleNav('home')} />}
          {currentPage === 'search' && <SearchResultsPage query={searchQuery} onOpen={handleOpen} />}
          {currentPage === 'genre' && <GenrePage onOpen={handleOpen} bookProps={bookProps} onNav={handleNav} initialGenre={genreParam} />}
          {currentPage === 'author' && <AuthorPage onOpen={handleOpen} bookProps={bookProps} initialAuthor={authorParam} />}
          {currentPage === 'trending' && <TrendingPage onOpen={handleOpen} bookProps={bookProps} />}
          {currentPage === 'foryou' && <ForYouPage onOpen={handleOpen} bookProps={bookProps} likedBooks={likedBooks} savedBooks={savedBooks} readBooks={readBooks || []} onLike={handleLike} onSave={handleSave} onRead={handleRead} onNav={handleNav} />}
          {currentPage === 'description' && <DescribePage onOpen={handleOpen} bookProps={bookProps} />}
          {currentPage === 'toprated' && <TopRatedPage onOpen={handleOpen} bookProps={bookProps} likedBooks={likedBooks} savedBooks={savedBooks} readBooks={readBooks||[]} onLike={handleLike} onSave={handleSave} onRead={handleRead} />}
          {currentPage === 'saved' && <LibraryPage title="Your Saved Books" books={savedBooks} accent="var(--gold)" emptyMsg="No saved books yet." onClearAll={() => { setSavedBooks([]); showToast('Saved books cleared') }} />}
          {currentPage === 'wishlist' && <LibraryPage title="My Wishlist" books={wishlistBooks} accent="#e57b8b" emptyMsg="Your wishlist is empty." onClearAll={() => { setWishlistBooks([]); showToast('Wishlist cleared') }} />}
          {currentPage === 'liked' && <LibraryPage title="Liked Books" books={likedBooks} accent="#e57b8b" emptyMsg="No liked books yet." onClearAll={() => { setLikedBooks([]); showToast('Liked books cleared') }} />}
          {currentPage === 'read' && <LibraryPage title="Already Read" books={readBooks || []} accent="#50a870" emptyMsg="No read books yet." onClearAll={() => { if (setReadBooks) setReadBooks([]); saveList(userKey, 'read', []); showToast('Read list cleared') }} />}
          {currentPage === 'profile' && (<ProfilePage savedBooks={savedBooks} likedBooks={likedBooks} wishlistBooks={wishlistBooks} recentBooks={recentBooks} readBooks={readBooks || []} onNameSaved={setUserName} onNav={handleNav} onLogout={handleLogout} userName={userName} profileImageUrl={profileImageUrl} onImageUploaded={setProfileImageUrl}/>)}
          {currentPage === 'ratings' && (<YourRatingsPage onOpen={handleOpen} onNav={handleNav} />)}
          {!knownPages.includes(currentPage) && (
            <div style={{ padding: '60px 36px', textAlign: 'center', fontFamily: 'Montaga,serif', color: 'var(--text-muted)' }}>
              <h2 style={{ color: 'var(--gold)', marginBottom: 16, fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 28 }}>{currentPage.charAt(0).toUpperCase() + currentPage.slice(1)}</h2>
              <p style={{ marginBottom: 24 }}>Coming soon!</p>
              <button className="ctrl-btn" onClick={() => handleNav('home')}>← Back to Home</button>
            </div>
          )}
        </div>
      </div>
      {modalBookResolved && (<BookModal book={modalBookResolved} onClose={() => setModalBook(null)} savedSet={savedSet} likedSet={likedSet} wishedSet={wishedSet} onSave={handleSave} onLike={handleLike} onWish={handleWish} onOpen={handleOpen} onAuthor={handleAuthor} API_BASE={API_BASE} apiFetch={apiFetch} onSearch={handleSearch} onSimilar={handleSimilar} onNav={handleNav} bookList={recentBooks} userId={storedUser.id}/>)}
      <Toast msg={toast} />
    </div>
  )
}