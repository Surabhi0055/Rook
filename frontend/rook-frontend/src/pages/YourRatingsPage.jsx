import { useState, useEffect } from "react";
import BookRow from "../components/BookRow";
import { API_BASE, cleanImageUrl } from "../hooks/useBooks";
import { fetchGBCover } from "../components/BookCard";

const RATINGS_KEY = "rook_user_ratings";

function getStoredRatings() {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function dedupBooks(books) {
  const seen = new Set();
  return (books || []).filter((b) => {
    const k = (b.title || "").toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function StarRow({ rating }) {
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((v) => (
        <span key={v} style={{ fontSize: 12, color: v <= rating ? "#f59e0b" : "rgba(201,168,76,0.18)", lineHeight: 1 }}>★</span>
      ))}
    </div>
  );
}

function ratingLabel(r) {
  if (r >= 5) return { text: "Masterpiece", color: "#f59e0b" };
  if (r >= 4) return { text: "Loved it", color: "#50a870" };
  if (r >= 3) return { text: "Liked it", color: "#7ab8e0" };
  if (r >= 2) return { text: "It was ok", color: "#c88040" };
  return { text: "Didn't enjoy", color: "#e57b8b" };
}
function RatedBookCard({ book, onOpen }) {
  const [hov, setHov] = useState(false);
  const lbl = ratingLabel(book.userRating); 
  const [coverSrc, setCoverSrc] = useState(() => cleanImageUrl(book.image_url) || "");

  useEffect(() => {
    const clean = cleanImageUrl(book.image_url);
    if (clean) { setCoverSrc(clean); return; }
    fetchGBCover(book.title, book.authors || "").then((url) => { if (url) setCoverSrc(url); });
  }, [book.image_url, book.title]);

  return (
    <div
      onClick={() => onOpen(book)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ cursor: "pointer", position: "relative" }}
    >
      {/* Rating badge */}
      <div style={{
        position: "absolute", top: 8, right: 8, zIndex: 10,
        background: "rgba(0,0,0,0.78)", border: `1px solid ${lbl.color}55`,
        borderRadius: 6, padding: "3px 7px", display: "flex", alignItems: "center", gap: 3,
        backdropFilter: "blur(6px)",
      }}>
        <span style={{ fontSize: 11, color: "#f59e0b", lineHeight: 1 }}>★</span>
        <span style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10, fontWeight: 700, color: lbl.color, lineHeight: 1 }}>
          {book.userRating}
        </span>
      </div>

      <div style={{
        width: "100%", aspectRatio: "2/3", borderRadius: 10, overflow: "hidden",
        background: "rgba(114,57,63,0.2)",
        boxShadow: hov ? "0 18px 44px rgba(0,0,0,0.65)" : "0 4px 14px rgba(0,0,0,0.38)",
        transform: hov ? "translateY(-5px)" : "none",
        transition: "transform 0.25s cubic-bezier(0.22,1,0.36,1), box-shadow 0.25s ease",
        marginBottom: 8,
      }}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={book.title}
            style={{
              width: "100%", height: "100%", objectFit: "cover", display: "block",
              transform: hov ? "scale(1.06)" : "scale(1)",
              transition: "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
            }}
            onError={(e) => { e.target.style.display = "none"; }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(201,168,76,0.2)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="32" height="32">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
        )}
      </div>

      {/* Title */}
      <div style={{
        fontFamily: "Montaga,serif", fontSize: 11.5, color: "var(--text)", lineHeight: 1.35,
        overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical", marginBottom: 3,
      }}>
        {book.title}
      </div>

      {/* Author */}
      {book.authors && (
        <div style={{
          fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9.5, color: "var(--marron)",
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", marginBottom: 5,
        }}>
          {book.authors.split(",")[0].trim()}
        </div>
      )}

      <StarRow rating={book.userRating} />
      <span style={{
        fontFamily: "Montserrat Alternates,sans-serif", fontSize: 8.5, fontWeight: 600,
        color: lbl.color, letterSpacing: ".08em", textTransform: "uppercase",
        marginTop: 3, display: "block",
      }}>
        {lbl.text}
      </span>
    </div>
  );
}

function SectionHead({ eyebrow, eyebrowColor = "var(--gold)", title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9, fontWeight: 700, color: eyebrowColor, letterSpacing: ".2em", textTransform: "uppercase", margin: "0 0 3px" }}>
        {eyebrow}
      </p>
      <h3 style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 16, fontWeight: 600, color: "var(--cream)", margin: 0 }}>
        {title}
      </h3>
      {subtitle && (
        <p style={{ fontFamily: "Montaga,serif", fontSize: 11.5, color: "var(--text-muted)", margin: "4px 0 0" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0" }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid rgba(201,168,76,0.15)", borderTopColor: "rgba(201,168,76,0.7)", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10, color: "var(--text-muted)", letterSpacing: ".1em" }}>Loading…</span>
    </div>
  );
}

