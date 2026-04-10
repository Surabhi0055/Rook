// imageUtils.js — Shared utilities for cover fetching & descriptions
// Single source of truth used by BookCard, TopRatedPage, and Home

// ─── In-memory + sessionStorage cache ────────────────────────────────────────
const _memCache = new Map();

function _cacheGet(k) {
  if (_memCache.has(k)) return _memCache.get(k);
  try {
    const s = sessionStorage.getItem('rook_img_' + k);
    if (s !== null) { _memCache.set(k, s); return s; }
  } catch {}
  return undefined;
}

function _cacheSet(k, v) {
  _memCache.set(k, v);
  try { sessionStorage.setItem('rook_img_' + k, v); } catch {}
}

// ─── Request queue to prevent 429s ───────────────────────────────────────────
let _queue = [];
let _running = false;
const _DELAY_MS = 120; // ~8 req/sec max

function _enqueue(fn) {
  return new Promise((resolve, reject) => {
    _queue.push({ fn, resolve, reject });
    if (!_running) _processQueue();
  });
}

async function _processQueue() {
  _running = true;
  while (_queue.length > 0) {
    const { fn, resolve, reject } = _queue.shift();
    try { resolve(await fn()); } catch (e) { reject(e); }
    if (_queue.length > 0) await new Promise(r => setTimeout(r, _DELAY_MS));
  }
  _running = false;
}

