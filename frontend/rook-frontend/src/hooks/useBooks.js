import { useState, useEffect } from 'react'

export const API_BASE = 'http://localhost:8000/api'

/* ── generic fetch ───────────────────────────────────────────── */
export async function apiFetch(url, options = {}) {
  const r = await fetch(url, options)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

/* ── POST /recommend/mood ────────────────────────────────────── */
export async function fetchMood(mood, top_n = 16) {
  const r = await fetch(`${API_BASE}/recommend/mood`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mood, top_n, use_llm: false }),
  })
  if (!r.ok) return []
  return r.json()
}

/* ── trending ────────────────────────────────────────────────── */
export function useTrending(topN = 16) {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    apiFetch(`${API_BASE}/trending?top_n=${topN}`)
      .then(d => { setBooks(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [topN])
  return { books, loading }
}

/* ── hero (trending + images, shuffled) ─────────────────────── */
export function useHeroBooks() {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    apiFetch(`${API_BASE}/trending?top_n=100`)
      .then(data => {
        const arr = Array.isArray(data) ? data : []
        const good = arr.filter(b => {
          const u = (b.image_url || '').replace(/^http:\/\//, 'https://')
          return u.startsWith('https://') &&
            !u.includes('placeholder') && !u.includes('nocover') && !u.includes('nophoto')
        })
        for (let i = good.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [good[i], good[j]] = [good[j], good[i]]
        }
        setBooks(good.slice(0, 20)); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])
  return { books, loading }
}

/* ── mood section hook ───────────────────────────────────────── */
export function useMoodBooks(mood) {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!mood) return
    fetchMood(mood, 16)
      .then(d => { setBooks(dedup(Array.isArray(d) ? d : [])); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mood])
  return { books, loading }
}

/* ── dedup helper ────────────────────────────────────────────── */
export function dedup(books) {
  const seen = new Set()
  return (books || []).filter(b => {
    const k = (b.title || '').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    seen.add(k); return true
  })
}

export function cleanImageUrl(url) {
  if (!url) return ''
  const u = String(url).trim().replace(/^http:\/\//, 'https://')
  if (u === 'nan' || u === 'none' || u === 'null' ||
    u.includes('nophoto') || u.includes('via.placeholder') ||
    !u.startsWith('https://')) return ''
  return u
}

export function extractDesc(b) {
  const keys = ['description', 'summary', 'synopsis', 'overview', 'about', 'desc', 'blurb']
  for (const k of keys) {
    const v = (b[k] || '').toString().replace(/<[^>]+>/g, '').trim()
    if (v && v !== 'nan' && v !== 'none') return v
  }
  return ''
}