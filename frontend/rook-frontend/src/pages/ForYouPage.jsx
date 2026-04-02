import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { API_BASE, apiFetch, dedup, cleanImageUrl } from '../hooks/useBooks'
import { fetchGBCover } from '../components/BookCard'
import { TopRatedSection } from './TopRatedPage'

const _fc = new Map()
const _FTTL = 30 * 60_000
function _fck(k) { return 'fy::' + k.slice(0, 180) }
function _fcGet(k) {
  const m = _fc.get(k); if (m) { if (Date.now() - m.ts < _FTTL) return m.d; _fc.delete(k) }
  try { const s = sessionStorage.getItem(k); if (s) { const e = JSON.parse(s); if (Date.now() - e.ts < _FTTL) { _fc.set(k, { d: e.d, ts: e.ts }); return e.d } sessionStorage.removeItem(k) } } catch {}
  return null
}
function _fcSet(k, d) {
  _fc.set(k, { d, ts: Date.now() })
  try { sessionStorage.setItem(k, JSON.stringify({ d, ts: Date.now() })) } catch {}
}

/* ─── Dedup + block helper ─── */
const _FY_BLOCK = ['harry potter boxed', 'boxed set', 'box set', 'omnibus', 'complete works', 'collected works', 'volume 1', 'volume 2', 'vol 1']
function _clean(list) {
  const seen = new Set()
  return (list || []).filter(b => {
    const k = (b.title || '').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    if (_FY_BLOCK.some(bl => k.includes(bl))) return false
    seen.add(k); return true
  })
}

/* ─── API helpers ─── */
async function _fetchMood(mood, { top_n = 20, user_genres = [], context = {} } = {}, signal) {
  const ck = _fck(`mood:${mood}:${top_n}:${user_genres.join(',')}`)
  const cached = _fcGet(ck); if (cached) return cached
  try {
    const r = await fetch(`${API_BASE}/recommend/mood`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood, top_n: top_n + 6, use_llm: false, user_genres, ...context }),
      signal,
    })
    if (!r.ok) throw new Error()
    const d = await r.json()
    const list = _clean(Array.isArray(d) ? d : (d?.books || d?.results || []))
    if (list.length) _fcSet(ck, list); return list
  } catch (e) { if (e?.name === 'AbortError') throw e; return [] }
}

async function _fetchSaved({ liked = [], saved = [], read = [], user_genres = [], top_n = 24 } = {}, signal) {
  const keys = [...liked, ...saved, ...read].slice(0, 4)
  if (!keys.length) return []
  const ck = _fck(`saved:${keys.join('|')}`)
  const cached = _fcGet(ck); if (cached) return cached
  try {
    const r = await fetch(`${API_BASE}/recommend/saved`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked_titles: liked, saved_titles: saved, read_titles: read, user_genres, top_n }),
      signal,
    })
    if (!r.ok) throw new Error()
    const d = await r.json()
    const list = _clean(Array.isArray(d) ? d : (d?.books || d?.results || []))
    if (list.length) _fcSet(ck, list); return list
  } catch (e) { if (e?.name === 'AbortError') throw e; return [] }
}

async function _fetchTitle(title, top_n = 20, signal) {
  const ck = _fck(`title:${title}:${top_n}`)
  const cached = _fcGet(ck); if (cached) return cached
  try {
    const r = await fetch(`${API_BASE}/recommend/title?title=${encodeURIComponent(title)}&top_n=${top_n}`, { signal })
    if (!r.ok) throw new Error()
    const d = await r.json()
    const list = _clean(Array.isArray(d) ? d : (d?.books || d?.results || []))
    if (list.length) _fcSet(ck, list); return list
  } catch (e) { if (e?.name === 'AbortError') throw e; return [] }
}