export function YourRatingsPage({ onOpen, onNav }) {
    const [ratedBooks, setRatedBooks] = useState([]);
  const [lovedRecs, setLovedRecs] = useState([]);
  const [mehRecs, setMehRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recsLoading, setRecsLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  /* ── fetch book details for every rated id ───────────────── */
  useEffect(() => {
    const allRatings = getStoredRatings();
    const ids = Object.keys(allRatings);
    if (!ids.length) { setLoading(false); return; }
    let cancelled = false;

    async function loadBooks() {
      const results = [];
      await Promise.allSettled(
        ids.map(async (id) => {
          try {
            const r = await fetch(`${API_BASE}/books/${id}`);
            if (!r.ok) return;
            const b = await r.json();
            if (b?.title) results.push({ ...b, userRating: allRatings[id] });
          } catch {}
        })
      );
      if (!cancelled) {
        results.sort((a, b) => b.userRating - a.userRating);
        setRatedBooks(results);
      }
    }

    loadBooks().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ratedBooks.length) return;
    let cancelled = false;
    setRecsLoading(true);

    const lovedTitles = ratedBooks.filter((b) => b.userRating >= 3).map((b) => b.title).slice(0, 6);
    const mehTitles = ratedBooks.filter((b) => b.userRating <= 2).map((b) => b.title).slice(0, 4);
    const owned = new Set(ratedBooks.map((b) => (b.title || "").toLowerCase()));

    function clean(raw) {
      return dedupBooks(Array.isArray(raw) ? raw : raw?.books || raw?.results || [])
        .filter((b) => !owned.has((b.title || "").toLowerCase()));
    }

    async function post(url, body) {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      return r.json();
    }

    async function loadRecs() {
      if (lovedTitles.length) {
        try {
          const d = await post(`${API_BASE}/recommend/saved`, {
            liked_titles: lovedTitles, saved_titles: [], read_titles: [], top_n: 24, user_action: "ratings_loved",
          });
          const list = clean(d);
          if (!cancelled && list.length >= 4) setLovedRecs(list.slice(0, 24));
        } catch {}

        // fallback hybrid if saved gave nothing
        if (!lovedRecs.length) {
          try {
            const d = await post(`${API_BASE}/recommend/hybrid`, { liked_titles: lovedTitles, saved_titles: [], top_n: 24 });
            if (!cancelled) setLovedRecs(clean(d).slice(0, 24));
          } catch {}
        }
      }

      if (mehTitles.length) {
        try {
          const d = await post(`${API_BASE}/recommend/hybrid`, { liked_titles: mehTitles, saved_titles: [], top_n: 24 });
          if (!cancelled) setMehRecs(clean(d).slice(0, 24));
        } catch {}
      }
    }

    loadRecs().finally(() => { if (!cancelled) setRecsLoading(false); });
    return () => { cancelled = true; };
  }, [ratedBooks.length]);

  /* ── derived ─────────────────────────────────────────────── */
  const loved = ratedBooks.filter((b) => b.userRating >= 3);
  const meh = ratedBooks.filter((b) => b.userRating <= 2);
  const filtered =
    activeFilter === "loved" ? loved :
    activeFilter === "meh" ? meh : ratedBooks;

  const avgRating = ratedBooks.length
    ? (ratedBooks.reduce((s, b) => s + b.userRating, 0) / ratedBooks.length).toFixed(1)
    : null;

  /* ── render ──────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: "100%", background: "var(--bg)" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* ── Page header ── */}
      <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid rgba(201,168,76,0.08)", background: "linear-gradient(135deg,rgba(114,57,63,0.14) 0%,transparent 100%)" }}>
        <button
          onClick={() => onNav("profile")}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "var(--text-muted)", fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: ".15em", textTransform: "uppercase", cursor: "pointer", marginBottom: 16, padding: 0, transition: "color 0.18s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--gold)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="13" height="13"><polyline points="15 18 9 12 15 6" /></svg>
          Back to Profile
        </button>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 9, fontWeight: 700, color: "var(--gold)", letterSpacing: ".2em", textTransform: "uppercase", margin: "0 0 4px" }}>Your Library</p>
            <h2 style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 24, fontWeight: 700, color: "var(--cream)", margin: 0 }}>Your Ratings</h2>
          </div>

          {/* Stat pills */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 4 }}>
            {[
              { label: "Rated", val: ratedBooks.length, color: "#c9a84c" },
              avgRating ? { label: "Avg", val: `${avgRating} ★`, color: "#f59e0b" } : null,
              { label: "Loved (3-5★)", val: loved.length, color: "#50a870" },
              { label: "Not for me", val: meh.length, color: "#e57b8b" },
            ].filter(Boolean).map((s) => (
              <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.12)", borderRadius: 10, padding: "8px 14px", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 76 }}>
                <span style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 17, fontWeight: 700, color: s.color }}>{s.val}</span>
                <span style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 8, color: "var(--text-muted)", letterSpacing: ".1em", textTransform: "uppercase", marginTop: 2 }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px 72px" }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "72px 0" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid rgba(201,168,76,0.15)", borderTopColor: "rgba(201,168,76,0.7)", animation: "spin 0.8s linear infinite" }} />
            <p style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 11, color: "var(--text-muted)", letterSpacing: ".1em" }}>Loading your ratings…</p>
          </div>

        ) : ratedBooks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "72px 0" }}>
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" width="52" height="52" style={{ color: "rgba(201,168,76,0.2)", marginBottom: 18 }}>
              <polygon points="24 4 30 16 44 18 34 28 36 42 24 36 12 42 14 28 4 18 18 16 24 4" />
            </svg>
            <h3 style={{ fontFamily: "Montserrat Alternates,sans-serif", fontSize: 16, color: "var(--cream)", marginBottom: 8 }}>No Ratings Yet</h3>
            <p style={{ fontFamily: "Montaga,serif", fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
              Open any book and tap the stars to rate it — your ratings will appear here.
            </p>
            <button onClick={() => onNav("trending")} style={{ padding: "10px 24px", background: "var(--maroon)", border: "none", borderRadius: 8, color: "var(--cream)", fontFamily: "Montserrat Alternates,sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", cursor: "pointer" }}>
              Browse Books →
            </button>
          </div>

        ) : (
          <>
            {/* ── Filter tabs ── */}
            <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
              {[
                { id: "all", label: `All (${ratedBooks.length})`, color: "var(--gold)" },
                { id: "loved", label: `★★★+ Loved (${loved.length})`, color: "#50a870" },
                { id: "meh", label: `★★ Not for Me (${meh.length})`, color: "#e57b8b" },
              ].map((f) => (
                <button key={f.id} onClick={() => setActiveFilter(f.id)}
                  style={{
                    padding: "8px 16px", borderRadius: 20, cursor: "pointer",
                    fontFamily: "Montserrat Alternates,sans-serif", fontSize: 10,
                    fontWeight: 600, letterSpacing: ".1em", transition: "all 0.18s",
                    border: `1px solid ${activeFilter === f.id ? f.color : "rgba(201,168,76,0.2)"}`,
                    background: activeFilter === f.id ? `${f.color}18` : "transparent",
                    color: activeFilter === f.id ? f.color : "var(--text-muted)",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* ── Rated books grid ── */}
            {filtered.length === 0 ? (
              <p style={{ fontFamily: "Montaga,serif", fontSize: 13, color: "var(--text-muted)", marginBottom: 40 }}>No books in this filter.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "22px 16px", marginBottom: 56 }}>
                {filtered.map((book, i) => (
                  <RatedBookCard key={book.title + i} book={book} onOpen={onOpen} />
                ))}
              </div>
            )}

            {/* ── Loved recs ── */}
            {loved.length > 0 && (
              <section style={{ marginBottom: 52 }}>
                <div style={{ height: 1, background: "rgba(201,168,76,0.1)", marginBottom: 28 }} />
                <SectionHead
                  eyebrow="Based on Your ★★★+ Ratings"
                  eyebrowColor="#50a870"
                  title="More Books You'll Love"
                  subtitle={`Picked because you loved ${loved.slice(0, 2).map((b) => b.title).join(", ")}${loved.length > 2 ? " and others" : ""}`}
                />
                {recsLoading ? <Spinner /> : lovedRecs.length > 0
                  ? <BookRow books={lovedRecs} loading={false} />
                  : <p style={{ fontFamily: "Montaga,serif", fontSize: 12, color: "var(--text-muted)" }}>No recommendations found yet.</p>
                }
              </section>
            )}

            {/* ── Meh recs ── */}
            {meh.length > 0 && (
              <section>
                <div style={{ height: 1, background: "rgba(201,168,76,0.1)", marginBottom: 28 }} />
                <SectionHead
                  eyebrow="Similar to Your ★★ Rated Books"
                  eyebrowColor="#e57b8b"
                  title="Books in a Similar Vein"
                  subtitle="You rated these lower — explore similar titles and decide for yourself."
                />
                {recsLoading ? <Spinner /> : mehRecs.length > 0
                  ? <BookRow books={mehRecs} loading={false} />
                  : <p style={{ fontFamily: "Montaga,serif", fontSize: 12, color: "var(--text-muted)" }}>No similar books found.</p>
                }
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default YourRatingsPage;