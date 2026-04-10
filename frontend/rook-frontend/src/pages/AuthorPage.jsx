import { useState, useEffect } from 'react'
import {
  API_BASE, apiFetch,
  dedup, cleanImageUrl
} from '../hooks/useBooks'

/* ─── Shared mini helpers ──────────────────────────────────── */
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

function PageSearch({ value, onChange, placeholder }) {
  return (
    <div style={{position:'relative',flex:1,maxWidth:480}}>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||'Search…'}
             style={{width:'100%',padding:'10px 40px 10px 16px',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:30,color:'var(--text)',fontFamily:'Montaga,serif',fontSize:13,outline:'none',boxSizing:'border-box'}}
             onFocus={e=>e.target.style.borderColor='rgba(201,168,76,0.5)'}
             onBlur={e=>e.target.style.borderColor='rgba(201,168,76,0.2)'} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"
           style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)',pointerEvents:'none'}}>
        <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
      </svg>
    </div>
  )
}

function PageBanner({ eyebrow, title, sub }) {
  return (
    <div style={{padding:'36px 32px 24px',borderBottom:'1px solid rgba(201,168,76,0.08)',background:'#76845b'}}>
      {eyebrow && <p style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:15,fontWeight:600,color:'var(--cream)',letterSpacing:'.2em',textTransform:'uppercase',margin:'0 0 6px'}}>{eyebrow}</p>}
      <h2 style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:26,fontWeight:700,color:'var(--cream)',margin:'0 0 6px'}}>{title}</h2>
      {sub && <p style={{fontFamily:'Montaga,serif',fontSize:13,color:'var(--cream)',margin:0}}>{sub}</p>}
    </div>
  )
}