async function _fetchHybrid({ liked = [], saved = [], title = null, top_n = 20 } = {}, signal) {
  const ck = _fck(`hybrid:${liked.slice(0, 3).join('|')}:${title}`)
  const cached = _fcGet(ck); if (cached) return cached
  try {
    const qs = title ? `?title=${encodeURIComponent(title)}` : ''
    const r = await fetch(`${API_BASE}/recommend/hybrid${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked_titles: liked, saved_titles: saved, top_n: top_n + 6 }),
      signal,
    })
    if (!r.ok) throw new Error()
    const d = await r.json()
    const list = _clean(Array.isArray(d) ? d : (d?.books || d?.results || []))
    if (list.length) _fcSet(ck, list); return list
  } catch (e) { if (e?.name === 'AbortError') throw e; return [] }
}

async function _fetchGenre(genre, top_n = 20, signal) {
  const ck = _fck(`genre:${genre}:${top_n}`)
  const cached = _fcGet(ck); if (cached) return cached
  try {
    const r = await fetch(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(genre)}&top_n=${top_n}`, signal ? { signal } : {})
    if (!r.ok) throw new Error()
    const d = await r.json()
    const list = _clean(Array.isArray(d) ? d : (d?.books || d?.results || []))
    if (list.length) _fcSet(ck, list); return list
  } catch (e) { if (e?.name === 'AbortError') throw e; return [] }
}

/* ─── Book cover with Google Books fallback ─── */
function BookCover({ book }) {
  const local = cleanImageUrl(book?.image_url)
  const [src, setSrc] = useState(local || '')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const fresh = cleanImageUrl(book?.image_url)
    setSrc(fresh || ''); setFailed(false)
    if (!fresh && book?.title) {
      fetchGBCover(book.title, book?.authors || '').then(gb => { if (gb) setSrc(gb) })
    }
  }, [book?.image_url, book?.title])

  async function handleError() {
    if (failed) return; setFailed(true)
    const gb = await fetchGBCover(book?.title || '', book?.authors || '')
    if (gb) { setSrc(gb); setFailed(false) }
  }

  if (src && !failed) return (
    <img src={src} alt={book?.title || ''} loading="lazy" onError={handleError}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  )
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(114,57,63,0.22)', color: 'rgba(201,168,76,0.35)' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    </div>
  )
}

/* ─── Book scroll row with hover zoom ─── */
function BookScroll({ books, loading, onOpen, onLike, onSave, onRead, localStates = {} }) {
  if (loading) return (
    <div style={{ padding: '12px 0', display: 'flex', gap: 16, overflowX: 'auto' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ flexShrink: 0, width: 148 }}>
          <div style={{ width: 148, height: 222, borderRadius: 10, background: 'rgba(128,128,128,0.12)' }} />
          <div style={{ height: 10, borderRadius: 5, marginTop: 8, background: 'rgba(128,128,128,0.1)' }} />
        </div>
      ))}
    </div>
  )
  if (!books?.length) return (
    <div style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>No books found.</div>
  )
  return (
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin', scrollbarColor: 'rgba(114,57,63,0.4) transparent' }}>
      {books.map((b, i) => (
        <BookItem key={b.title + i} book={b} onOpen={onOpen} onLike={onLike} onSave={onSave} onRead={onRead} localState={localStates[b.title]} />
      ))}
    </div>
  )
}

