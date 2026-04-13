import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { API_BASE } from '../hooks/useBooks'
import { cleanImageUrl, fetchGBCover, CoverImg } from '../utils/imageUtils'

if (typeof document !== 'undefined' && !document.getElementById('rook-spin-style')) {
  const s = document.createElement('style')
  s.id = 'rook-spin-style'
  s.textContent = '@keyframes spin { to { transform: rotate(360deg) } }'
  document.head.appendChild(s)
}

function getRatingsKey() {
  try {
    const u = JSON.parse(localStorage.getItem('rook_user') || '{}');
    const uk = u.username || u.email || u.id || 'guest';
    return `rook_user_ratings_${uk}`;
  } catch { return 'rook_user_ratings_guest'; }
}

function getStoredRatings() {
  try { return JSON.parse(localStorage.getItem(getRatingsKey()) || '{}') } catch { return {} }
}

// ─── Session cache (20-min TTL) ───────────────────────────────────────────────
const _CACHE = new Map()
const _TTL   = 20 * 60_000

function cGet(k) {
  const m = _CACHE.get(k)
  if (m) { if (Date.now() - m.ts > _TTL) { _CACHE.delete(k) } else return m.data }
  try {
    const s = sessionStorage.getItem(k)
    if (s) { const e = JSON.parse(s); if (Date.now() - e.ts < _TTL) { _CACHE.set(k, e); return e.data } sessionStorage.removeItem(k) }
  } catch {}
  return null
}
function cSet(k, d) {
  const e = { data: d, ts: Date.now() }
  _CACHE.set(k, e)
  try { sessionStorage.setItem(k, JSON.stringify(e)) } catch {}
}

function dedupByTitle(arr) {
  const seen = new Set()
  return (arr || []).filter(b => {
    const k = (b.title || '').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    seen.add(k); return true
  })
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreBook(book, { topGenres = [], likedSet = new Set(), readSet = new Set(), savedSet = new Set() } = {}) {
  let score = 0
  const reasons = []
  const titleKey = (book.title || '').toLowerCase().trim()
  const ur = Number(book._userRating) || 0

  if (ur === 5)      { score += 50; reasons.push('rated') }
  else if (ur === 4) { score += 35; reasons.push('rated') }

  if (likedSet.has(titleKey)) { score += 25; reasons.push('liked') }
  if (readSet.has(titleKey))  { score += 15; reasons.push('read') }
  if (savedSet.has(titleKey)) { score += 8;  reasons.push('saved') }

  const bookGenres = (book.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean)
  let genreScore = 0
  topGenres.forEach((g, i) => { if (bookGenres.includes(g)) genreScore += Math.max(2, 10 - i * 2) })
  if (genreScore > 0) { score += Math.min(genreScore, 18); reasons.push('genre') }

  score += Number(book.average_rating) || 0
  return { score, reasons: [...new Set(reasons)] }
}

export function getWhyLabel(reasons = [], userRating = 0) {
  if (userRating >= 5) return { label: 'You rated 5★', color: '#f59e0b' }
  if (userRating >= 4) return { label: 'You rated 4★', color: '#e8a020' }
  if (reasons.includes('liked'))    return { label: 'You liked this',    color: '#e06080' }
  if (reasons.includes('read'))     return { label: "You've read this",  color: '#50a870' }
  if (reasons.includes('saved'))    return { label: 'In your library',   color: '#6a9fd8' }
  if (reasons.includes('genre'))    return { label: 'Fits your genres',  color: '#8080d4' }
  if (reasons.includes('trending')) return { label: 'Popular pick',      color: '#6a9fd8' }
  return { label: 'Community pick', color: 'var(--text-muted)' }
}

export function deriveTopGenres(likedBooks = [], readBooks = [], savedBooks = [], limit = 5) {
  const freq = {}
  likedBooks.forEach(b => (b.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean).forEach(g => { freq[g] = (freq[g] || 0) + 3 }))
  readBooks.forEach(b  => (b.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean).forEach(g => { freq[g] = (freq[g] || 0) + 2 }))
  savedBooks.forEach(b => (b.genre || '').split(',').map(g => g.trim().toLowerCase()).filter(Boolean).forEach(g => { freq[g] = (freq[g] || 0) + 1 }))
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([g]) => g)
}

