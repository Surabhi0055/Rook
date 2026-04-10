import { useState, useEffect, useRef } from 'react'
import { API_BASE, apiFetch, dedup, cleanImageUrl } from '../hooks/useBooks'

function BookCover({ book }) {
  const url = cleanImageUrl(book?.image_url)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return (
    <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(114,57,63,0.2)',color:'rgba(201,168,76,0.3)'}}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
    </div>
  )
  return <img src={url} alt={book?.title||''} loading="lazy" onError={()=>setFailed(true)}
    style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} />
}

function BookGrid({ books, loading, onOpen }) {
  if (loading) return (
    <div style={{display:'flex',justifyContent:'center',padding:'64px 0'}}>
      <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,color:'var(--text-muted)',letterSpacing:'.1em'}}>Loading…</span>
    </div>
  )
  if (!books?.length) return (
    <div style={{textAlign:'center',padding:'64px 0',fontFamily:'Montaga,serif',color:'var(--text-muted)',fontSize:13}}>No books found.</div>
  )
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))',gap:20}}>
      {books.map((b,i) => (
        <div key={b.title+i} style={{cursor:'pointer',position:'relative'}} onClick={()=>onOpen(b)}
          onMouseEnter={e=>e.currentTarget.querySelector('.gc-cover').style.transform='scale(1.05) translateY(-4px)'}
          onMouseLeave={e=>e.currentTarget.querySelector('.gc-cover').style.transform='none'}>
          <div className="gc-cover" style={{borderRadius:10,overflow:'hidden',aspectRatio:'2/3',background:'rgba(114,57,63,0.2)',transition:'transform 0.2s ease',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>
            <BookCover book={b}/>
          </div>
          <div style={{padding:'7px 2px 0'}}>
            <div style={{fontFamily:'Montaga,serif',fontSize:11.5,color:'var(--text)',lineHeight:1.3,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{b.title}</div>
            <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,fontWeight:300,color:'var(--text-muted)',marginTop:2,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{b.authors}</div>
            {b.average_rating>0&&<div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,color:'var(--gold)',marginTop:2}}>{Number(b.average_rating).toFixed(1)} ★</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

const TABS = [
  { key:'all',        label:'All' },
  { key:'fiction',    label:'Fiction' },
  { key:'thriller',   label:'Thriller' },
  { key:'fantasy',    label:'Fantasy' },
  { key:'romance',    label:'Romance' },
  { key:'mystery',    label:'Mystery' },
  { key:'horror',     label:'Horror' },
  { key:'sci-fi',     label:'Sci-Fi' },
  { key:'biography',  label:'Biography' },
  { key:'comedy',     label:'Comedy' },
  { key:'classics',   label:'Classics' },
  { key:'self-help',  label:'Self-Help' },
]

const _BLOCK = ['harry potter boxed','harry potter collection','harry potter books 1',
  'lord of the rings art','lord of the rings box','jrr tolkien 4book',
  'complete works','collected works','boxed set','box set','omnibus',
  'volume 1','volume 2','vol 1','vol 2','vol 3',
]
function _clean(list) {
  const seen = new Set()
  return (list||[]).filter(b => {
    const k = (b.title||'').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    if (_BLOCK.some(bl => k.includes(bl))) return false
    seen.add(k); return true
  })
}

export function TrendingPage({ onOpen, bookProps }) {
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch]       = useState('')
  const [booksByGenre, setBooksByGenre] = useState({})
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      const data = {}
      await Promise.all(TABS.map(async (tab) => {
        try {
          const query = tab.key === 'all' ? 'trending' : `genre/${tab.key}`
          const res = await apiFetch(`${API_BASE}/${query}?top_n=100`)
          const list = Array.isArray(res) ? res : []
          data[tab.key] = _clean(list.sort((a,b) => (Number(b.average_rating)||0) - (Number(a.average_rating)||0)))
        } catch { data[tab.key] = [] }
      }))
      setBooksByGenre(data)
      setLoading(false)
    }
    load()
  }, [])

  const currentBooks = booksByGenre[activeTab] || []
  const displayed = search.trim()
    ? currentBooks.filter(b =>
        (b.title||'').toLowerCase().includes(search.toLowerCase()) ||
        (b.authors||'').toLowerCase().includes(search.toLowerCase())
      )
    : currentBooks

  return (
    <div style={{height:'100%',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:'rgba(114,57,63,0.4) transparent'}}>
      <div style={{padding:'36px 32px 24px',borderBottom:'1px solid rgba(201,168,76,0.08)',background:'#513229'}}>           
        <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:15,fontWeight:600,color:'var(--gold)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 6px'}}>Most Popular</p>
        <h2 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:26,fontWeight:700,color:'var(--cream)',margin:'0 0 6px'}}>Trending Books</h2>
        <p style={{fontFamily:'Montaga,serif',fontSize:13,color:'var(--cream)',margin:0}}>The most popular and highly rated books from our collection</p>
      </div>

      <div style={{display:'flex',gap:6,padding:'16px 28px 0',overflowX:'auto',scrollbarWidth:'none',flexWrap:'nowrap'}}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{flexShrink:0,padding:'7px 18px',borderRadius:30,border:'1px solid',
              fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:500,
              letterSpacing:'.06em',cursor:'pointer',transition:'all 0.15s',
              borderColor: activeTab===t.key ? 'var(--gold)' : 'rgba(201,168,76,0.2)',
              background:  activeTab===t.key ? 'rgba(201,168,76,0.12)' : 'transparent',
              color:       activeTab===t.key ? 'var(--gold)' : 'var(--text-muted)'}}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{padding:'14px 28px 8px',display:'flex',gap:10,alignItems:'center'}}>
        <div style={{position:'relative',flex:1,maxWidth:480}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search books…"
            style={{width:'100%',padding:'10px 40px 10px 16px',background:'rgba(255,255,255,0.05)',
              border:'1px solid rgba(201,168,76,0.2)',borderRadius:30,color:'var(--text)',
              fontFamily:'Montaga,serif',fontSize:13,outline:'none',boxSizing:'border-box'}}
            onFocus={e=>e.target.style.borderColor='rgba(201,168,76,0.5)'}
            onBlur={e=>e.target.style.borderColor='rgba(201,168,76,0.2)'}/>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
            style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)',pointerEvents:'none'}}>
            <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
        </div>
        {search && <button onClick={()=>setSearch('')} style={{background:'none',border:'1px solid rgba(201,168,76,0.2)',borderRadius:6,padding:'6px 14px',color:'var(--text-muted)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,cursor:'pointer'}}>Clear</button>}
        {!loading && <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{displayed.length} books</span>}
      </div>

      <div style={{padding:'8px 28px 48px'}}>
        <BookGrid books={displayed} loading={loading} onOpen={onOpen}/>
      </div>
    </div>
  )
}