function BookItem({ book, onOpen, onLike, onSave, onRead, localState }) {
  const [hov, setHov] = useState(false)
  return (
    <div style={{ flexShrink: 0, width: 148, cursor: 'pointer', alignSelf: 'flex-start' }}
      onClick={() => onOpen(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}>
      <div style={{
        width: 148, height: 222, borderRadius: 10, overflow: 'hidden', background: 'var(--bg2)',
        transform: hov ? 'translateY(-6px)' : 'translateY(0)',
        transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease',
        boxShadow: hov ? '0 20px 48px rgba(0,0,0,0.7)' : '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{ width: '100%', height: '100%', transform: hov ? 'scale(1.08)' : 'scale(1.0)', transition: 'transform 0.55s cubic-bezier(0.22,1,0.36,1)' }}>
          <BookCover book={book} />
        </div>
      </div>
      <div style={{ padding: '7px 2px 0', minHeight: 52 }}>
        <div style={{
          fontFamily: 'Montaga,serif', fontSize: 11.5, color: 'var(--text)', lineHeight: 1.3,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 2,
          transform: hov ? 'translateY(-1px)' : 'none', transition: 'transform 0.25s ease',
        }}>{book.title}</div>
        <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 300, color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {book.authors}
        </div>
        {book.average_rating > 0 && (
          <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, color: 'var(--gold)', marginTop: 2 }}>
            {Number(book.average_rating).toFixed(1)} ★
          </div>
        )}
        {hov && (
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }} onClick={e => e.stopPropagation()}>
            {[
              { icon: localState?.liked ? '♥' : '♡', fn: onLike, color: '#e06080', active: localState?.liked },
              { icon: localState?.saved ? '★' : '☆', fn: onSave, color: '#6a9fd8', active: localState?.saved },
              { icon: localState?.read  ? '✓' : '○', fn: onRead, color: '#50a870', active: localState?.read },
            ].map(({ icon, fn, color, active }) => (
              <button key={icon + color} onClick={e => { e.stopPropagation(); fn?.(book) }}
                style={{
                  background: active ? `${color}25` : 'rgba(0,0,0,0.4)',
                  border: `1px solid ${active ? color + '66' : 'rgba(255,255,255,0.15)'}`,
                  color: active ? color : 'rgba(255,255,255,0.5)',
                  borderRadius: '50%', width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, cursor: 'pointer', outline: 'none', transition: 'all 0.15s',
                }}
              >{icon}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Section block ─── */
function SectionBlock({ eyebrow, title, accent = 'var(--gold)', children }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          {eyebrow && (
            <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 700, color: accent, letterSpacing: '.22em', textTransform: 'uppercase', margin: '0 0 4px' }}>
              {eyebrow}
            </p>
          )}
          <h3 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h3>
        </div>
        <div style={{ height: 1, width: 60, background: `linear-gradient(90deg,${accent}44,transparent)` }} />
      </div>
      {children}
    </div>
  )
}

/* ─── Lazy section ─── */
function LazyRecSection({ eyebrow, title, accent, fetchFn, exclude = [], onOpen, onLike, onSave, onRead, localStates }) {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  const fetched = useRef(false)

  useEffect(() => {
    const el = ref.current; if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight + 400) { setInView(true); return }
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect() } }, { rootMargin: '300px' })
    obs.observe(el); return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || fetched.current) return
    fetched.current = true
    const ctrl = new AbortController()
    const excSet = new Set(exclude.map(t => t.toLowerCase()))
    fetchFn(ctrl.signal)
      .then(list => setBooks(_clean(list).filter(b => !excSet.has((b.title || '').toLowerCase())).slice(0, 20)))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [inView])

  if (!loading && !books.length) return null
  return (
    <div ref={ref}>
      <SectionBlock eyebrow={eyebrow} title={title} accent={accent}>
        <BookScroll books={books} loading={loading} onOpen={onOpen} onLike={onLike} onSave={onSave} onRead={onRead} localStates={localStates} />
      </SectionBlock>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   FOR YOU PAGE
═══════════════════════════════════════════════════════════════ */
export function ForYouPage({
  onOpen,
  bookProps,
  likedBooks = [],
  savedBooks = [],
  readBooks = [],
  onLike: onLikeProp,
  onSave: onSaveProp,
  onRead: onReadProp,
  onNav,
}) {
  // ── Optimistic local state ─────────────────────────────────────────────────
  const [localStates, setLocalStates] = useState(() => {
    const s = {}
    likedBooks.forEach(b => { if (b.title) s[b.title] = { ...(s[b.title] || {}), liked: true } })
    savedBooks.forEach(b => { if (b.title) s[b.title] = { ...(s[b.title] || {}), saved: true } })
    readBooks.forEach(b =>  { if (b.title) s[b.title] = { ...(s[b.title] || {}), read: true } })
    return s
  })

  const handleLike = useCallback((book) => {
    setLocalStates(prev => ({ ...prev, [book.title]: { ...(prev[book.title] || {}), liked: !prev[book.title]?.liked } }))
    onLikeProp?.(book)
  }, [onLikeProp])

  const handleSave = useCallback((book) => {
    setLocalStates(prev => ({ ...prev, [book.title]: { ...(prev[book.title] || {}), saved: !prev[book.title]?.saved } }))
    onSaveProp?.(book)
  }, [onSaveProp])

  const handleRead = useCallback((book) => {
    setLocalStates(prev => ({ ...prev, [book.title]: { ...(prev[book.title] || {}), read: !prev[book.title]?.read } }))
    onReadProp?.(book)
  }, [onReadProp])

  // ── Derived data ───────────────────────────────────────────────────────────
  const allSeeds    = [...readBooks, ...likedBooks, ...savedBooks]
  const likedTitles = likedBooks.map(b => b.title).filter(Boolean)
  const savedTitles = savedBooks.map(b => b.title).filter(Boolean)
  const readTitles  = readBooks.map(b => b.title).filter(Boolean)
  const allTitles   = [...new Set([...likedTitles, ...savedTitles, ...readTitles])]

  const topGenres = useMemo(() => {
    const freq = {}
    likedBooks.forEach(b => (b.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean).forEach(g => { freq[g] = (freq[g] || 0) + 3 }))
    readBooks.forEach(b =>  (b.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean).forEach(g => { freq[g] = (freq[g] || 0) + 2 }))
    savedBooks.forEach(b => (b.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean).forEach(g => { freq[g] = (freq[g] || 0) + 1 }))
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g)
  }, [likedBooks, savedBooks, readBooks])

  const likedSeed = likedBooks[0]
  const readSeed  = readBooks[0]
  const savedSeed = savedBooks.find(b => !likedBooks.some(l => l.title === b.title))
  const hasLibrary = allSeeds.length > 0

  // ── You Might Like ─────────────────────────────────────────────────────────
  const [youMightLike, setYouMightLike] = useState([])
  const [ymlLoad, setYmlLoad] = useState(true)
  useEffect(() => {
    const ctrl = new AbortController()
    async function load() {
      if (!hasLibrary) {
        const list = await _fetchMood('hopeful', { top_n: 24, user_genres: ['romance', 'literary', 'fiction'] }, ctrl.signal)
        setYouMightLike(list); setYmlLoad(false); return
      }
      try {
        const list = await _fetchSaved({ liked: likedTitles.slice(0, 8), saved: savedTitles.slice(0, 6), read: readTitles.slice(0, 5), user_genres: topGenres, top_n: 32 }, ctrl.signal)
        if (list.length >= 4) { setYouMightLike(list.filter(b => !allTitles.includes(b.title)).slice(0, 24)); setYmlLoad(false); return }
      } catch {}
      try {
        const list = await _fetchHybrid({ liked: likedTitles.slice(0, 6), saved: savedTitles.slice(0, 4), top_n: 28 }, ctrl.signal)
        setYouMightLike(list.filter(b => !allTitles.includes(b.title)).slice(0, 24))
      } catch {}
      setYmlLoad(false)
    }
    load().catch(() => setYmlLoad(false))
    return () => ctrl.abort()
  }, [likedTitles.join('|'), savedTitles.join('|'), readTitles.join('|')])

  // ── Because You Liked ──────────────────────────────────────────────────────
  const [becauseLiked, setBecauseLiked] = useState([])
  const [blLoad, setBlLoad] = useState(!!likedSeed)
  useEffect(() => {
    if (!likedSeed) { setBlLoad(false); return }
    const ctrl = new AbortController()
    async function load() {
      setBlLoad(true)
      try {
        const list = await _fetchTitle(likedSeed.title, 28, ctrl.signal)
        if (list.length >= 4) { setBecauseLiked(list.filter(b => b.title !== likedSeed.title).slice(0, 20)); setBlLoad(false); return }
      } catch {}
      try {
        const list = await _fetchHybrid({ liked: [likedSeed.title], saved: [], top_n: 28 }, ctrl.signal)
        if (list.length >= 4) { setBecauseLiked(list.filter(b => b.title !== likedSeed.title).slice(0, 20)); setBlLoad(false); return }
      } catch {}
      const g = (likedSeed.genre || '').split(',')[0].trim().toLowerCase()
      if (g) { try { const list = await _fetchGenre(g, 24, ctrl.signal); setBecauseLiked(list.filter(b => b.title !== likedSeed.title).slice(0, 20)) } catch {} }
      setBlLoad(false)
    }
    load().catch(() => setBlLoad(false))
    return () => ctrl.abort()
  }, [likedSeed?.title])

  // ── Because You Read ───────────────────────────────────────────────────────
  const [becauseRead, setBecauseRead] = useState([])
  const [brLoad, setBrLoad] = useState(!!readSeed)
  useEffect(() => {
    if (!readSeed) { setBrLoad(false); return }
    const ctrl = new AbortController()
    async function load() {
      setBrLoad(true)
      try {
        const list = await _fetchTitle(readSeed.title, 28, ctrl.signal)
        if (list.length >= 4) { setBecauseRead(list.filter(b => b.title !== readSeed.title).slice(0, 20)); setBrLoad(false); return }
      } catch {}
      try {
        const list = await _fetchHybrid({ liked: [readSeed.title], saved: [], top_n: 28 }, ctrl.signal)
        if (list.length >= 4) { setBecauseRead(list.filter(b => b.title !== readSeed.title).slice(0, 20)); setBrLoad(false); return }
      } catch {}
      const g = (readSeed.genre || '').split(',')[0].trim().toLowerCase()
      if (g) { try { const list = await _fetchGenre(g, 24, ctrl.signal); setBecauseRead(list.filter(b => b.title !== readSeed.title).slice(0, 20)) } catch {} }
      setBrLoad(false)
    }
    load().catch(() => setBrLoad(false))
    return () => ctrl.abort()
  }, [readSeed?.title])

  // ── Because You Saved ──────────────────────────────────────────────────────
  const [becauseSaved, setBecauseSaved] = useState([])
  const [bsLoad, setBsLoad] = useState(!!savedSeed)
  useEffect(() => {
    if (!savedSeed) { setBsLoad(false); return }
    const ctrl = new AbortController()
    async function load() {
      setBsLoad(true)
      try {
        const list = await _fetchTitle(savedSeed.title, 24, ctrl.signal)
        if (list.length >= 4) { setBecauseSaved(list.filter(b => b.title !== savedSeed.title).slice(0, 20)); setBsLoad(false); return }
      } catch {}
      const g = (savedSeed.genre || '').split(',')[0].trim().toLowerCase()
      if (g) { try { const list = await _fetchGenre(g, 20, ctrl.signal); setBecauseSaved(list.filter(b => b.title !== savedSeed.title).slice(0, 20)) } catch {} }
      setBsLoad(false)
    }
    load().catch(() => setBsLoad(false))
    return () => ctrl.abort()
  }, [savedSeed?.title])

  // Shared scroll props shorthand
  const scrollProps = { onOpen, onLike: handleLike, onSave: handleSave, onRead: handleRead, localStates }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)', scrollbarWidth: 'thin', scrollbarColor: 'rgba(114,57,63,0.4) transparent' }}>

      {/* Banner */}
      <div style={{ padding: '36px 32px 24px', borderBottom: '1px solid rgba(201,168,76,0.08)', background: '#5e1e2b' }}>
        <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 700, color: 'var(--gold)', letterSpacing: '.22em', textTransform: 'uppercase', margin: '0 0 6px' }}>
          Personalised Recommendations
        </p>
        <h2 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 26, fontWeight: 700, color: 'var(--cream)', margin: '0 0 6px' }}>
          For You
        </h2>
        <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--gold)', margin: 0 }}>
          {hasLibrary
            ? `Based on ${allSeeds.length} book${allSeeds.length !== 1 ? 's' : ''} in your library`
            : 'Add books to your liked, saved or read list for personalised picks'}
        </p>
      </div>

      <div style={{ padding: '24px 32px 64px', background: 'var(--bg)' }}>

        {/* You Might Like */}
        <SectionBlock eyebrow="Smart Picks" title="You Might Like" accent="#c9a84c">
          <BookScroll books={youMightLike} loading={ymlLoad} {...scrollProps} />
        </SectionBlock>

        {/* ── SHARED TOP RATED SECTION (same data as Home + TopRatedPage) ── */}
        <TopRatedSection
          likedBooks={likedBooks}
          savedBooks={savedBooks}
          readBooks={readBooks}
          onOpen={onOpen}
          onLike={handleLike}
          onSave={handleSave}
          onRead={handleRead}
          onNav={onNav}
        />

        {/* Because You Liked */}
        {likedSeed && (
          <SectionBlock eyebrow="Because You Liked" title={`"${likedSeed.title}"`} accent="#e06080">
            <BookScroll books={becauseLiked} loading={blLoad} {...scrollProps} />
          </SectionBlock>
        )}

        {/* Because You Read */}
        {readSeed && (
          <SectionBlock eyebrow="Because You Read" title={`"${readSeed.title}"`} accent="#50a870">
            <BookScroll books={becauseRead} loading={brLoad} {...scrollProps} />
          </SectionBlock>
        )}

        {/* Top genre section 1 */}
        {topGenres[0] && (
          <LazyRecSection
            eyebrow="Based on Your Taste" title={`Best ${capitalize(topGenres[0])} Books`} accent="#8080d4"
            fetchFn={s => _fetchMood(topGenres[0], { top_n: 28, user_genres: topGenres }, s)}
            exclude={allTitles} {...scrollProps}
          />
        )}

        {/* Because You Saved */}
        {savedSeed && (
          <SectionBlock eyebrow="Because You Saved" title={`"${savedSeed.title}"`} accent="#7ab8e0">
            <BookScroll books={becauseSaved} loading={bsLoad} {...scrollProps} />
          </SectionBlock>
        )}

        {/* Top genre section 2 */}
        {topGenres[1] && (
          <LazyRecSection
            eyebrow="You Might Also Like" title={`Top ${capitalize(topGenres[1])}`} accent="#e07840"
            fetchFn={s => _fetchMood(topGenres[1], { top_n: 24, user_genres: topGenres.slice(0, 3) }, s)}
            exclude={allTitles} {...scrollProps}
          />
        )}

        {/* Critically Acclaimed */}
        <LazyRecSection
          eyebrow="Award Winners" title="Critically Acclaimed" accent="#c9a84c"
          fetchFn={s => _fetchMood('intellectual', { top_n: 24, user_genres: ['literary', 'classics', 'biography', 'philosophy'] }, s)}
          exclude={allTitles} {...scrollProps}
        />

        {/* Thriller & Suspense */}
        <LazyRecSection
          eyebrow="Edge of Your Seat" title="Thriller & Suspense" accent="#c84040"
          fetchFn={s => _fetchMood('tense', { top_n: 24, user_genres: ['thriller', 'mystery', 'crime', 'horror'] }, s)}
          exclude={allTitles} {...scrollProps}
        />

        {/* Happy & Uplifting */}
        <LazyRecSection
          eyebrow="Feel Good" title="Happy & Uplifting" accent="#f0a030"
          fetchFn={s => _fetchMood('hopeful', { top_n: 24, user_genres: ['romance', 'comedy', 'young-adult', 'fiction'] }, s)}
          exclude={allTitles} {...scrollProps}
        />

        {/* Emotional Reads */}
        <LazyRecSection
          eyebrow="Dark & Beautiful" title="Emotional Reads" accent="#6a9fd8"
          fetchFn={s => _fetchMood('emotional', { top_n: 24, user_genres: ['literary', 'romance', 'classics', 'biography'] }, s)}
          exclude={allTitles} {...scrollProps}
        />

        {/* Adventure & Fantasy */}
        <LazyRecSection
          eyebrow="Epic Worlds" title="Adventure & Fantasy" accent="#e07840"
          fetchFn={s => _fetchMood('adventurous', { top_n: 24, user_genres: ['adventure', 'fantasy', 'thriller', 'young-adult'] }, s)}
          exclude={allTitles} {...scrollProps}
        />

        {/* Hidden Gems */}
        <LazyRecSection
          eyebrow="Hidden Gems" title="Underrated Must-Reads" accent="#9a7ab8"
          fetchFn={async s => {
            if (likedTitles.length) {
              try {
                const list = await _fetchHybrid({ liked: likedTitles.slice(0, 4), saved: savedTitles.slice(0, 3), top_n: 30 }, s)
                if (list.length >= 4) return list
              } catch {}
            }
            return _fetchMood('dreamy', { top_n: 24, user_genres: ['literary', 'classics', 'paranormal', 'poetry'] }, s)
          }}
          exclude={allTitles} {...scrollProps}
        />

        {/* Empty state */}
        {!hasLibrary && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <h3 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 16, color: 'var(--text)', marginBottom: 8 }}>
              Start Building Your Library
            </h3>
            <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto' }}>
              Like, save, or mark books as read to get personalised recommendations tailored just for you.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '' }