// ─── Core data loader ─────────────────────────────────────────────────────────
export async function loadTopRatedData({ likedBooks = [], savedBooks = [], readBooks = [], signal } = {}) {
  const ratingMap = getStoredRatings()
  const goodRatingEntries = Object.entries(ratingMap).filter(([, r]) => Number(r) >= 4)

  const likedTitles = likedBooks.map(b => b.title).filter(Boolean)
  const readTitles  = readBooks.map(b  => b.title).filter(Boolean)
  const likedSet    = new Set(likedTitles.map(t => t.toLowerCase().trim()))
  const readSet     = new Set(readTitles.map(t  => t.toLowerCase().trim()))
  const savedSet    = new Set(savedBooks.map(b  => (b.title || '').toLowerCase().trim()))

  const ck = `trd2::${goodRatingEntries.map(([id]) => id).sort().join(',')}|${likedTitles.slice(0,4).join(',')}|${readTitles.slice(0,4).join(',')}`
  const cached = cGet(ck)
  if (cached) return cached

  const seenTitles = new Set()
  const pool       = []

  function normalizeDBBook(b) {
    const pubYear =
      b.published_date ||
      (b.publication_year ? String(b.publication_year) : '') ||
      ''
    return {
      ...b,
      // Ensure book_id is numeric
      book_id: b.book_id || b.id || null,
      // Map DB publication_year → published_date expected by modal
      published_date: pubYear,
      // Ensure authors never shows "Unknown" when it's actually null/empty
      authors: b.authors || '',
      // Ensure genre is a string
      genre: b.genre || '',
      // Ensure image_url is a string
      image_url: b.image_url || '',
      // Ensure ratings are numbers
      average_rating: Number(b.average_rating) || 0,
      rating_count: Number(b.rating_count) || 0,
    }
  }

  function absorb(bookObj, src, overrideRating = 0) {
    const k = (bookObj.title || '').toLowerCase().trim()
    if (!k || seenTitles.has(k)) return
    seenTitles.add(k)
    const bookId = bookObj.book_id || bookObj.id
    const ur = overrideRating || Number(ratingMap[String(bookId)]) || 0
    pool.push({ ...bookObj, _userRating: ur, _src: src })
  }

  if (goodRatingEntries.length > 0) {
    await Promise.allSettled(
      goodRatingEntries.map(async ([id, rating]) => {
        try {
          const r = await fetch(`${API_BASE}/books/${id}`, { signal })
          if (r.ok) {
            const b = await r.json()
            if (b?.title) absorb(normalizeDBBook({ ...b, book_id: b.book_id || id }), 'rated', Number(rating))
          }
        } catch (e) { if (e?.name === 'AbortError') throw e }
      })
    )
  }

  likedBooks.forEach(b  => absorb(b, 'liked'))
  readBooks.forEach(b   => absorb(b, 'read'))
  savedBooks.forEach(b  => absorb(b, 'saved'))

  const topGenres = deriveTopGenres(likedBooks, readBooks, savedBooks)
  const seedTitles = [
    ...pool.filter(b => b._userRating >= 4).map(b => b.title),
    ...likedTitles,
  ].filter(Boolean).slice(0, 8)

  const allOwned = new Set(pool.map(b => (b.title || '').toLowerCase().trim()))

  async function fetchRecs(url, opts, tag) {
    try {
      const r = await fetch(url, { signal, ...opts })
      if (!r.ok) return
      const d = await r.json()
      dedupByTitle(Array.isArray(d) ? d : (d?.books || d?.results || []))
        .filter(b => !allOwned.has((b.title || '').toLowerCase().trim()))
        .forEach(b => { absorb(b, tag); allOwned.add((b.title || '').toLowerCase().trim()) })
    } catch (e) { if (e?.name === 'AbortError') throw e }
  }

  if (seedTitles.length > 0) {
    await fetchRecs(`${API_BASE}/recommend/saved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked_titles: seedTitles, saved_titles: readTitles.slice(0, 5), read_titles: [], user_genres: topGenres, user_action: 'top_rated', top_n: 40 }),
    }, 'rec')
  }

  for (const genre of topGenres.slice(0, 3)) {
    if (pool.length >= 40) break
    await fetchRecs(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(genre)}&top_n=20`, {}, 'genre')
  }

  if (pool.length < 16) {
    await fetchRecs(`${API_BASE}/recommend/mood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood: 'award-winning critically acclaimed highly rated Booker Prize Nobel beloved masterpiece', top_n: 40, use_llm: false, user_genres: topGenres, liked_titles: seedTitles.slice(0, 5) }),
    }, 'mood')
  }

  if (pool.length < 10) {
    await fetchRecs(`${API_BASE}/trending?top_n=40`, {}, 'trending')
  }

  const scored = pool
    .filter(b => { const ur = Number(b._userRating) || 0; return ur === 0 || ur >= 3 })
    .map(b => {
      const { score, reasons } = scoreBook(b, { topGenres, likedSet, readSet, savedSet })
      return { ...b, _score: score, _reasons: reasons }
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, 36)

  cSet(ck, scored)
  return scored
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function WhyBadge({ reasons, userRating, compact = false }) {
  const { label, color } = getWhyLabel(reasons || [], userRating || 0)
  return (
    <span style={{
      fontFamily: 'Montserrat Alternates,sans-serif',
      fontSize: compact ? 8.5 : 9, fontWeight: 600,
      color, background: `${color}18`, border: `1px solid ${color}35`,
      borderRadius: 20, padding: compact ? '1px 7px' : '2px 8px',
      letterSpacing: '.04em', whiteSpace: 'nowrap', display: 'inline-block',
    }}>{label}</span>
  )
}

function StarRow({ rating }) {
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {[1,2,3,4,5].map(v => (
        <span key={v} style={{ fontSize: 12, color: v <= rating ? '#f59e0b' : 'rgba(201,168,76,0.18)', lineHeight: 1 }}>★</span>
      ))}
    </div>
  )
}

// ─── Scroll card for TopRatedSection ─────────────────────────────────────────
function TopRatedScrollCard({ book, rank, onOpen }) {
  const [hov, setHov] = useState(false)
  const ur = Number(book._userRating) || 0
  const rankColors = { 1: '#f59e0b', 2: '#9ca3af', 3: '#b45309' }
  const rankColor  = rankColors[rank] || 'rgba(201,168,76,0.4)'

  return (
    <div
      style={{ flexShrink: 0, width: 148, cursor: 'pointer', alignSelf: 'flex-start' }}
      onClick={() => onOpen?.(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ position: 'relative', width: 148, height: 222 }}>
        <div style={{
          width: '100%', height: '100%', borderRadius: 10, overflow: 'hidden',
          background: 'var(--bg2)',
          transform: hov ? 'translateY(-6px)' : 'translateY(0)',
          transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease',
          boxShadow: hov
            ? '0 20px 48px rgba(0,0,0,0.7)'
            : rank <= 3
              ? `0 0 0 2px ${rankColor}55, 0 3px 12px rgba(0,0,0,0.4)`
              : '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          <div style={{ width: '100%', height: '100%', transform: hov ? 'scale(1.08)' : 'scale(1)', transition: 'transform 0.55s cubic-bezier(0.22,1,0.36,1)' }}>
            <CoverImg book={book} />
          </div>
        </div>
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 20,
          width: 28, height: 28, borderRadius: '50%',
          background: rank <= 3 ? rankColor : 'rgba(0,0,0,0.65)',
          border: `2px solid ${rank <= 3 ? rankColor : 'rgba(255,255,255,0.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Montserrat Alternates,sans-serif', fontSize: rank <= 3 ? 11 : 10, fontWeight: 700,
          color: rank <= 3 ? '#fff' : 'rgba(255,255,255,0.7)',
          boxShadow: rank <= 3 ? `0 2px 10px ${rankColor}88` : '0 1px 4px rgba(0,0,0,0.5)',
          transform: hov ? 'translateY(-6px)' : 'translateY(0)',
          transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1)', pointerEvents: 'none',
        }}>{rank}</div>
        {ur >= 4 && (
          <div style={{
            position: 'absolute', bottom: 8, right: 8, zIndex: 20,
            background: 'rgba(0,0,0,0.78)', border: '1px solid rgba(245,158,11,0.6)',
            borderRadius: 20, padding: '2px 7px',
            fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: '#f59e0b',
            transform: hov ? 'translateY(-6px)' : 'translateY(0)',
            transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1)', pointerEvents: 'none',
          }}>{ur}★</div>
        )}
      </div>
      <div style={{ padding: '7px 2px 0', minHeight: 52 }}>
        <div style={{ fontFamily: 'Montaga,serif', fontSize: 11.5, color: 'var(--text)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 3 }}>
          {book.title}
        </div>
        <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 300, color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginBottom: 4 }}>
          {book.authors}
        </div>
        <WhyBadge reasons={book._reasons} userRating={ur} compact />
      </div>
    </div>
  )
}

