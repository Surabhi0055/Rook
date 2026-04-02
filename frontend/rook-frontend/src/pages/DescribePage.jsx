import { useState, useEffect, useRef } from 'react'
import { API_BASE, dedup, cleanImageUrl } from '../hooks/useBooks'
import { fetchGBCover } from '../components/BookCard'

/* ─── Block list — same as Home.jsx ─── */
const _BLOCK = ['harry potter boxed','boxed set','box set','omnibus','complete works','volume 1','volume 2','vol 1','vol 2']
function _clean(list) {
  const seen = new Set()
  return (list || []).filter(b => {
    const k = (b.title || '').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    if (_BLOCK.some(bl => k.includes(bl))) return false
    seen.add(k); return true
  })
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

/* ─── Book card with zoom hover ─── */
function BookCard({ book, onOpen }) {
  const [hov, setHov] = useState(false)
  return (
    <div style={{ cursor: 'pointer', position: 'relative' }}
      onClick={() => onOpen(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}>
      <div style={{
        borderRadius: 10, overflow: 'hidden', aspectRatio: '2/3',
        background: 'rgba(114,57,63,0.2)',
        transform: hov ? 'translateY(-6px)' : 'translateY(0)',
        transition: 'transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease',
        boxShadow: hov ? '0 20px 48px rgba(0,0,0,0.7)' : '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          width: '100%', height: '100%',
          transform: hov ? 'scale(1.08)' : 'scale(1.0)',
          transition: 'transform 0.55s cubic-bezier(0.22,1,0.36,1)',
        }}>
          <BookCover book={book} />
        </div>
      </div>
      <div style={{ padding: '7px 2px 0' }}>
        <div style={{
          fontFamily: 'Montaga,serif', fontSize: 11.5, color: 'var(--text)',
          lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 2,
          transform: hov ? 'translateY(-1px)' : 'none', transition: 'transform 0.25s ease',
        }}>{book.title}</div>
        <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9.5, fontWeight: 300, color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{book.authors}</div>
        {book.average_rating > 0 && (
          <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, color: 'var(--gold)', marginTop: 2 }}>{Number(book.average_rating).toFixed(1)} ★</div>
        )}
      </div>
    </div>
  )
}

/* ─── Example prompts ─── */
const EXAMPLES = [
  { label: 'Cosy Mystery', prompt: 'A cosy mystery set in a small English village with a clever amateur detective' },
  { label: 'Epic Fantasy', prompt: 'An epic fantasy with found family, political intrigue and world-building' },
  { label: 'Thriller', prompt: 'A psychological thriller you can finish in one sitting with a twist ending' },
  { label: 'Grief & Healing', prompt: 'An uplifting story about grief and healing that makes you cry and smile' },
  { label: 'Dark Academia', prompt: 'Dark academia with beautiful lyrical prose and morally complex characters' },
  { label: 'Historical Fiction', prompt: 'Vivid historical fiction set in ancient Rome with a strong female protagonist' },
  { label: 'Funny & Absurd', prompt: 'A witty, absurdist comedy with an unreliable narrator and laugh-out-loud moments' },
  { label: 'Short Stories', prompt: 'A beautiful short story collection about loneliness and human connection' },
  { label: 'Coming of Age', prompt: 'A coming of age story about identity, family secrets and first love' },
  { label: 'Crime Noir', prompt: 'A gritty noir crime novel set in 1940s Los Angeles with a morally grey detective' },
]