// ─── Title cleaner ────────────────────────────────────────────────────────────
export function cleanTitle(title = '') {
  return title
    .replace(/\s+[A-Z][a-z].+\d+$/, '')
    .replace(/\s+#?\d+$/, '')
    .trim();
}

// ─── Image URL cleaner ────────────────────────────────────────────────────────
export function cleanImageUrl(url) {
  if (!url) return '';
  const u = String(url).trim().replace(/^http:\/\//, 'https://');
  if (
    u === 'nan' || u === 'none' || u === 'null' || u === 'undefined' ||
    u.includes('nophoto') || u.includes('via.placeholder') ||
    u.includes('nocover') || u.includes('no_cover') ||
    u.includes('image_not') || u.includes('noimage') ||
    u.includes('placeholder') || u.includes('default_cover') ||
    !u.startsWith('https://')
  ) return '';
  // Upgrade Goodreads thumbnail to larger size (works as <img src>, CORS-safe)
  return u.replace(/-(S|M)(\.jpg)(\?.*)?$/, '-L$2');
}

// ─── Google Books cover fetcher (queued, cached) ─────────────────────────────
async function _fetchGB(title, authors) {
  const cleanedTitle = cleanTitle(title);
  const cleanTitleGB = cleanedTitle
    .replace(/[–—].*/, '').replace(/:\s+.*/, '')
    .replace(/\s+vol\.?\s*\d+/i, '').trim();
  const firstAuthor = (authors || '').split(',')[0].trim();

  const queries = [
    firstAuthor ? `intitle:"${cleanTitleGB}" inauthor:"${firstAuthor}"` : null,
    `intitle:"${cleanTitleGB}"`,
    cleanedTitle !== cleanTitleGB
      ? `intitle:"${cleanedTitle.replace(/[–—:].*/, '').trim()}"` : null,
    cleanTitleGB,
  ].filter(Boolean);

  for (const q of queries) {
    for (const lang of ['', 'en']) {
      try {
        const langParam = lang ? `&langRestrict=${lang}` : '';
        const r = await fetch(
          `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&printType=books${langParam}`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) continue;
        const json = await r.json();
        for (const item of json?.items || []) {
          const links = item?.volumeInfo?.imageLinks || {};
          const url = (
            links.extraLarge || links.large || links.medium ||
            links.small || links.thumbnail || links.smallThumbnail || ''
          ).replace(/^http:\/\//, 'https://').replace('zoom=1', 'zoom=3');
          if (url) return url;
        }
      } catch {}
    }
  }
  return '';
}

// ─── Open Library cover ───────────────────────────────────────────────────────
async function _fetchOL(title) {
  const cleanTitleGB = cleanTitle(title)
    .replace(/[–—].*/, '').replace(/:\s+.*/, '')
    .replace(/\s+vol\.?\s*\d+/i, '').trim();
  try {
    const r = await fetch(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(cleanTitleGB)}&limit=5&fields=cover_i,title`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const json = await r.json();
      const coverId = json?.docs?.find(d => d.cover_i)?.cover_i;
      if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
    }
  } catch {}
  return '';
}

// ─── Main exported cover fetcher ─────────────────────────────────────────────
export async function fetchGBCover(title, authors) {
  if (!title) return '';
  const key = `cover:${title}||${authors || ''}`.toLowerCase().slice(0, 120);
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;

  const url = await _enqueue(async () => {
    const gb = await _fetchGB(title, authors);
    if (gb) return gb;
    const ol = await _fetchOL(title);
    return ol;
  });

  _cacheSet(key, url);
  return url;
}

// ─── Description fetcher ──────────────────────────────────────────────────────
const DESC_KEYS = ['description','summary','book_description','synopsis','overview','about','desc','plot','blurb'];

export function extractDesc(b) {
  for (const k of DESC_KEYS) {
    const v = String(b?.[k] || '').replace(/<[^>]+>/g, '').trim();
    if (
      v && v.length >= 40 &&
      v.toLowerCase() !== 'no description available for this book.' &&
      v.toLowerCase() !== 'no description available.' &&
      v !== 'nan' && v !== 'none' && v !== 'null'
    ) return v;
  }
  return '';
}

async function _fetchGBDesc(title, authors) {
  const cleanedTitle = cleanTitle(title);
  const cleanTitleGB = cleanedTitle.replace(/[:\-–—].*/, '').replace(/\s+vol\.?\s*\d+/i, '').trim();
  const firstAuthor = (authors || '').split(',')[0].trim();

  const queries = [
    firstAuthor ? `intitle:${cleanTitleGB}+inauthor:${firstAuthor}` : null,
    `intitle:${cleanTitleGB}`,
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const r = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3&printType=books`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!r.ok) continue;
      const json = await r.json();
      for (const item of json?.items || []) {
        const desc = (item?.volumeInfo?.description || '').replace(/<[^>]+>/g, '').trim();
        if (desc && desc.length > 40) return desc;
      }
    } catch {}
  }
  return '';
}

export async function fetchGBDescription(title, authors) {
  if (!title) return '';
  const key = `desc:${title}||${authors || ''}`.toLowerCase().slice(0, 120);
  const cached = _cacheGet(key);
  if (cached !== undefined) return cached;

  const desc = await _enqueue(() => _fetchGBDesc(title, authors));
  _cacheSet(key, desc);
  return desc;
}

// ─── CoverImg component (shared) ─────────────────────────────────────────────
// Export this so BookCard, TopRatedPage, Home all use the same one
import { useState, useEffect } from 'react';

const BOOK_NOT_FOUND = '/assets/BOOK.png';

export function CoverImg({ book }) {
  const local = cleanImageUrl(book?.image_url);
  const [src, setSrc] = useState(local || BOOK_NOT_FOUND);
  const [loading, setLoading] = useState(!local);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fresh = cleanImageUrl(book?.image_url);
    setFailed(false);
    if (fresh) {
      setSrc(fresh);
      setLoading(false);
    } else if (book?.title) {
      setLoading(true);
      setSrc(BOOK_NOT_FOUND);
      fetchGBCover(book.title, book?.authors || '')
        .then(gb => { if (gb) { setSrc(gb); setFailed(false); } })
        .finally(() => setLoading(false));
    } else {
      setSrc(BOOK_NOT_FOUND);
      setLoading(false);
    }
  }, [book?.image_url, book?.title]);

  async function handleError() {
    if (failed) { setSrc(BOOK_NOT_FOUND); return; }
    setFailed(true);
    const gb = await fetchGBCover(book?.title || '', book?.authors || '');
    setSrc(gb || BOOK_NOT_FOUND);
  }

  if (loading) return (
    <div style={{ width: '100%', height: '100%', background: 'rgba(114,57,63,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(201,168,76,0.15)', borderTopColor: 'rgba(201,168,76,0.5)', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  return (
    <img
      src={src}
      alt={book?.title || ''}
      loading="lazy"
      onError={handleError}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}