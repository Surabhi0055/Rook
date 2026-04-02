import { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { rateBook, getBookRatings } from "../api/client";
import { ensureBook } from "../api/client";
import StarRating from "./StarRating";
import {
  cleanImageUrl,
  cleanTitle,
  fetchGBCover,
  fetchGBDescription,
  extractDesc,
  CoverImg,
} from "../utils/imageUtils";

if (
  typeof document !== "undefined" &&
  !document.getElementById("rook-spin-style")
) {
  const s = document.createElement("style");
  s.id = "rook-spin-style";
  s.textContent = "@keyframes spin { to { transform: rotate(360deg) } }";
  document.head.appendChild(s);
}

export { fetchGBCover, fetchGBDescription, cleanImageUrl, extractDesc };

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isGoodDesc(desc) {
  if (!desc || desc.length < 60) return false;
  const lower = desc.toLowerCase();
  if (/^[\w\s,.']+\d{4}$/.test(desc.trim())) return false;
  if (lower.includes('no description available')) return false;
  if (lower === 'nan' || lower === 'none' || lower === 'null') return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SONG RECOMMENDATIONS
// Uses backend via /api/songs/recommend
// ─────────────────────────────────────────────────────────────────────────────

const _NO_SONG_GENRES = new Set([
  "textbook", "academic", "mathematics", "physics", "chemistry", "engineering",
  "programming", "computer science", "law", "legal", "medicine", "medical",
  "cooking", "cookbook", "recipes", "travel guide", "guidebook", "dictionary",
  "encyclopedia", "grammar", "exam prep", "test prep",
]);

const _NO_SONG_TITLE_SIGNALS = [
  "how to ", "guide to ", "introduction to ", "teach yourself", "complete guide",
  "for dummies", "step by step", "workbook", "study guide", "exam prep", "test prep",
];

function _shouldSkipSongs(genre, title) {
  const g = (genre || "").toLowerCase();
  const t = (title || "").toLowerCase();
  for (const ng of _NO_SONG_GENRES) {
    if (g.includes(ng)) return true;
  }
  for (const sig of _NO_SONG_TITLE_SIGNALS) {
    if (t.includes(sig)) return true;
  }
  return false;
}

const _songCache = new Map();

function _resolveApiBase(apiBase) {
  if (apiBase && apiBase.length > 1) {
    if (apiBase.endsWith("/api")) return apiBase;
    return apiBase.replace(/\/+$/, "") + "/api";
  }
  if (typeof window !== "undefined") {
    const port = window.location.port;
    if (port === "5173" || port === "3000" || port === "4173") {
      return `${window.location.protocol}//${window.location.hostname}:8000/api`;
    }
  }
  return "/api";
}

async function fetchSongRecommendations(book, apiBase) {
  const cacheKey = (book.title || "").toLowerCase().trim().slice(0, 80);
  if (_songCache.has(cacheKey)) return _songCache.get(cacheKey);

  const genre = (book.genre || "").split(",")[0].trim();

  if (_shouldSkipSongs(genre, book.title)) {
    return { songs: [], skipped: true };
  }

  const base = _resolveApiBase(apiBase);
  const desc = extractDesc(book).replace(/<[^>]+>/g, "").trim().slice(0, 400);

  try {
    const resp = await fetch(`${base}/songs/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: book.title || "",
        authors: book.authors || "",
        genre: genre,
        description: desc,
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const result = { songs: data.songs || [], skipped: data.skipped || false };
    if (_songCache.size >= 200) {
      const firstKey = _songCache.keys().next().value;
      _songCache.delete(firstKey);
    }
    _songCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("[SongRecs] fetch error:", e);
    return { songs: [], skipped: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SONG CARD COMPONENT — no YouTube preview, links to Spotify or YouTube search
// ─────────────────────────────────────────────────────────────────────────────

function SongCard({ song, index, isLight }) {
  const [hov, setHov] = useState(false);

  const gradients = [
    "linear-gradient(135deg, rgba(201,168,76,0.22), rgba(114,57,63,0.12))",
    "linear-gradient(135deg, rgba(114,57,63,0.22), rgba(201,168,76,0.08))",
    "linear-gradient(135deg, rgba(160,80,40,0.18), rgba(201,168,76,0.10))",
    "linear-gradient(135deg, rgba(80,100,168,0.16), rgba(114,57,63,0.12))",
    "linear-gradient(135deg, rgba(80,168,120,0.16), rgba(201,168,76,0.08))",
  ];

  const C = isLight ? {
    bg: hov ? "rgba(255,248,232,0.95)" : "rgba(255,248,232,0.72)",
    border: hov ? "rgba(180,130,50,0.5)" : "rgba(180,130,50,0.2)",
    title: "#1e0e00",
    artist: "rgba(80,45,5,0.65)",
    mood: "#7a3e00",
    moodBg: "rgba(180,130,50,0.1)",
    moodBorder: "rgba(180,130,50,0.25)",
    shadow: hov ? "0 8px 28px rgba(60,30,10,0.2)" : "0 2px 6px rgba(60,30,10,0.08)",
    iconBg: "rgba(180,130,50,0.14)",
    iconBorder: "rgba(180,130,50,0.2)",
    iconColor: "rgba(180,130,50,0.7)",
    spotifyGreen: "rgba(30,180,80,0.8)",
  } : {
    bg: hov ? "rgba(22,8,2,0.88)" : "rgba(12,4,1,0.72)",
    border: hov ? "rgba(201,168,76,0.48)" : "rgba(201,168,76,0.14)",
    title: "rgba(240,233,227,0.95)",
    artist: "rgba(201,168,76,0.6)",
    mood: "rgba(201,168,76,0.5)",
    moodBg: "rgba(201,168,76,0.07)",
    moodBorder: "rgba(201,168,76,0.16)",
    shadow: hov ? "0 8px 28px rgba(0,0,0,0.55)" : "0 2px 6px rgba(0,0,0,0.28)",
    iconBg: "rgba(201,168,76,0.08)",
    iconBorder: "rgba(201,168,76,0.14)",
    iconColor: "rgba(201,168,76,0.45)",
    spotifyGreen: "rgba(30,215,96,0.85)",
  };

  // Prefer Spotify URL; fall back to YouTube search (no preview audio)
  const hasSpotify = !!song.spotify_url;
  const searchUrl = hasSpotify
    ? song.spotify_url
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(song.title + " " + song.artist)}`;

  return (
    <a
      href={searchUrl}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{display: "flex",alignItems: "center",gap: 10,padding: "9px 12px",borderRadius: 12,background: C.bg,border: `1px solid ${C.border}`,boxShadow: C.shadow,textDecoration: "none",transition: "all 0.2s cubic-bezier(0.22,1,0.36,1)",transform: hov ? "translateX(3px)" : "none",cursor: "pointer",position: "relative",overflow: "hidden",
      }}
    >
      {/* Gradient shimmer */}
      <div style={{
        position: "absolute", inset: 0,
        background: gradients[index % gradients.length],
        opacity: hov ? 1 : 0.55,
        transition: "opacity 0.28s",
        pointerEvents: "none",
        borderRadius: 12,
      }} />

      {/* Album art or music icon */}
      <div style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 8,
        background: song.image ? `url(${song.image}) center/cover no-repeat` : C.iconBg,
        border: `1px solid ${C.iconBorder}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        {!song.image && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" width="16" height="16" style={{ color: C.iconColor }}>
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
        {/* Hover overlay */}
        {hov && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 8,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* Spotify icon on hover if has spotify link */}
            {hasSpotify ? (
              <svg viewBox="0 0 24 24" fill={C.spotifyGreen} width="16" height="16">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style={{ color: "#fff", marginLeft: 2 }}>
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Song info */}
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <div style={{
          fontFamily: "Montserrat Alternates, sans-serif",
          fontSize: 11.5, fontWeight: 600, color: C.title,
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          marginBottom: 2,
        }}>
          {song.title}
        </div>
        <div style={{
          fontFamily: "Montaga, serif",
          fontSize: 10, color: C.artist,
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
        }}>
          {song.artist}
        </div>
      </div>

      {/* Mood tag */}
      {song.mood && (
        <div style={{
          flexShrink: 0,
          fontFamily: "Montserrat Alternates, sans-serif",
          fontSize: 8.5, fontWeight: 600,
          color: C.mood,
          background: C.moodBg,
          border: `1px solid ${C.moodBorder}`,
          borderRadius: 20, padding: "2px 8px",
          letterSpacing: ".04em",
          position: "relative",
          maxWidth: 90, textAlign: "center",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
        }}>
          {song.mood}
        </div>
      )}

      {/* Platform badge */}
      <div style={{ flexShrink: 0, position: "relative", display: "flex", alignItems: "center" }}>
        {hasSpotify ? (
          <svg viewBox="0 0 24 24" fill={C.spotifyGreen} width="13" height="13"
            style={{ opacity: hov ? 1 : 0.55, transition: "opacity 0.2s" }}>
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" width="10" height="10"
            style={{ color: C.mood, opacity: hov ? 1 : 0.45, transition: "opacity 0.2s" }}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        )}
      </div>
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SONG RECOMMENDATIONS SECTION
// ─────────────────────────────────────────────────────────────────────────────

function SongRecommendations({ book, isLight, apiBase }) {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    if (!book?.title) { setLoading(false); return; }
    let cancelled = false;
    setSongs([]);
    setSkipped(false);
    setLoading(true);

    fetchSongRecommendations(book, apiBase)
      .then(result => {
        if (cancelled) return;
        if (result.skipped) {
          setSkipped(true);
          setSongs([]);
        } else {
          setSongs(result.songs || []);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [book?.title, apiBase]);

  if (skipped) return null;

  const hasSpotifyTracks = songs.some(s => !!s.spotify_url);

  const C = isLight ? {
    eyebrow: "rgba(110,70,8,0.8)",
    heading: "rgba(35,15,0,0.9)",
    sub: "rgba(80,45,5,0.5)",
    secLine: "linear-gradient(90deg,rgba(160,110,40,0.28),transparent)",
    loading: "rgba(50,25,5,0.38)",
    noResult: "rgba(50,25,5,0.32)",
    spotifyGreen: "rgba(30,180,80,0.85)",
  } : {
    eyebrow: "rgba(201,168,76,0.7)",
    heading: "rgba(240,233,227,0.95)",
    sub: "rgba(201,168,76,0.42)",
    secLine: "linear-gradient(90deg,rgba(201,168,76,0.26),transparent)",
    loading: "rgba(240,233,227,0.3)",
    noResult: "rgba(240,233,227,0.26)",
    spotifyGreen: "rgba(30,215,96,0.9)",
  };

  return (
    <div style={{ padding: "20px 32px 26px" }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div>
          <p style={{
            fontFamily: "Montserrat Alternates, sans-serif",
            fontSize: 9, fontWeight: 700, color: C.eyebrow,
            letterSpacing: ".22em", textTransform: "uppercase", margin: "0 0 3px",
          }}>
            Soundtrack
          </p>
          <h3 style={{
            fontFamily: "Montserrat Alternates, sans-serif",
            fontSize: 13, fontWeight: 700, color: C.heading, margin: 0,
          }}>
            Songs That Match This Book
          </h3>
        </div>
        <div style={{ flex: 1, height: 1, background: C.secLine }} />
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
          <div style={{
            width: 13, height: 13, borderRadius: "50%",
            border: "2px solid rgba(201,168,76,0.12)",
            borderTopColor: "rgba(201,168,76,0.55)",
            animation: "spin 0.85s linear infinite", flexShrink: 0,
          }} />
          <p style={{
            fontFamily: "Montserrat Alternates, sans-serif",
            fontSize: 10, color: C.loading, letterSpacing: ".1em", margin: 0,
          }}>
            Curating your soundtrack...
          </p>
        </div>
      ) : songs.length === 0 ? (
        <p style={{ fontFamily: "Montaga, serif", fontSize: 12, color: C.noResult, margin: 0, fontStyle: "italic" }}>
          No songs found for this book.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {songs.map((song, i) => (
            <SongCard key={song.title + song.artist + i} song={song} index={i} isLight={isLight} />
          ))}
          <p style={{
            fontFamily: "Montaga, serif", fontSize: 9.5, color: C.sub,
            margin: "8px 0 0", fontStyle: "italic", textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}>
            {hasSpotifyTracks ? (
              <>
                AI-curated · click to open on{" "}
                <svg viewBox="0 0 24 24" fill={C.spotifyGreen} width="11" height="11" style={{ display: "inline", verticalAlign: "middle" }}>
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                Spotify
              </>
            ) : (
              "AI-curated · click to search on YouTube"
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMILAR BOOKS
// ─────────────────────────────────────────────────────────────────────────────

const _BLOCKED_SIMILAR = [
  "harry potter", "lord of the rings", "twilight", "hunger games",
  "divergent", "maze runner", "sherlock holmes", "fifty shades",
];
function _isBlockedSimilar(title) {
  const t = (title || "").toLowerCase();
  return _BLOCKED_SIMILAR.some((b) => t.includes(b));
}

function getApiBase(API_BASE) {
  if (!API_BASE) return "/api";
  if (API_BASE.endsWith("/api")) return API_BASE;
  return API_BASE.replace(/\/+$/, "") + "/api";
}

async function fetchSimilarBooks(book, API_BASE, signal) {
  const BASE = getApiBase(API_BASE);
  const owned = new Set([(book.title || "").toLowerCase()]);
  const genre = (book.genre || "").split(",")[0].trim().toLowerCase();
  const desc = extractDesc(book).replace(/<[^>]+>/g, "").trim();
  const apiTitle = cleanTitle(book.title || "");

  function clean(list) {
    return (Array.isArray(list) ? list : list?.books || list?.results || []).filter((b) => {
      const k = (b.title || "").toLowerCase();
      return k && !owned.has(k) && !_isBlockedSimilar(k);
    });
  }

  try {
    const r = await fetch(`${BASE}/recommend/title?title=${encodeURIComponent(apiTitle)}&top_n=20`, { signal });
    if (r.ok) { const d = await r.json(); const list = clean(d); if (list.length >= 4) return list.slice(0, 12); }
  } catch (e) { if (e?.name === "AbortError") return []; }

  try {
    const r = await fetch(`${BASE}/recommend/hybrid?title=${encodeURIComponent(apiTitle)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liked_titles: [apiTitle], saved_titles: [], top_n: 20 }), signal,
    });
    if (r.ok) { const d = await r.json(); const list = clean(d); if (list.length >= 4) return list.slice(0, 12); }
  } catch (e) { if (e?.name === "AbortError") return []; }

  if (desc.length > 40) {
    try {
      const r = await fetch(`${BASE}/recommend/description`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc.slice(0, 400), liked_titles: [apiTitle], saved_titles: [], top_n: 20 }), signal,
      });
      if (r.ok) { const d = await r.json(); const list = clean(d); if (list.length >= 4) return list.slice(0, 12); }
    } catch (e) { if (e?.name === "AbortError") return []; }
  }

  if (genre) {
    try {
      const moodQuery = `${genre} books similar to ${apiTitle} same atmosphere same style`;
      const r = await fetch(`${BASE}/recommend/mood`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: moodQuery, top_n: 20, use_llm: false }), signal,
      });
      if (r.ok) { const d = await r.json(); const list = clean(d); return list.slice(0, 12); }
    } catch (e) { if (e?.name === "AbortError") return []; }
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// RATING PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