// ─── EXPORTED: TopRatedSection for Home / ForYou ─────────────────────────────
export function TopRatedSection({ likedBooks = [], savedBooks = [], readBooks = [], onOpen, onNav, eyebrow, title = 'Top Rated for You', accent = '#f59e0b' }) {
  const [books,   setBooks]   = useState([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef('')

  const ratingMap       = getStoredRatings()
  const goodRatingCount = Object.values(ratingMap).filter(r => Number(r) >= 4).length
  const hasUserData     = likedBooks.length > 0 || readBooks.length > 0 || goodRatingCount > 0
  const seedKey         = `${goodRatingCount}|${likedBooks.length}|${readBooks.length}`

  useEffect(() => {
    if (fetchedRef.current === seedKey && books.length > 0) return
    fetchedRef.current = seedKey
    setLoading(true)
    const ctrl = new AbortController()
    loadTopRatedData({ likedBooks, savedBooks, readBooks, signal: ctrl.signal })
      .then(list => setBooks(list.slice(0, 12)))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [seedKey])

  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, padding: '0 38px' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 700, color: accent, letterSpacing: '.22em', textTransform: 'uppercase', margin: '0 0 4px' }}>
            {eyebrow || (hasUserData ? 'Your Personal Chart' : 'Community Picks')}
          </p>
          <h3 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{title}</h3>
        </div>
        {onNav && (
          <button onClick={() => onNav('toprated')}
            style={{ background: 'none', border: 'none', fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 600, color: accent, cursor: 'pointer', letterSpacing: '.08em', padding: '4px 8px', borderRadius: 6, transition: 'opacity 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >See All →</button>
        )}
        <div style={{ height: 1, width: 60, background: `linear-gradient(90deg,${accent}44,transparent)` }} />
      </div>

      {loading ? (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, paddingLeft: 28 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ flexShrink: 0, width: 148 }}>
              <div style={{ width: 148, height: 222, borderRadius: 10, background: 'rgba(128,128,128,0.12)' }} />
              <div style={{ height: 10, borderRadius: 5, marginTop: 8, background: 'rgba(128,128,128,0.1)' }} />
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <div style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>
          Rate books 4–5★ or like/read them to see your personal chart.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, paddingLeft: 28, scrollbarWidth: 'thin', scrollbarColor: 'rgba(114,57,63,0.4) transparent' }}>
          {books.map((b, i) => <TopRatedScrollCard key={b.title + i} book={b} rank={i + 1} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PAGE COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function ActionButtons({ book, localState, onLike, onSave, onRead, isLight }) {
  const btnStyle = (active, color) => ({
    display: 'flex', alignItems: 'center', gap: 3,
    fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 600,
    color: active ? color : (isLight ? 'rgba(60,30,10,0.55)' : 'rgba(255,255,255,0.45)'),
    background: active ? `${color}18` : (isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'),
    border: `1px solid ${active ? color + '55' : (isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.1)')}`,
    borderRadius: 20, padding: '4px 9px', cursor: 'pointer', transition: 'all 0.15s ease', outline: 'none',
  })
  const stop = (e, fn) => { e.stopPropagation(); fn?.() }
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
      <button style={btnStyle(localState?.liked, '#e06080')} onClick={e => stop(e, () => onLike?.(book))}>{localState?.liked ? '♥' : '♡'} Like</button>
      <button style={btnStyle(localState?.saved, '#6a9fd8')} onClick={e => stop(e, () => onSave?.(book))}>{localState?.saved ? '★' : '☆'} Save</button>
      <button style={btnStyle(localState?.read,  '#50a870')} onClick={e => stop(e, () => onRead?.(book))}>{localState?.read  ? '✓' : '○'} Read</button>
    </div>
  )
}

function PodiumCard({ book, rank, onOpen, onLike, onSave, onRead, localState, isLight }) {
  const [hov, setHov] = useState(false)
  const rankColors = { 1: '#f59e0b', 2: '#9ca3af', 3: '#b45309' }
  const color = rankColors[rank] || 'var(--gold)'
  const rankLabels = { 1: '1st', 2: '2nd', 3: '3rd' }
  const ur = Number(book._userRating) || 0

  return (
    <div
      onClick={() => onOpen?.(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: '1 1 240px', minWidth: 0, cursor: 'pointer',
        background: hov
          ? (isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)')
          : ur >= 4
            ? (isLight ? `${color}12` : 'rgba(245,158,11,0.05)')
            : (isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)'),
        border: `1px solid ${ur >= 4 ? color + '55' : color + '28'}`,
        borderRadius: 14, padding: '16px', transition: 'all 0.2s',
        boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.3)' : ur >= 4 ? `0 0 0 1px ${color}22` : 'none',
        transform: hov ? 'translateY(-3px)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: `${color}18`, border: `2px solid ${color}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 12, fontWeight: 700, color }}>
          {rankLabels[rank]}
        </div>
        <div style={{ width: 44, height: 64, borderRadius: 6, overflow: 'hidden', flexShrink: 0, boxShadow: '0 3px 10px rgba(0,0,0,0.4)' }}>
          <CoverImg book={book} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Montaga,serif', fontSize: 13.5, color: isLight ? '#1e0e00' : 'var(--cream)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginBottom: 3 }}>
            {book.title}
          </div>
          <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: isLight ? 'rgba(60,30,10,0.6)' : 'var(--text-muted)', marginBottom: 6 }}>
            {book.authors ? book.authors.split(',')[0].trim() : ''}
          </div>
          {ur >= 4
            ? <StarRow rating={ur} />
            : book.average_rating > 0 && (
              <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: isLight ? 'rgba(160,100,0,0.7)' : 'rgba(201,168,76,0.6)' }}>
                avg {Number(book.average_rating).toFixed(1)}★
              </span>
            )
          }
        </div>
      </div>
      <WhyBadge reasons={book._reasons} userRating={ur} />
      <ActionButtons book={book} localState={localState} onLike={onLike} onSave={onSave} onRead={onRead} isLight={isLight} />
    </div>
  )
}

function RankedItem({ book, rank, onOpen, onLike, onSave, onRead, localState, isLight }) {
  const [hov, setHov] = useState(false)
  const ur = Number(book._userRating) || 0
  const { label: whyLabel, color: whyColor } = getWhyLabel(book._reasons || [], ur)

  return (
    <div
      onClick={() => onOpen?.(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        background: hov
          ? (isLight ? 'rgba(201,168,76,0.08)' : 'rgba(201,168,76,0.06)')
          : rank % 2 === 0
            ? (isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.02)')
            : 'transparent',
        cursor: 'pointer', transition: 'background 0.15s',
      }}
    >
      <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 700, color: rank <= 3 ? '#f59e0b' : (isLight ? 'rgba(60,30,10,0.45)' : 'var(--text-muted)'), minWidth: 22, textAlign: 'right' }}>
        #{rank}
      </span>
      <div style={{ width: 36, height: 52, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
        <CoverImg book={book} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Montaga,serif', fontSize: 12.5, color: isLight ? '#1e0e00' : 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {book.title}
        </div>
        <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, color: isLight ? 'rgba(60,30,10,0.55)' : 'var(--text-muted)', marginTop: 2 }}>
          {book.authors ? book.authors.split(',')[0].trim() : ''}
        </div>
        <div style={{ marginTop: 3 }}>
          <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 8.5, fontWeight: 600, color: whyColor, background: `${whyColor}18`, border: `1px solid ${whyColor}35`, borderRadius: 20, padding: '1px 7px' }}>
            {whyLabel}
          </span>
        </div>
      </div>
      {ur >= 4 && <div style={{ flexShrink: 0 }}><StarRow rating={ur} /></div>}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        {[
          { icon: localState?.liked ? '♥' : '♡', fn: onLike, color: '#e06080', active: localState?.liked },
          { icon: localState?.saved ? '★' : '☆', fn: onSave, color: '#6a9fd8', active: localState?.saved },
          { icon: localState?.read  ? '✓' : '○', fn: onRead, color: '#50a870', active: localState?.read  },
        ].map(({ icon, fn, color, active }) => (
          <button key={icon + color}
            onClick={e => { e.stopPropagation(); fn?.(book) }}
            style={{
              background: active ? `${color}20` : 'transparent',
              border: `1px solid ${active ? color + '55' : (isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.1)')}`,
              color: active ? color : (isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.3)'),
              borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, cursor: 'pointer', transition: 'all 0.15s', outline: 'none',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.color = color; e.currentTarget.style.borderColor = color + '55' } }}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.color = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.3)'; e.currentTarget.style.borderColor = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.1)' } }}
          >{icon}</button>
        ))}
      </div>
    </div>
  )
}