function _analyseDescription(q) {
  const t = q.toLowerCase()

  // Mood key detection — matches backend _MOOD_TO_GENRES keys exactly
  let moodKey = 'hopeful' // safe default
  if (/thrill|suspense|paranoi|nail.bit|grip|cant.put|page.turn|twist|psych/i.test(t)) moodKey = 'tense'
  else if (/dark|gritt|disturb|bleak|sinister|dread|menac|unsettl|moral.complex/i.test(t)) moodKey = 'dark'
  else if (/romance|love.story|slow.burn|enemies.to.lovers|heart.warm|tender|passion|falling.in.love|yearning/i.test(t)) moodKey = 'romantic'
  else if (/funny|humou|comic|laugh|witty|absurd|satir|quirky|lightheart/i.test(t)) moodKey = 'funny'
  else if (/cosy|cozy|comfort|warm|village|fireside|gentle|small.town|charm/i.test(t)) moodKey = 'cosy'
  else if (/sad|grief|heartbreak|cry|loss|mourn|cathart|emotional|moving|tear/i.test(t)) moodKey = 'emotional'
  else if (/adventure|epic|quest|journey|daring|action|survival|adrenalin/i.test(t)) moodKey = 'adventurous'
  else if (/lyric|surreal|dream|magic|ethereal|atmospheric|poetic|otherworld/i.test(t)) moodKey = 'dreamy'
  else if (/philosoph|intellect|thought.provok|complex|nuan|stimulat|challeng/i.test(t)) moodKey = 'intellectual'
  else if (/uplifting|redempti|second.chance|inspir|hopeful|triumph|resilience/i.test(t)) moodKey = 'hopeful'
  else if (/reflect|contemplat|introspect|meditat|quiet|slow.burn|character.study/i.test(t)) moodKey = 'reflective'

  // Genre detection
  const genres = []
  if (/mystery|detective|sleuth|whodun|crime|murder|investigat/i.test(t)) genres.push('mystery','crime')
  if (/romance|love.story|slow.burn|passion/i.test(t)) genres.push('romance')
  if (/fantasy|magic|wizard|dragon|elv|dwar|fae|epic.quest/i.test(t)) genres.push('fantasy')
  if (/thriller|suspense|psych|paranoi/i.test(t)) genres.push('thriller')
  if (/horror|scary|ghost|haunt|terrif/i.test(t)) genres.push('horror')
  if (/sci.fi|science.fic|space|alien|futur|dystopi/i.test(t)) genres.push('sci-fi')
  if (/histor|ancient|roman|victorian|medieva|wwii|war/i.test(t)) genres.push('history','classics')
  if (/biograph|memoir|true.story|non.fiction/i.test(t)) genres.push('biography')
  if (/young.adult|ya|coming.of.age|teen/i.test(t)) genres.push('young-adult')
  if (/literary|prose|character.driven|literary.fiction/i.test(t)) genres.push('literary')
  if (/classic|19th.century|austen|dickens|tolstoy/i.test(t)) genres.push('classics')
  if (/comedy|funny|laugh|humou|wit/i.test(t)) genres.push('comedy')
  if (/cosy|cozy|village|amateur.detect/i.test(t)) genres.push('mystery','comedy')
  if (/dark.academ|campus|college|gothic/i.test(t)) genres.push('literary','thriller')
  if (/short.stor|anthology|collection/i.test(t)) genres.push('literary','fiction')

  return { moodKey, genres: [...new Set(genres)].slice(0, 4) }
}

/* ─── Main search function ─── */
async function searchByDescription(query, signal) {
  const results = []
  const seen = new Set()
  const { moodKey, genres } = _analyseDescription(query)

  function absorb(list) {
    _clean(Array.isArray(list) ? list : (list?.books || list?.results || [])).forEach(b => {
      const k = (b.title || '').toLowerCase()
      if (!seen.has(k)) { seen.add(k); results.push(b) }
    })
  }
  try {
    const r = await fetch(`${API_BASE}/recommend/mood`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mood: moodKey,
        top_n: 30,
        use_llm: false,
        user_genres: genres.length ? genres : undefined,
      }),
      signal,
    })
    if (r.ok) absorb(await r.json())
  } catch (e) { if (e?.name === 'AbortError') throw e }

  if (genres.length && results.length < 16) {
    await Promise.allSettled(genres.slice(0, 2).map(async genre => {
      try {
        const r = await fetch(`${API_BASE}/recommend/genre?genre=${encodeURIComponent(genre)}&top_n=20`, { signal })
        if (r.ok) absorb(await r.json())
      } catch {}
    }))
  }

  if (results.length < 16) {
    try {
      const r = await fetch(`${API_BASE}/recommend/mood`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: query.trim().slice(0, 300), top_n: 24, use_llm: false }),
        signal,
      })
      if (r.ok) absorb(await r.json())
    } catch (e) { if (e?.name === 'AbortError') throw e }
  }

  // ── Tier 4: LLM-powered search for complex/ambiguous descriptions ──
  if (results.length < 12) {
    try {
      const r = await fetch(`${API_BASE}/recommend/mood`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood: query.trim(), top_n: 20, use_llm: true }),
        signal,
      })
      if (r.ok) absorb(await r.json())
    } catch (e) { if (e?.name === 'AbortError') throw e }
  }

  return results.slice(0, 36)
}