const RATINGS_STORAGE_KEY = "rook_user_ratings";

function getSavedRatings() {
  try { return JSON.parse(localStorage.getItem(RATINGS_STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function saveRatingLocally(bookId, rating) {
  try {
    const existing = getSavedRatings();
    existing[String(bookId)] = rating;
    localStorage.setItem(RATINGS_STORAGE_KEY, JSON.stringify(existing));
  } catch {}
}

function getLocalRating(bookId) {
  if (!bookId) return 0;
  try { return getSavedRatings()[String(bookId)] || 0; }
  catch { return 0; }
}

function resolveUserId(propUserId) {
  if (propUserId) return propUserId;
  try {
    const user = JSON.parse(localStorage.getItem("rook_user") || "{}");
    return user.id || user.userId || null;
  } catch { return null; }
}

function extractId(b) {
  const candidates = [b?.book_id, b?.id, b?.bookId, b?._id, b?.pk];
  for (const c of candidates) {
    if (c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0 && Math.floor(n) === n) return n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MINI CARD
// ─────────────────────────────────────────────────────────────────────────────

function MiniCard({ book, onOpen, isLight }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={() => onOpen(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flexShrink: 0, width: 118, cursor: "pointer", borderRadius: 10, overflow: "hidden",
        border: `1px solid ${isLight ? "rgba(180,130,50,0.25)" : "rgba(201,168,76,0.18)"}`,
        transform: hov ? "translateY(-5px) scale(1.04)" : "none",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
        boxShadow: hov
          ? (isLight ? "0 14px 36px rgba(60,30,10,0.3)" : "0 14px 36px rgba(0,0,0,0.55)")
          : (isLight ? "0 2px 8px rgba(60,30,10,0.12)" : "0 2px 8px rgba(0,0,0,0.3)"),
      }}
    >
      <div style={{ width: 118, height: 172, background: isLight ? "rgba(220,200,170,0.25)" : "rgba(114,57,63,0.25)", overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", transform: hov ? "scale(1.08)" : "scale(1.0)", transition: "transform 0.5s cubic-bezier(0.22,1,0.36,1)" }}>
          <CoverImg book={book} />
        </div>
      </div>
      <div style={{ padding: "8px 9px 10px", background: isLight ? "rgba(255,250,242,0)" : "rgba(20,6,2,0.88)", borderTop: `1px solid ${isLight ? "rgba(180,130,50,0.22)" : "rgba(201,168,76,0.16)"}` }}>
        <div style={{ fontFamily: "Montaga,serif", fontSize: 11, color: isLight ? "rgba(35,15,0,0.9)" : "rgba(240,233,227,0.88)", lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: 3 }}>
          {book.title || "Unknown"}
        </div>
        <div style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9, fontWeight: 400, color: isLight ? "rgba(120,75,10,0.75)" : "rgba(201,168,76,0.6)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {book.authors || ""}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NAV ARROW
// ─────────────────────────────────────────────────────────────────────────────

function NavArrow({ dir, onClick, isLight, disabled }) {
  const [hov, setHov] = useState(false);
  if (disabled) return <div style={{ width: 44 }} />;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flexShrink: 0, width: 44, height: 44, borderRadius: "50%",
        background: isLight ? (hov ? "rgba(255,248,232,0.95)" : "rgba(255,248,232,0.75)") : (hov ? "rgba(30,10,3,0.9)" : "rgba(20,6,2,0.65)"),
        border: `1px solid ${isLight ? "rgba(180,130,50,0.3)" : "rgba(201,168,76,0.22)"}`,
        color: isLight ? "rgba(80,45,5,0.85)" : "rgba(201,168,76,0.85)",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(8px)", boxShadow: hov ? "0 4px 16px rgba(0,0,0,0.4)" : "none",
        transition: "all 0.18s", alignSelf: "center",
      }}
    >
      {dir === "prev"
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="18" height="18"><polyline points="15 18 9 12 15 6" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="18" height="18"><polyline points="9 18 15 12 9 6" /></svg>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOK MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function BookModal({
  book, onClose, savedSet, likedSet, wishedSet,
  onSave, onLike, onWish, onOpen, onAuthor,
  API_BASE, apiFetch, onSearch, onNav, onSimilar,
  bookList, userId: userIdProp,
}) {
  const userId = userIdProp || (() => {
    try { const u = JSON.parse(localStorage.getItem("rook_user") || "{}"); return u.id || u.userId || null; }
    catch { return null; }
  })();

  const [authorBooks, setAuthorBooks] = useState([]);
  const [similarBooks, setSimilarBooks] = useState([]);
  const [authorLoading, setAuthorLoading] = useState(true);
  const [simLoading, setSimLoading] = useState(true);
  const [bgUrl, setBgUrl] = useState("");
  const [isLight, setIsLight] = useState(() => document.documentElement.getAttribute("data-theme") === "light");
  const scrollRef = useRef(null);

  const [finalDesc, setFinalDesc] = useState("");
  const [descLoading, setDescLoading] = useState(true);

  const [resolvedModalAuthor, setResolvedModalAuthor] = useState(() => resolveAuthors(book));
  useEffect(() => {
    const immediate = resolveAuthors(book);
    if (immediate) { setResolvedModalAuthor(immediate); return; }
    fetchAuthorFromGB(book?.title || "").then(a => { if (a) setResolvedModalAuthor(a); });
  }, [book?.title, book?.authors]);

  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsLight(document.documentElement.getAttribute("data-theme") === "light")
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => { document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = ""; }; }, []);

  useEffect(() => {
    if (!book) return;
    setBgUrl("");
    setFinalDesc("");
    setDescLoading(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    const existingCover = cleanImageUrl(book.image_url);
    if (existingCover) setBgUrl(existingCover);
    fetchGBCover(book.title, book.authors).then(gb => { if (gb) setBgUrl(gb); });

    const storedDesc = extractDesc(book);
    if (isGoodDesc(storedDesc)) {
      setFinalDesc(storedDesc);
      setDescLoading(false);
      fetchGBDescription(book.title, book.authors).then(gbDesc => {
        if (gbDesc && gbDesc.length > storedDesc.length) setFinalDesc(gbDesc);
      });
    } else {
      setDescLoading(true);
      fetchGBDescription(book.title, book.authors).then(gbDesc => {
        if (gbDesc) setFinalDesc(gbDesc);
        else if (storedDesc) setFinalDesc(storedDesc);
        setDescLoading(false);
      });
    }
  }, [book?.title]);

  useEffect(() => {
    if (!book || !API_BASE) { setAuthorLoading(false); setSimLoading(false); return; }
    setAuthorBooks([]); setSimilarBooks([]);
    setAuthorLoading(true); setSimLoading(true);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 14000);
    const resolvedAuthor = resolveAuthors(book);
    const firstAuthor = resolvedAuthor ? resolvedAuthor.split(",")[0].trim() : null;
    const apiTitle = cleanTitle(book.title || "");
    const BASE = getApiBase(API_BASE);

    if (firstAuthor) {
      const fetchFn = apiFetch || ((url) => fetch(url).then((r) => r.json()));
      fetchFn(`${BASE}/recommend/author?author=${encodeURIComponent(firstAuthor)}&top_n=12`)
        .then((d) => setAuthorBooks(
          (Array.isArray(d) ? d : [])
            .filter((b) => (b.title || "").toLowerCase() !== (book.title || "").toLowerCase())
            .slice(0, 10)
        ))
        .catch(() => setAuthorBooks([]))
        .finally(() => setAuthorLoading(false));
    } else { setAuthorLoading(false); }

    const bookForSimilar = { ...book, title: apiTitle };
    fetchSimilarBooks(bookForSimilar, API_BASE, ctrl.signal)
      .then((list) => setSimilarBooks(list))
      .catch(() => setSimilarBooks([]))
      .finally(() => { clearTimeout(tid); setSimLoading(false); });

    return () => { ctrl.abort(); clearTimeout(tid); };
  }, [book?.title]);

  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [book, bookList]);

  if (!book) return null;

  const list = Array.isArray(bookList) ? bookList : [];
  const curIdx = list.findIndex((b) => b.title === book.title);
  const hasPrev = curIdx > 0;
  const hasNext = curIdx !== -1 && curIdx < list.length - 1;
  function goPrev() { if (hasPrev) onOpen(list[curIdx - 1]); }
  function goNext() { if (hasNext) onOpen(list[curIdx + 1]); }

  const authorName = resolvedModalAuthor ? resolvedModalAuthor.split(",")[0].trim() : null;
  const displayAuthorsModal = resolvedModalAuthor || "";
  const genres = (book.genre || "").split(",").map((g) => g.trim()).filter(Boolean).slice(0, 3);
  const trimmedDesc = finalDesc.length > 700 ? finalDesc.slice(0, 700) + "…" : finalDesc;

  const publishYear = (() => {
    const candidates = [book.published_date, book.publish_date, book.publication_year, book.original_publication_year, book.year, book.pub_year];
    for (const raw of candidates) { const m = String(raw || "").match(/\d{4}/); if (m) return m[0]; }
    return "";
  })();

  const { toggleRead, isRead } = useApp();
  const isSaved = savedSet?.has(book.title);
  const isLiked = likedSet?.has(book.title);
  const isWished = wishedSet?.has(book.title);
  const isReadNow = isRead(book.title);

  function handleOpen(b) { onClose(); setTimeout(() => onOpen(b), 120); }
  function handleFindSimilar() {
    if (onSimilar) { onClose(); setTimeout(() => onSimilar(book), 80); return; }
    if (onSearch) { onClose(); setTimeout(() => onSearch(book.title), 80); }
  }
  function handleDescribe() { if (onNav) { onClose(); setTimeout(() => onNav("description"), 80); } }

  const C = isLight ? {
    backdropBg: "rgba(160,130,90,0.62)", blurF: "blur(26px) saturate(2.0) brightness(0.72)",
    overlayBg: "linear-gradient(150deg,rgba(248,240,224,0.76) 0%,rgba(240,228,208,0.87) 50%,rgba(230,216,194,0.95) 100%)",
    shadow: "0 28px 70px rgba(60,30,10,0.38),0 0 0 1px rgba(180,130,50,0.22)",
    title: "#1e0e00", author: "rgba(50,25,5,0.7)", authorHov: "#7a3e00",
    descBg: "rgba(255,248,232,0.82)", descB: "rgba(180,130,50,0.28)", descLbl: "rgba(120,75,10,0.75)", descTxt: "rgba(35,15,0,0.82)",
    gChipBg: "rgba(170,110,15,0.1)", gChipB: "rgba(170,110,15,0.42)", gChipC: "#6e3e00",
    chipBg: "rgba(50,25,5,0.06)", chipB: "rgba(50,25,5,0.18)", chipC: "rgba(35,15,0,0.7)", chipCnt: "rgba(50,25,5,0.45)",
    divider: "rgba(160,110,40,0.22)", secHead: "rgba(110,70,8,0.9)", secLine: "linear-gradient(90deg,rgba(160,110,40,0.35),transparent)",
    loading: "rgba(50,25,5,0.38)", noResult: "rgba(50,25,5,0.35)", scrollbar: "rgba(140,90,20,0.25) transparent",
    closeBg: "rgba(255,248,232,0.72)", closeB: "rgba(50,25,5,0.2)", closeC: "rgba(50,25,5,0.7)", closeHov: "rgba(160,80,20,0.2)",
    rBtnBg: isReadNow ? "rgba(6,6,6,0.99)" : "rgb(0,0,0)", rBtnB: isReadNow ? "rgba(170,115,5,0.86)" : "rgba(218,218,218,0.93)", rBtnC: isReadNow ? "#dededc" : "rgba(225,225,225,0.88)",
    sBtnBg: isSaved ? "rgba(170,110,15,0.14)" : "transparent", sBtnB: isSaved ? "rgba(170,110,15,0.6)" : "rgba(170,110,15,0.35)", sBtnC: isSaved ? "#5e3800" : "rgba(110,65,5,0.85)",
    lBtnBg: isLiked ? "rgba(170,40,60,0.12)" : "transparent", lBtnB: isLiked ? "rgba(170,40,60,0.55)" : "rgba(170,40,60,0.35)", lBtnC: isLiked ? "#8c1025" : "rgba(140,30,50,0.8)",
    wBtnBg: isWished ? "rgba(20,110,60,0.10)" : "transparent", wBtnB: isWished ? "rgba(20,110,60,0.5)" : "rgba(20,110,60,0.32)", wBtnC: isWished ? "#0a5025" : "rgba(15,85,45,0.8)",
    recBtnBg: "rgba(100,60,5,0.08)", recBtnB: "rgba(130,80,10,0.35)", recBtnC: "rgba(90,50,5,0.8)", recBtnHov: "rgba(130,80,10,0.15)",
    ratingBg: "rgba(255,248,232,0.6)", ratingB: "rgba(180,130,50,0.2)",
  } : {
    backdropBg: "rgba(0,0,0,0.72)", blurF: "blur(26px) saturate(1.6) brightness(0.22)",
    overlayBg: "linear-gradient(150deg,rgba(10,3,1,0.50) 0%,rgba(14,5,2,0.70) 50%,rgba(8,2,1,0.88) 100%)",
    shadow: "0 28px 70px rgba(0,0,0,0.85),0 0 0 1px rgba(201,168,76,0.13)",
    title: "rgba(240,233,227,0.97)", author: "rgba(240,233,227,0.6)", authorHov: "#c9a84c",
    descBg: "rgba(0,0,0,0.3)", descB: "rgba(201,168,76,0.14)", descLbl: "rgba(201,168,76,0.55)", descTxt: "rgba(240,233,227,0.7)",
    gChipBg: "rgba(201,168,76,0.12)", gChipB: "rgba(201,168,76,0.38)", gChipC: "#c9a84c",
    chipBg: "rgba(255,255,255,0.07)", chipB: "rgba(255,255,255,0.15)", chipC: "rgba(240,233,227,0.72)", chipCnt: "rgba(240,233,227,0.42)",
    divider: "rgba(201,168,76,0.16)", secHead: "rgba(201,168,76,0.85)", secLine: "linear-gradient(90deg,rgba(201,168,76,0.3),transparent)",
    loading: "rgba(240,233,227,0.3)", noResult: "rgba(240,233,227,0.28)", scrollbar: "rgba(201,168,76,0.2) transparent",
    closeBg: "rgba(0,0,0,0.5)", closeB: "rgba(255,255,255,0.15)", closeC: "rgba(240,233,227,0.8)", closeHov: "rgba(114,57,63,0.6)",
    rBtnBg: isReadNow ? "rgba(238,232,232,0.82)" : "rgb(0,0,0)", rBtnB: isReadNow ? "rgba(237,235,235,0.69)" : "rgba(192,192,192,0.59)", rBtnC: isReadNow ? "rgba(0,0,0,0.9)" : "rgb(255,255,255)",
    sBtnBg: isSaved ? "rgba(201,168,76,0.18)" : "transparent", sBtnB: isSaved ? "rgba(201,168,76,0.55)" : "rgba(201,168,76,0.3)", sBtnC: isSaved ? "#c9a84c" : "rgba(201,168,76,0.72)",
    lBtnBg: isLiked ? "rgba(190,70,90,0.18)" : "transparent", lBtnB: isLiked ? "rgba(190,70,90,0.5)" : "rgba(190,70,90,0.3)", lBtnC: isLiked ? "rgba(220,120,135,0.9)" : "rgba(190,90,105,0.72)",
    wBtnBg: isWished ? "rgba(70,155,105,0.18)" : "transparent", wBtnB: isWished ? "rgba(70,155,105,0.5)" : "rgba(70,155,105,0.3)", wBtnC: isWished ? "rgba(110,185,145,0.9)" : "rgba(80,150,110,0.72)",
    recBtnBg: "rgba(201,168,76,0.07)", recBtnB: "rgba(201,168,76,0.22)", recBtnC: "rgba(201,168,76,0.7)", recBtnHov: "rgba(201,168,76,0.14)",
    ratingBg: "rgba(0,0,0,0.25)", ratingB: "rgba(201,168,76,0.12)",
  };

  const btnBase = { padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontFamily: "Montserrat Alternates,sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", transition: "all 0.18s", border: "1.5px solid" };
  const sHS = { fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: ".22em", textTransform: "uppercase", color: C.secHead, cursor: "pointer", transition: "color 0.18s" };

  function RecBtn({ label, icon, onClick }) {
    const [hov, setHov] = useState(false);
    return (
      <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", background: hov ? C.recBtnHov : C.recBtnBg, border: `1px solid ${C.recBtnB}`, color: C.recBtnC, transition: "all 0.18s" }}>
        {icon}{label}
      </button>
    );
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: C.backdropBg, backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 0" }}>
      <div style={{ flexShrink: 0, padding: "0 10px" }} onClick={(e) => e.stopPropagation()}>
        <NavArrow dir="prev" onClick={goPrev} isLight={isLight} disabled={!hasPrev} />
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", flex: 1, maxWidth: 860, maxHeight: "calc(100vh - 40px)", borderRadius: 18, boxShadow: C.shadow }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 18, overflow: "hidden", zIndex: 0, pointerEvents: "none" }}>
          {bgUrl && <div style={{ position: "absolute", top: "-10px", left: "-10px", right: "-10px", bottom: "-10px", backgroundImage: `url(${bgUrl})`, backgroundSize: "cover", backgroundPosition: "center top", filter: C.blurF }} />}
          <div style={{ position: "absolute", inset: 0, background: C.overlayBg }} />
        </div>
        <div ref={scrollRef} style={{ position: "relative", zIndex: 1, overflowY: "auto", overflowX: "hidden", maxHeight: "calc(100vh - 40px)", borderRadius: 18, scrollbarWidth: "thin", scrollbarColor: C.scrollbar }}>
          <div style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", justifyContent: "flex-end", padding: "14px 18px 0", pointerEvents: "none" }}>
            <button onClick={onClose} style={{ pointerEvents: "all", width: 34, height: 34, borderRadius: "50%", background: C.closeBg, border: `1px solid ${C.closeB}`, color: C.closeC, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", transition: "background 0.18s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.closeHov)}
              onMouseLeave={(e) => (e.currentTarget.style.background = C.closeBg)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          {/* HERO */}
          <div style={{ display: "flex", gap: 30, padding: "10px 32px 28px", alignItems: "flex-start" }}>
            {/* LEFT: cover + rating */}
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ width: 188, height: 282, borderRadius: 12, overflow: "hidden", boxShadow: isLight ? "0 16px 44px rgba(60,30,10,0.38),0 0 0 1px rgba(180,120,30,0.2)" : "0 18px 52px rgba(0,0,0,0.75),0 0 0 1px rgba(201,168,76,0.14)" }}>
                <CoverImg book={book} />
              </div>
              <div style={{ width: 188, background: C.ratingBg, border: `1px solid ${C.ratingB}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: C.descLbl, marginBottom: 8 }}>
                  Rate This Book
                </div>
                <StarRating
                  bookCsvId={book.book_id}
                  bookId={book.id}
                  bookTitle={book.title}
                  userId={userId}
                  onRatingChange={(r) => console.log("Rated:", r)}
                />
              </div>
            </div>

            {/* RIGHT: details */}
            <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
              <h1 style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 22, fontWeight: 700, color: C.title, margin: "0 0 7px", lineHeight: 1.25 }}>{book.title}</h1>
              <p style={{ fontFamily: "Montaga,serif", fontSize: 13.5, color: C.author, margin: "0 0 13px" }}>
                by{" "}
                <span
                  onClick={() => { if (authorName) { onClose(); setTimeout(() => onAuthor(authorName), 120); } }}
                  style={{ cursor: authorName ? "pointer" : "default", color: C.author, transition: "color 0.18s", textDecoration: authorName ? "underline" : "none", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
                  onMouseEnter={(e) => { if (authorName) e.target.style.color = C.authorHov; }}
                  onMouseLeave={(e) => { e.target.style.color = C.author; }}>
                  {displayAuthorsModal || book.authors || ""}
                </span>
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 }}>
                {genres.map((g) => (
                  <span key={g} style={{ padding: "3px 11px", borderRadius: 20, background: C.gChipBg, border: `1px solid ${C.gChipB}`, fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: C.gChipC }}>{g}</span>
                ))}
                {book.average_rating > 0 && <span style={{ padding: "3px 11px", borderRadius: 20, background: C.chipBg, border: `1px solid ${C.chipB}`, fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, fontWeight: 600, color: C.chipC }}>{Number(book.average_rating).toFixed(1)} ★</span>}
                {book.rating_count > 0 && <span style={{ padding: "3px 11px", borderRadius: 20, background: C.chipBg, border: `1px solid ${C.chipB}`, fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, color: C.chipCnt }}>{Number(book.rating_count).toLocaleString()} reviews</span>}
                {publishYear && <span style={{ padding: "3px 11px", borderRadius: 20, background: C.chipBg, border: `1px solid ${C.chipB}`, fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, color: C.chipCnt }}>{publishYear}</span>}
              </div>

              <div style={{ marginBottom: 14 }}>
                <button onClick={() => toggleRead(book)}
                  style={{ padding: "11px 22px", borderRadius: 8, cursor: "pointer", fontFamily: "Montserrat Alternates,sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", transition: "all 0.18s", border: "1.5px solid", background: C.rBtnBg, borderColor: C.rBtnB, color: C.rBtnC }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "none"; }}>
                  {isReadNow ? "✓ Already Read" : "Already Read"}
                </button>
              </div>

              {/* Description */}
              <div style={{ background: C.descBg, border: `1px solid ${C.descB}`, borderRadius: 10, padding: "12px 15px", marginBottom: 16, minHeight: 60 }}>
                <div style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 8.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: C.descLbl, marginBottom: 6 }}>
                  Description
                </div>
                {descLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(201,168,76,0.15)", borderTopColor: "rgba(201,168,76,0.5)", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                    <span style={{ fontFamily: "Montaga,serif", fontSize: 12, color: C.descLbl }}>Loading description…</span>
                  </div>
                ) : trimmedDesc ? (
                  <p style={{ fontFamily: "Montaga,serif", fontSize: 13, lineHeight: 1.72, color: C.descTxt, margin: 0 }}>{trimmedDesc}</p>
                ) : (
                  <p style={{ fontFamily: "Montaga,serif", fontSize: 12, color: C.descLbl, margin: 0, fontStyle: "italic" }}>No description available.</p>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {[
                  { label: isSaved ? "✓ Saved" : "Save", bg: C.sBtnBg, b: C.sBtnB, c: C.sBtnC, fn: () => onSave?.(book) },
                  { label: isLiked ? "♥ Liked" : "Like", bg: C.lBtnBg, b: C.lBtnB, c: C.lBtnC, fn: () => onLike?.(book) },
                  { label: isWished ? "✓ Wishlisted" : "Wishlist", bg: C.wBtnBg, b: C.wBtnB, c: C.wBtnC, fn: () => onWish?.(book) },
                ].map(({ label, bg, b, c, fn }) => (
                  <button key={label} onClick={fn} style={{ ...btnBase, background: bg, borderColor: b, color: c }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.82"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "none"; }}>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {onSearch && <RecBtn label="Find Similar" onClick={handleFindSimilar} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>} />}
                {onNav && <RecBtn label="Describe a Book" onClick={handleDescribe} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="12" height="12"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>} />}
              </div>
            </div>
          </div>

          {/* ═══ DIVIDER ═══ */}
          <div style={{ height: 1, background: C.divider, margin: "0 32px" }} />

          {/* ═══ SONG RECOMMENDATIONS ═══ */}
          <SongRecommendations book={book} isLight={isLight} apiBase={_resolveApiBase(API_BASE)} />

          {/* ═══ DIVIDER ═══ */}
          <div style={{ height: 1, background: C.divider, margin: "0 32px" }} />

          {/* AUTHOR COLLECTION */}
          {authorName && (
            <div style={{ padding: "20px 32px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={sHS} onClick={() => { onClose(); setTimeout(() => onAuthor(authorName), 120); }}
                  onMouseEnter={(e) => (e.target.style.color = C.authorHov)}
                  onMouseLeave={(e) => (e.target.style.color = C.secHead)}>
                  {authorName} Collection
                </span>
                <div style={{ flex: 1, height: 1, background: C.secLine }} />
              </div>
              {authorLoading
                ? <p style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10, color: C.loading, letterSpacing: ".1em", margin: 0 }}>Loading collection…</p>
                : authorBooks.length > 0
                  ? <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10, scrollbarWidth: "thin", scrollbarColor: C.scrollbar }}>{authorBooks.map((b, i) => <MiniCard key={b.title + i} book={b} onOpen={handleOpen} isLight={isLight} />)}</div>
                  : <p style={{ fontFamily: "Montaga,serif", fontSize: 12, color: C.noResult, margin: 0 }}>No other books found.</p>}
            </div>
          )}

          <div style={{ height: 1, background: C.divider, margin: "8px 32px" }} />

          {/* MORE LIKE THIS */}
          <div style={{ padding: "20px 32px 32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span style={sHS}>More Like This</span>
              <div style={{ flex: 1, height: 1, background: C.secLine }} />
            </div>
            {simLoading
              ? <p style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10, color: C.loading, letterSpacing: ".1em", margin: 0 }}>Finding similar books…</p>
              : similarBooks.length > 0
                ? <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 10, scrollbarWidth: "thin", scrollbarColor: C.scrollbar }}>{similarBooks.map((b, i) => <MiniCard key={b.title + i} book={b} onOpen={handleOpen} isLight={isLight} />)}</div>
                : <p style={{ fontFamily: "Montaga,serif", fontSize: 12, color: C.noResult, margin: 0 }}>No similar books found.</p>}
          </div>
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: "0 10px" }} onClick={(e) => e.stopPropagation()}>
        <NavArrow dir="next" onClick={goNext} isLight={isLight} disabled={!hasNext} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE AUTHORS
// ─────────────────────────────────────────────────────────────────────────────

function resolveAuthors(book) {
  const candidates = [
    book.authors, book.author, book.author_name,
    book.authorName, book.book_author,
  ];
  for (const c of candidates) {
    const s = (c || "").toString().trim();
    if (s && s !== "nan" && s !== "none" && s !== "null" && s !== "Unknown") return s;
  }
  return "";
}

const _authorCache = new Map();

async function fetchAuthorFromGB(title) {
  if (!title) return "";
  const key = title.toLowerCase().trim().slice(0, 80);
  if (_authorCache.has(key)) return _authorCache.get(key);
  try {
    const q = `intitle:${encodeURIComponent(title.replace(/[:\-–—].*/, "").trim())}`;
    const r = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&printType=books`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) throw new Error();
    const json = await r.json();
    for (const item of json?.items || []) {
      const auths = item?.volumeInfo?.authors;
      if (auths && auths.length > 0) {
        const result = auths.join(", ");
        _authorCache.set(key, result);
        return result;
      }
    }
  } catch {}
  _authorCache.set(key, "");
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOK CARD
// ─────────────────────────────────────────────────────────────────────────────

export default function BookCard({ book }) {
  const { setModalBook, handleAuthor } = useApp();
  const [hovered, setHovered] = useState(false);
  const rating = book.average_rating ? Number(book.average_rating) : 0;

  const [displayAuthors, setDisplayAuthors] = useState(() => resolveAuthors(book));

  useEffect(() => {
    const resolved = resolveAuthors(book);
    if (resolved) { setDisplayAuthors(resolved); return; }
    fetchAuthorFromGB(book.title || "").then(a => { if (a) setDisplayAuthors(a); });
  }, [book.title, book.authors]);

  const primaryAuthor = displayAuthors.split(",")[0]?.trim() || "";

  return (
    <div
      style={{ width: 148, flexShrink: 0, cursor: "pointer", position: "relative", alignSelf: "flex-start" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => setModalBook(book)}
    >
      <div style={{ width: 148, height: 222, borderRadius: 10, overflow: "hidden", background: "rgba(114,57,63,0.2)", transform: hovered ? "translateY(-6px)" : "translateY(0)", transition: "transform 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s ease", boxShadow: hovered ? "0 20px 48px rgba(0,0,0,0.7)" : "0 2px 8px rgba(0,0,0,0.3)" }}>
        <div style={{ width: "100%", height: "100%", transform: hovered ? "scale(1.08)" : "scale(1.0)", transition: "transform 0.55s cubic-bezier(0.22,1,0.36,1)", transformOrigin: "center center" }}>
          <CoverImg book={book} />
        </div>
      </div>
      <div style={{ padding: "7px 2px 0", minHeight: 56 }}>
        <div style={{ fontFamily: "Montaga,serif", fontSize: 11.5, color: "var(--text)", lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", marginBottom: 3, transform: hovered ? "translateY(-1px)" : "none", transition: "transform 0.25s ease" }}>
          {book.title || "Unknown"}
        </div>
        {primaryAuthor ? (
          <div
            onClick={(e) => { e.stopPropagation(); handleAuthor?.(primaryAuthor); }}
            style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, fontWeight: 300, color: "var(--marron)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", cursor: "pointer", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--gold)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--marron)")}>
            {displayAuthors}
          </div>
        ) : (
          <div style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, fontWeight: 300, color: "rgba(201,168,76,0.25)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            &nbsp;
          </div>
        )}
        {rating > 0 && <div style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9, color: "var(--gold)", marginTop: 3 }}>{rating.toFixed(1)} ★</div>}
      </div>
    </div>
  );
}