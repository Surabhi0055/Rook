import { useState, useEffect, useRef } from 'react'
import { API_BASE, cleanImageUrl } from '../hooks/useBooks'

/* ── tiny helpers ──────────────────────────────────────────── */
function BookCover({ book }) {
  const url = cleanImageUrl(book?.image_url)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return (
    <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',
      background:'rgba(114,57,63,0.2)',color:'rgba(201,168,76,0.3)'}}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
    </div>
  )
  return <img src={url} alt={book?.title || ''} loading="lazy"
    onError={() => setFailed(true)}
    style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}} />
}

function BookGrid({ books, loading, onOpen }) {
  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'80px 0',gap:14}}>
      <div style={{width:36,height:36,border:'2.5px solid rgba(201,168,76,0.1)',
        borderTop:'2.5px solid var(--gold)',borderRadius:'50%',animation:'tpspin 0.8s linear infinite'}}/>
      <style>{`@keyframes tpspin{to{transform:rotate(360deg)}}`}</style>
      <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,
        color:'var(--text-muted)',letterSpacing:'.12em'}}>Loading books…</span>
    </div>
  )
  if (!books?.length) return (
    <div style={{textAlign:'center',padding:'80px 0',fontFamily:'Montaga,serif',
      color:'var(--text-muted)',fontSize:14}}>No books found for this category.</div>
  )
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))',gap:20}}>
      {books.map((b, i) => (
        <div key={(b.title||'') + i} style={{cursor:'pointer'}} onClick={() => onOpen && onOpen(b)}
          onMouseEnter={e => { const c = e.currentTarget.querySelector('.tp-cover'); if(c) c.style.transform='scale(1.05) translateY(-4px)' }}
          onMouseLeave={e => { const c = e.currentTarget.querySelector('.tp-cover'); if(c) c.style.transform='none' }}>
          <div className="tp-cover" style={{borderRadius:10,overflow:'hidden',aspectRatio:'2/3',
            background:'rgba(114,57,63,0.2)',transition:'transform 0.22s cubic-bezier(0.22,1,0.36,1)',
            boxShadow:'0 2px 10px rgba(0,0,0,0.35)'}}>
            <BookCover book={b}/>
          </div>
          <div style={{padding:'7px 2px 0'}}>
            <div style={{fontFamily:'Montaga,serif',fontSize:11.5,color:'var(--text)',lineHeight:1.35,
              overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{b.title}</div>
            <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,
              color:'var(--text-muted)',marginTop:2,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{b.authors}</div>
            {Number(b.average_rating) > 0 && (
              <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,
                color:'var(--gold)',marginTop:3,fontWeight:600}}>
                {Number(b.average_rating).toFixed(1)} ★
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Tab definitions — apiGenre is the exact string the backend expects ── */
const TABS = [
  { key: 'all',       label: 'All',            apiGenre: null },
  { key: 'fiction',   label: 'Fiction',        apiGenre: 'fiction' },
  { key: 'thriller',  label: 'Thriller',       apiGenre: 'thriller' },
  { key: 'fantasy',   label: 'Fantasy',        apiGenre: 'fantasy' },
  { key: 'romance',   label: 'Romance',        apiGenre: 'romance' },
  { key: 'mystery',   label: 'Mystery',        apiGenre: 'mystery' },
  { key: 'horror',    label: 'Horror',         apiGenre: 'horror' },
  { key: 'sci-fi',    label: 'Sci-Fi',         apiGenre: 'science fiction' },
  { key: 'biography', label: 'Biography',      apiGenre: 'biography' },
  { key: 'comedy',    label: 'Comedy',         apiGenre: 'comedy' },
  { key: 'classics',  label: 'Classics',       apiGenre: 'classics' },
  { key: 'self-help', label: 'Self-Help',      apiGenre: 'self-help' },
]

/* ── Dedup + clean helper ── */
const BLOCK_PATTERNS = [
  'boxed set','box set','omnibus','complete works','collected works',
  'volume 1','volume 2','vol 1','vol 2','vol 3',
]
function dedupAndClean(list) {
  const seen = new Set()
  return (list || []).filter(b => {
    const k = (b.title || '').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    if (BLOCK_PATTERNS.some(p => k.includes(p))) return false
    seen.add(k)
    return true
  })
}

/* ── Sort by rating desc, rating_count as tiebreaker ── */
function sortByRating(arr) {
  return [...arr].sort((a, b) => {
    const rDiff = (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0)
    if (Math.abs(rDiff) > 0.01) return rDiff
    return (Number(b.rating_count) || 0) - (Number(a.rating_count) || 0)
  })
}

/* ── Genre search-term helpers ── */
const GENRE_EXTRA_TERMS = {
  fiction:    ['contemporary fiction','literary fiction','general fiction','bestselling fiction','award winning fiction'],
  thriller:   ['psychological thriller','suspense thriller','crime thriller','gripping thriller','twisty thriller'],
  fantasy:    ['epic fantasy','high fantasy','magic fantasy','sword sorcery','fantasy adventure'],
  romance:    ['contemporary romance','historical romance','romantic fiction','love story','sweet romance','slow burn romance'],
  mystery:    ['detective mystery','cozy mystery','whodunit','crime mystery','murder mystery'],
  horror:     ['supernatural horror','gothic horror','stephen king','scary horror','dark horror'],
  'science fiction': ['sci-fi space','dystopian fiction','cyberpunk','science fiction novel','speculative fiction'],
  biography:  ['memoir biography','autobiography','true story','life story','inspiring biography'],
  comedy:     ['funny comedy','humorous fiction','satirical novel','witty comedy','laugh out loud'],
  classics:   ['classic literature','19th century fiction','canonical novel','timeless literature','classic novel'],
  'self-help':['personal development','productivity habits','motivational','self improvement','mindset growth'],
}

/* ── Per-tab fetch ── */
async function fetchBooks(tab) {
  const results = []
  const seen = new Set()

  function absorb(raw) {
    const list = Array.isArray(raw) ? raw : (raw?.books || raw?.results || [])
    list.forEach(b => {
      const k = (b.title || '').toLowerCase().trim()
      if (k && !seen.has(k)) { seen.add(k); results.push(b) }
    })
  }

  const fetches = []

  if (tab.apiGenre === null) {
    // "All" tab: trending + every genre at 100 books each
    fetches.push(
      fetch(`${API_BASE}/trending?top_n=200`).then(r => r.ok ? r.json() : []).then(absorb).catch(()=>{})
    )
    const allGenres = ['fiction','romance','mystery','thriller','fantasy','horror',
      'science fiction','biography','comedy','classics','self-help']
    allGenres.forEach(g => {
      fetches.push(
        fetch(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(g)}&top_n=100`)
          .then(r => r.ok ? r.json() : []).then(absorb).catch(()=>{})
      )
    })
  } else {
    // Primary: /recommend/genre — strongest source, request 200 to ensure 80-100 after dedup
    fetches.push(
      fetch(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(tab.apiGenre)}&top_n=200`)
        .then(r => r.ok ? r.json() : []).then(absorb).catch(()=>{})
    )
    // Secondary: search by genre label
    fetches.push(
      fetch(`${API_BASE}/search?query=${encodeURIComponent(tab.apiGenre)}&limit=100`)
        .then(r => r.ok ? r.json() : []).then(absorb).catch(()=>{})
    )
    // Tertiary: extra search terms for broader coverage
    const extraTerms = GENRE_EXTRA_TERMS[tab.apiGenre] || []
    extraTerms.forEach(term => {
      fetches.push(
        fetch(`${API_BASE}/search?query=${encodeURIComponent(term)}&limit=80`)
          .then(r => r.ok ? r.json() : []).then(absorb).catch(()=>{})
      )
    })
    // Quaternary: mood-based search for even more coverage
    fetches.push(
      fetch(`${API_BASE}/recommend/mood`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: tab.apiGenre, top_n: 80, use_llm: false })
      }).then(r => r.ok ? r.json() : []).then(absorb).catch(()=>{})
    )
  }

  await Promise.allSettled(fetches)
  return sortByRating(dedupAndClean(results))
}



/* ── Main component ── */
const _cache = {}

export function TrendingPage({ onOpen }) {
  const [activeTab, setActiveTab]   = useState('all')
  const [search, setSearch]         = useState('')
  const [books, setBooks]           = useState([])
  const [loading, setLoading]       = useState(true)
  const loadingTab                  = useRef(null)

  useEffect(() => { loadTab('all') }, [])

  async function loadTab(key) {
    if (loadingTab.current === key) return
    loadingTab.current = key
    setLoading(true)
    setBooks([])

    if (_cache[key]) {
      setBooks(_cache[key])
      setLoading(false)
      loadingTab.current = null
      return
    }

    const tab = TABS.find(t => t.key === key)
    if (!tab) { setLoading(false); loadingTab.current = null; return }

    const result = await fetchBooks(tab)
    _cache[key] = result
    setBooks(result)
    setLoading(false)
    loadingTab.current = null
  }

  function handleTabClick(key) {
    setActiveTab(key)
    setSearch('')
    loadTab(key)
  }

  const displayed = search.trim()
    ? books.filter(b =>
        (b.title || '').toLowerCase().includes(search.toLowerCase()) ||
        (b.authors || '').toLowerCase().includes(search.toLowerCase())
      )
    : books

  return (
    <div style={{height:'100%', overflowY:'auto', scrollbarWidth:'thin',
      scrollbarColor:'rgba(114,57,63,0.4) transparent'}}>

      {/* Header */}
      <div style={{padding:'36px 32px 24px', borderBottom:'1px solid rgba(201,168,76,0.08)',
        background:'linear-gradient(135deg,#3d1c20 0%,#1a0a0a 100%)'}}>
        <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,fontWeight:600,
          color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 6px'}}>Most Popular</p>
        <h2 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:28,fontWeight:700,
          color:'var(--cream)',margin:'0 0 6px'}}>Trending Books</h2>
        <p style={{fontFamily:'Montaga,serif',fontSize:13,color:'rgba(255,255,255,0.6)',margin:0}}>
          The most popular and highest rated books from our collection</p>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:6,padding:'16px 28px 4px',overflowX:'auto',
        scrollbarWidth:'none',flexWrap:'nowrap'}}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => handleTabClick(t.key)}
            style={{flexShrink:0, padding:'7px 18px', borderRadius:30,
              border:`1px solid ${activeTab === t.key ? 'var(--gold)' : 'rgba(201,168,76,0.2)'}`,
              fontFamily:'Montserrat Alternates,sans-serif', fontSize:11, fontWeight:500,
              letterSpacing:'.06em', cursor:'pointer', transition:'all 0.15s',
              background: activeTab === t.key ? 'rgba(201,168,76,0.12)' : 'transparent',
              color:      activeTab === t.key ? 'var(--gold)' : 'var(--text-muted)'}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + count */}
      <div style={{padding:'12px 28px 8px', display:'flex', gap:10, alignItems:'center'}}>
        <div style={{position:'relative', flex:1, maxWidth:480}}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search within this category…"
            style={{width:'100%', padding:'9px 38px 9px 16px',
              background:'rgba(255,255,255,0.04)',
              border:'1px solid rgba(201,168,76,0.2)', borderRadius:30,
              color:'var(--text)', fontFamily:'Montaga,serif', fontSize:13,
              outline:'none', boxSizing:'border-box'}}
            onFocus={e => e.target.style.borderColor='rgba(201,168,76,0.55)'}
            onBlur={e  => e.target.style.borderColor='rgba(201,168,76,0.2)'}/>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            width="14" height="14" style={{position:'absolute', right:14, top:'50%',
              transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none'}}>
            <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
        </div>
        {search && (
          <button onClick={() => setSearch('')}
            style={{background:'none', border:'1px solid rgba(201,168,76,0.2)', borderRadius:6,
              padding:'6px 14px', color:'var(--text-muted)',
              fontFamily:'Montserrat Alternates,sans-serif', fontSize:10, cursor:'pointer'}}>
            Clear
          </button>
        )}
        {!loading && (
          <span style={{fontFamily:'Montserrat Alternates,sans-serif', fontSize:10,
            color:'var(--text-muted)', whiteSpace:'nowrap',flexShrink:0}}>
            {displayed.length} books
          </span>
        )}
      </div>

      {/* Book grid */}
      <div style={{padding:'8px 28px 56px'}}>
        <BookGrid books={displayed} loading={loading} onOpen={onOpen}/>
      </div>
    </div>
  )
}