/* ═══════════════════════════════════════
   DESCRIBE PAGE
═══════════════════════════════════════ */
export function DescribePage({ onOpen, bookProps }) {
  const [input,    setInput]    = useState('')
  const [books,    setBooks]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState('')
  const [error,    setError]    = useState('')
  const [charCount,setCharCount] = useState(0)
  const textRef  = useRef(null)
  const ctrlRef  = useRef(null)

  function handleInput(val) {
    setInput(val); setCharCount(val.length)
  }

  function search(query) {
    if (!query.trim() || loading) return
    // Cancel previous search
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl

    setLoading(true); setBooks([]); setError(''); setSearched(query.trim())

    searchByDescription(query, ctrl.signal)
      .then(list => {
        if (!list.length) setError('No books found for that description. Try rephrasing or using different keywords.')
        setBooks(list)
      })
      .catch(e => {
        if (e?.name !== 'AbortError') setError('Something went wrong. Please try again.')
      })
      .finally(() => setLoading(false))
  }

  function clear() {
    ctrlRef.current?.abort()
    setInput(''); setBooks([]); setSearched(''); setError(''); setCharCount(0); setLoading(false)
    textRef.current?.focus()
  }

  useEffect(() => () => ctrlRef.current?.abort(), [])

  return (
    <div style={{ height: '100%', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(114,57,63,0.4) transparent' }}>

      {/* Banner */}
      <div style={{ padding: '36px 32px 28px', borderBottom: '1px solid rgba(201,168,76,0.08)', background: '#202020' }}>
        <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 700, color: 'var(--gold)', letterSpacing: '.22em', textTransform: 'uppercase', margin: '0 0 6px' }}>Semantic Search</p>
        <h2 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 26, fontWeight: 700, color: 'var(--cream)', margin: '0 0 8px' }}>Describe a Book</h2>
        <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--cream)', margin: 0 }}>Describe the kind of book you're in the mood for — genre, mood, setting, themes, or characters</p>
      </div>

      {/* Input area */}
      <div style={{ padding: '24px 32px 0' }}>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <textarea
            ref={textRef}
            value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); search(input) } }}
            placeholder="e.g. A cosy mystery set in a small English village with a clever amateur detective and warm humour…"
            rows={4}
            maxLength={500}
            style={{
              width: '100%', padding: '14px 16px', background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(201,168,76,0.2)', borderRadius: 12,
              color: 'var(--text)', fontFamily: 'Montaga,serif', fontSize: 14,
              lineHeight: 1.65, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              transition: 'border-color 0.18s',
            }}
            onFocus={e => e.target.style.borderColor = 'rgba(201,168,76,0.55)'}
            onBlur={e => e.target.style.borderColor = 'rgba(201,168,76,0.2)'}
          />
          {/* char count */}
          <div style={{ position: 'absolute', bottom: 10, right: 14, fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, color: charCount > 450 ? 'rgba(200,80,80,0.7)' : 'rgba(201,168,76,0.35)', pointerEvents: 'none' }}>
            {charCount}/500
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 24 }}>
          <button onClick={() => search(input)} disabled={loading || !input.trim()}
            style={{
              padding: '11px 28px', borderRadius: 8, cursor: input.trim() && !loading ? 'pointer' : 'default',
              fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 12, fontWeight: 600,
              letterSpacing: '.1em', textTransform: 'uppercase', border: 'none',
              background: input.trim() && !loading ? 'var(--maroon)' : 'rgba(114,57,63,0.3)',
              color: 'var(--cream)', transition: 'all 0.2s',
            }}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'rgba(255,255,255,0.7)', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                Searching…
              </span>
            ) : 'Find Books'}
          </button>
          {(input || searched) && (
            <button onClick={clear} style={{ background: 'none', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 8, padding: '10px 18px', color: 'var(--text-muted)', fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, cursor: 'pointer', transition: 'border-color 0.18s' }}
              onMouseEnter={e => e.target.style.borderColor = 'rgba(201,168,76,0.45)'}
              onMouseLeave={e => e.target.style.borderColor = 'rgba(201,168,76,0.2)'}>
              Clear
            </button>
          )}
        </div>

        {/* Example prompts */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: 10 }}>Try these examples</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {EXAMPLES.map(ex => (
              <button key={ex.label} onClick={() => { handleInput(ex.prompt); search(ex.prompt) }}
                style={{
                  padding: '6px 14px', background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(201,168,76,0.15)', borderRadius: 20,
                  color: 'var(--text-muted)', fontFamily: 'Montaga,serif', fontSize: 11,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.target.style.borderColor = 'rgba(201,168,76,0.45)'; e.target.style.color = 'var(--text)'; e.target.style.background = 'rgba(201,168,76,0.06)' }}
                onMouseLeave={e => { e.target.style.borderColor = 'rgba(201,168,76,0.15)'; e.target.style.color = 'var(--text-muted)'; e.target.style.background = 'rgba(255,255,255,0.03)' }}>
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div style={{ padding: '0 32px 64px' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2.5px solid rgba(201,168,76,0.15)', borderTopColor: 'rgba(201,168,76,0.7)', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.1em' }}>Finding the perfect books…</p>
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: '18px 20px', background: 'rgba(114,57,63,0.15)', borderRadius: 10, border: '1px solid rgba(201,168,76,0.1)', fontFamily: 'Montaga,serif', fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
            {error}
          </div>
        )}

        {!loading && searched && !error && books.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 20 }}>
              <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 600, color: 'var(--gold)', letterSpacing: '.15em', textTransform: 'uppercase', margin: 0 }}>{books.length} Books Found</p>
              <p style={{ fontFamily: 'Montaga,serif', fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>for: <em style={{ color: 'rgba(201,168,76,0.75)' }}>{searched.length > 80 ? searched.slice(0, 80) + '…' : searched}</em></p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 20 }}>
              {books.map((b, i) => <BookCard key={b.title + i} book={b} onOpen={onOpen} />)}
            </div>
          </>
        )}

        {!searched && !loading && (
          <div style={{ textAlign: 'center', padding: '32px 0 48px' }}>
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" width="48" height="48" style={{ color: 'rgba(201,168,76,0.2)', marginBottom: 16 }}>
              <path d="M8 40V10a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v30" /><path d="M4 40h40" /><path d="M16 6v16l4-3 4 3V6" />
            </svg>
            <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'rgba(201,168,76,0.45)', margin: 0 }}>Describe any book vibe and we'll find your next read</p>
          </div>
        )}
      </div>

      {/* Spin keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}