function EmptyState({ isLight, onNav }) {
  const col = isLight ? 'rgba(60,30,10,0.5)' : 'var(--text-muted)'
  return (
    <div style={{ textAlign: 'center', padding: '72px 36px' }}>
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" width="52" height="52" style={{ color: 'rgba(201,168,76,0.2)', marginBottom: 18 }}>
        <polygon points="24 4 30 16 44 18 34 28 36 42 24 36 12 42 14 28 4 18 18 16 24 4" />
      </svg>
      <h3 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 16, color: isLight ? '#1e0e00' : 'var(--cream)', marginBottom: 8 }}>
        No personalised rankings yet
      </h3>
      <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: col, maxWidth: 340, margin: '0 auto 10px' }}>
        Rate books <strong>4–5★</strong> using the stars on any book, or press <strong>Like</strong> / <strong>Read</strong> to build your chart.
      </p>
      <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: col, marginBottom: 24 }}>
        1–3★ ratings only appear in <em>Your Ratings</em> — not here.
      </p>
      {onNav && (
        <button onClick={() => onNav('trending')}
          style={{ padding: '10px 24px', background: 'var(--maroon)', border: 'none', borderRadius: 8, color: 'var(--cream)', fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
          Browse Books →
        </button>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function TopRatedPage({
  onOpen, likedBooks = [], savedBooks = [], readBooks = [],
  onLike, onSave, onRead, onNav,
}) {
  const [books,   setBooks]   = useState([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef('')

  const [isLight, setIsLight] = useState(() => document.documentElement.getAttribute('data-theme') === 'light')
  useEffect(() => {
    const obs = new MutationObserver(() => setIsLight(document.documentElement.getAttribute('data-theme') === 'light'))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const baseStates = useMemo(() => {
    const s = {}
    likedBooks.forEach(b => { if (b.title) s[b.title] = { ...(s[b.title] || {}), liked: true } })
    savedBooks.forEach(b => { if (b.title) s[b.title] = { ...(s[b.title] || {}), saved: true } })
    readBooks.forEach(b  => { if (b.title) s[b.title] = { ...(s[b.title] || {}), read:  true } })
    return s
  }, [likedBooks, savedBooks, readBooks])

  const [optimistic, setOptimistic] = useState({})
  const localStates = useMemo(() => {
    const m = { ...baseStates }
    Object.entries(optimistic).forEach(([t, o]) => { m[t] = { ...(m[t] || {}), ...o } })
    return m
  }, [baseStates, optimistic])

  const handleLike = useCallback((book) => {
    setOptimistic(p => ({ ...p, [book.title]: { ...(p[book.title] || {}), liked: !localStates[book.title]?.liked } }))
    onLike?.(book)
  }, [onLike, localStates])
  const handleSave = useCallback((book) => {
    setOptimistic(p => ({ ...p, [book.title]: { ...(p[book.title] || {}), saved: !localStates[book.title]?.saved } }))
    onSave?.(book)
  }, [onSave, localStates])
  const handleRead = useCallback((book) => {
    setOptimistic(p => ({ ...p, [book.title]: { ...(p[book.title] || {}), read: !localStates[book.title]?.read } }))
    onRead?.(book)
  }, [onRead, localStates])

  const ratingMap     = getStoredRatings()
  const goodRatingIds = Object.entries(ratingMap).filter(([, r]) => Number(r) >= 4).map(([id]) => id).sort().join(',')
  const seedKey = `${goodRatingIds}|${likedBooks.map(b => b.title).sort().join(',')}|${readBooks.map(b => b.title).sort().join(',')}`

  useEffect(() => {
    if (fetchedRef.current === seedKey && books.length > 0) return
    fetchedRef.current = seedKey
    setLoading(true)
    const ctrl = new AbortController()
    loadTopRatedData({ likedBooks, savedBooks, readBooks, signal: ctrl.signal })
      .then(list => setBooks(list))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [seedKey])

  const hasUserData    = likedBooks.length > 0 || readBooks.length > 0 || Object.keys(ratingMap).length > 0
  const hasGoodRatings = Object.values(ratingMap).some(r => Number(r) >= 4)
  const topGenres      = deriveTopGenres(likedBooks, readBooks, savedBooks)
  const podiumBooks    = books.slice(0, 3)

  const headingColor      = isLight ? '#1e0e00' : 'var(--cream)'
  const subtitleColor     = isLight ? 'rgba(60,30,10,0.6)' : 'var(--text-muted)'
  const dividerColor      = isLight ? 'rgba(160,110,40,0.18)' : 'rgba(201,168,76,0.08)'
  const sectionLabelColor = isLight ? 'rgba(110,70,8,0.7)' : 'var(--text-muted)'

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={{ padding: '28px 32px 24px', borderBottom: `1px solid ${dividerColor}`, background: isLight ? 'linear-gradient(135deg,rgba(200,150,50,0.08) 0%,transparent 100%)' : 'linear-gradient(135deg,rgba(114,57,63,0.14) 0%,transparent 100%)' }}>
        <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: '#f59e0b', letterSpacing: '.2em', textTransform: 'uppercase', margin: '0 0 6px' }}>
          {hasUserData ? 'Personalised for You' : 'Community Picks'}
        </p>
        <h2 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 26, fontWeight: 700, color: headingColor, margin: '0 0 6px' }}>
          Top Rated Books
        </h2>
        <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: subtitleColor, margin: 0 }}>
          {hasUserData
            ? 'Ranked by your 4–5★ ratings, likes and reads — low ratings excluded'
            : 'Top books ranked by community average rating'}
        </p>

        {topGenres.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {topGenres.map(g => (
              <span key={g} style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', borderRadius: 20, padding: '3px 12px', textTransform: 'capitalize', letterSpacing: '.08em' }}>{g}</span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          {[
            { color: '#f59e0b', label: '4–5★ rated by you' },
            { color: '#e06080', label: 'Liked by you' },
            { color: '#50a870', label: 'Read by you' },
            { color: '#8080d4', label: 'Genre fit' },
            { color: '#6a9fd8', label: 'Community picks' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
              <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, color: subtitleColor }}>{label}</span>
            </div>
          ))}
        </div>

        {hasUserData && !hasGoodRatings && likedBooks.length === 0 && readBooks.length === 0 && (
          <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: '#f59e0b', margin: '12px 0 0', opacity: 0.85 }}>
            💡 Rate a book 4–5★ or tap Like / Read to personalise your chart
          </p>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '80px 0' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2.5px solid rgba(201,168,76,0.15)', borderTopColor: '#f59e0b', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, color: subtitleColor, letterSpacing: '.1em' }}>
            Building your personal rankings…
          </p>
        </div>
      ) : books.length === 0 ? (
        <EmptyState isLight={isLight} onNav={onNav} />
      ) : (
        <div style={{ paddingBottom: 64 }}>
          {podiumBooks.length > 0 && (
            <div style={{ padding: '28px 32px 20px' }}>
              <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: sectionLabelColor, letterSpacing: '.2em', textTransform: 'uppercase', margin: '0 0 14px' }}>Top 3</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {podiumBooks.map((b, i) => (
                  <PodiumCard key={b.title} book={b} rank={i + 1}
                    onOpen={onOpen} onLike={handleLike} onSave={handleSave} onRead={handleRead}
                    localState={localStates[b.title]} isLight={isLight} />
                ))}
              </div>
            </div>
          )}

          <div style={{ margin: '4px 32px 20px', borderBottom: `1px solid ${dividerColor}` }} />

          <div style={{ padding: '0 32px 8px' }}>
            <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: sectionLabelColor, letterSpacing: '.2em', textTransform: 'uppercase', margin: '0 0 4px' }}>Full List</p>
          </div>
          <div style={{ margin: '0 32px', borderRadius: 12, overflow: 'hidden', border: `1px solid ${dividerColor}` }}>
            {books.map((b, i) => (
              <RankedItem key={b.title + i} book={b} rank={i + 1}
                onOpen={onOpen} onLike={handleLike} onSave={handleSave} onRead={handleRead}
                localState={localStates[b.title]} isLight={isLight} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}