/* ── Author photo: Wikipedia API ── */
function AuthorPhoto({ name }) {
  const [imgUrl, setImgUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const title = name.replace(/ /g, '_')
    fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=200&origin=*`)
      .then(r => r.json())
      .then(d => {
        const pages = d?.query?.pages || {}
        const src   = Object.values(pages)[0]?.thumbnail?.source
        if (src) setImgUrl(src)
      })
      .catch(() => {})
  }, [name])

  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const hue      = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360

  if (imgUrl && !failed) {
    return (
      <img src={imgUrl} alt={name} onError={() => setFailed(true)}
        style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center top',borderRadius:'50%',display:'block'}} />
    )
  }
  return (
    <div style={{
      width:'100%',height:'100%',borderRadius:'50%',
      background:`hsl(${hue},35%,28%)`,border:`2px solid hsl(${hue},45%,42%)`,
      display:'flex',alignItems:'center',justifyContent:'center',
      fontFamily:'Montserrat Alternates,sans-serif',fontSize:22,fontWeight:700,
      color:`hsl(${hue},55%,72%)`,userSelect:'none',
    }}>{initials}</div>
  )
}

/* ── Book grid ── */
function BookGrid({ books, loading, onOpen }) {
  if (loading) return (
    <div style={{display:'flex',justifyContent:'center',padding:'48px 0'}}>
      <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,color:'var(--text-muted)',letterSpacing:'.1em'}}>Loading…</div>
    </div>
  )
  if (!books?.length) return (
    <div style={{textAlign:'center',padding:'64px 0',fontFamily:'Montaga,serif',color:'var(--text-muted)',fontSize:13}}>No books found.</div>
  )
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(148px,1fr))',gap:20,alignItems:'start'}}>
      {books.map((b,i) => (
        <div key={b.title+i} style={{cursor:'pointer',position:'relative',alignSelf:'flex-start'}}
             onClick={() => onOpen(b)}
             onMouseEnter={e => e.currentTarget.querySelector('.gc-cover').style.transform='scale(1.06) translateY(-3px)'}
             onMouseLeave={e => e.currentTarget.querySelector('.gc-cover').style.transform='scale(1)'}>
          <div className="gc-cover" style={{borderRadius:10,overflow:'hidden',width:'100%',height:222,background:'rgba(114,57,63,0.2)',transition:'transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>
            <BookCover book={b} />
          </div>
          <div style={{padding:'7px 2px 0'}}>
            <div style={{fontFamily:'Montaga,serif',fontSize:11.5,color:'var(--text)',lineHeight:1.3,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',marginBottom:2}}>{b.title}</div>
            <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9.5,fontWeight:300,color:'var(--text-muted)',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{b.authors}</div>
            {b.average_rating > 0 && <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:9,color:'var(--gold)',marginTop:2}}>{Number(b.average_rating).toFixed(1)} ★</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Featured authors list ── */
const FEATURED_AUTHORS = [
  { name:'Jane Austen' },
  { name:'J.K. Rowling' },
  { name:'Stephen King' },
  { name:'Agatha Christie' },
  { name:'George Orwell' },
  { name:'J.R.R. Tolkien' },
  { name:'Haruki Murakami' },
  { name:'F. Scott Fitzgerald' },
  { name:'Fyodor Dostoyevsky' },
  { name:'Dan Brown' },
  { name:'Leo Tolstoy' },
  { name:'Virginia Woolf' },
  { name:'Ernest Hemingway' },
  { name:'Gabriel García Márquez' },
  { name:'Toni Morrison' },
]

/* ════════════════════════════════════════════════════════════════
   AUTHOR PAGE
════════════════════════════════════════════════════════════════ */
export function AuthorPage({ onOpen, bookProps, initialAuthor }) {
  const [selectedAuthor, setSelectedAuthor] = useState(initialAuthor || '')
  const [searchInput,    setSearchInput]    = useState(initialAuthor || '')
  const [books,          setBooks]          = useState([])
  const [loading,        setLoading]        = useState(false)
  const [activeGenre,    setActiveGenre]    = useState('All')

  function loadAuthor(name) {
    if (!name?.trim()) return
    setSelectedAuthor(name)
    setLoading(true)
    setBooks([])
    setActiveGenre('All')
    apiFetch(`${API_BASE}/recommend/author?author=${encodeURIComponent(name)}&top_n=60`)
      .then(d => setBooks(dedup(Array.isArray(d) ? d : [])))
      .catch(() => setBooks([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (initialAuthor) loadAuthor(initialAuthor) }, [initialAuthor])

  // Build genre list from loaded books
  const genreList = ['All', ...Array.from(
    new Set(
      books.flatMap(b =>
        (b.genre || '').split(',').map(g => g.trim()).filter(Boolean)
      )
    )
  ).slice(0, 15)]

  // Filter by genre only
  const filtered = activeGenre === 'All'
    ? books
    : books.filter(b =>
        (b.genre || '').toLowerCase().includes(activeGenre.toLowerCase())
      )

  return (
    <div style={{height:'100%',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:'rgba(114,57,63,0.4) transparent'}}>
      <PageBanner eyebrow="Author Search" title="Explore Authors" sub="Find every book by your favourite authors" />

      {/* Author search bar */}
      <div style={{padding:'20px 28px 8px',display:'flex',gap:10}}>
        <PageSearch value={searchInput} onChange={setSearchInput} placeholder="Type an author name…" />
        <button
          onClick={() => loadAuthor(searchInput)}
          style={{padding:'10px 22px',background:'var(--maroon)',border:'none',borderRadius:8,color:'var(--cream)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:11,fontWeight:600,letterSpacing:'.1em',textTransform:'uppercase',cursor:'pointer',flexShrink:0}}>
          Search
        </button>
      </div>

      {/* Featured authors row */}
      <div style={{padding:'16px 28px 8px'}}>
        <div style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,fontWeight:600,color:'var(--text-muted)',letterSpacing:'.2em',textTransform:'uppercase',marginBottom:14}}>
          Featured Authors
        </div>
        <div style={{display:'flex',gap:16,overflowX:'auto',paddingBottom:8,scrollbarWidth:'none'}}>
          {FEATURED_AUTHORS.map(a => (
            <div key={a.name}
                 onClick={() => { setSearchInput(a.name); loadAuthor(a.name) }}
                 style={{flexShrink:0,textAlign:'center',cursor:'pointer',width:80}}>
              <div style={{
                width:64,height:64,borderRadius:'50%',overflow:'hidden',
                background:'rgba(114,57,63,0.2)',margin:'0 auto 8px',
                border: selectedAuthor === a.name ? '2px solid var(--gold)' : '2px solid rgba(201,168,76,0.2)',
                transition:'border-color 0.2s, transform 0.2s',
                transform: selectedAuthor === a.name ? 'scale(1.08)' : 'scale(1)',
              }}>
                <AuthorPhoto name={a.name} />
              </div>
              <div style={{
                fontFamily:'Montaga,serif',fontSize:10,
                color: selectedAuthor === a.name ? 'var(--gold)' : 'var(--text-dim)',
                lineHeight:1.3,overflow:'hidden',
                display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',
              }}>{a.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Results area */}
      {selectedAuthor ? (
        <div style={{padding:'8px 28px 48px'}}>

          {/* Collection header */}
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:13,fontWeight:700,color:'var(--cream)'}}>
              {selectedAuthor}
            </span>
            {!loading && books.length > 0 && (
              <span style={{fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,color:'var(--gold)',background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.2)',borderRadius:20,padding:'2px 8px'}}>
                {books.length} books
              </span>
            )}
            {!loading && filtered.length !== books.length && (
              <span style={{fontFamily:'Montaga,serif',fontSize:11,color:'var(--text-muted)'}}>
                — showing {filtered.length}
              </span>
            )}
          </div>

          {/* ── Quick Filter dropdown ── */}
          {!loading && books.length > 0 && genreList.length > 1 && (
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
              <span style={{
                fontFamily:'Montserrat Alternates,sans-serif',
                fontSize:10,fontWeight:600,
                color:'var(--text-muted)',
                letterSpacing:'.2em',textTransform:'uppercase',
                whiteSpace:'nowrap',
              }}>Quick Filter</span>

              <div style={{position:'relative'}}>
                <select
                  value={activeGenre}
                  onChange={e => setActiveGenre(e.target.value)}
                  style={{ appearance:'none',WebkitAppearance:'none',  padding:'8px 36px 8px 14px',  background:'rgba(255,255,255,0.04)',  border:'1px solid rgba(201,168,76,0.25)',  borderRadius:8, color:'var(--gold)',  fontFamily:'Montserrat Alternates,sans-serif', fontSize:11,fontWeight:600,  letterSpacing:'.06em',
                  cursor:'pointer',outline:'none',  transition:'border-color 0.2s', minWidth:160,
                  }}
                  onFocus={e => e.target.style.borderColor='rgba(201,168,76,0.6)'}
                  onBlur={e  => e.target.style.borderColor='rgba(201,168,76,0.25)'}
                >
                  {genreList.map(g => (
                    <option key={g} value={g} style={{background:'#1a0608',color:'#f0e8dc'}}>
                      {g}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                     strokeLinecap="round" width="11" height="11"
                     style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'var(--gold)',pointerEvents:'none'}}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>

              {activeGenre !== 'All' && (
                <button onClick={() => setActiveGenre('All')} style={{
                  background:'none',border:'none',
                  color:'var(--text-muted)',fontFamily:'Montserrat Alternates,sans-serif',
                  fontSize:10,cursor:'pointer',letterSpacing:'.08em',
                  textTransform:'uppercase',padding:0,
                }}>✕ Clear</button>
              )}
            </div>
          )}

          {/* Book grid */}
          <BookGrid books={filtered} loading={loading} onOpen={onOpen} />

          {/* No results after filter */}
          {!loading && books.length > 0 && filtered.length === 0 && (
            <div style={{textAlign:'center',padding:'40px 0',fontFamily:'Montaga,serif',color:'var(--text-muted)',fontSize:13}}>
              No books match this genre.
              <button onClick={() => setActiveGenre('All')}
                style={{display:'block',margin:'12px auto 0',background:'none',border:'none',color:'var(--gold)',fontFamily:'Montserrat Alternates,sans-serif',fontSize:10,cursor:'pointer',letterSpacing:'.1em',textTransform:'uppercase'}}>
                Clear Filter
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{textAlign:'center',padding:'48px',fontFamily:'Montaga,serif',color:'var(--text-muted)',fontSize:13}}>
          Search for an author above or click a featured name to see their books.
        </div>
      )}
    </div>
  )
}