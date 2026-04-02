import { useState, useEffect } from "react";
import { rateBook, getBookRatings } from "../api/client";
import { ensureBook } from "../api/client";

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

const RATINGS_KEY = "rook_user_ratings";

function getSavedRatings() {
  try {
    return JSON.parse(localStorage.getItem(RATINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveRatingLocally(bookId, rating) {
  try {
    const existing = getSavedRatings();
    existing[String(bookId)] = rating;
    localStorage.setItem(RATINGS_KEY, JSON.stringify(existing));
  } catch {}
}

function getLocalRating(bookId) {
  if (!bookId) return 0;
  try {
    return getSavedRatings()[String(bookId)] || 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveUserId(propUserId) {
  if (propUserId) return propUserId;
  try {
    const user = JSON.parse(localStorage.getItem("rook_user") || "{}");
    return user.id || user.userId || null;
  } catch {
    return null;
  }
}

function isValidBookId(bookId) {
  const id = Number(bookId);
  return (
    bookId != null && Number.isFinite(id) && id > 0 && Math.floor(id) === id
  );
}

// Extract the CSV book_id — checks book_id field first
function extractBookId(b) {
  const candidates = [b?.book_id, b?.id, b?.bookId, b?._id];
  for (const c of candidates) {
    if (c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0 && Math.floor(n) === n) return n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAR RATING COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function StarRating({
  bookId,
  bookCsvId,
  bookTitle,
  userId: userIdProp,
  onRatingChange,
}) {
  const userId = resolveUserId(userIdProp);

  const [resolvedId, setResolvedId] = useState(
    () => extractBookId({ book_id: bookCsvId, id: bookId }) || null,
  );
  const [resolving, setResolving] = useState(false);
  const initialId = extractBookId({ book_id: bookCsvId, id: bookId });
  const [userRating, setUserRating] = useState(() => getLocalRating(initialId));
  const [hovered, setHovered] = useState(0);
  const [avgRating, setAvgRating] = useState(0);
  const [totalRatings, setTotalRatings] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [justRated, setJustRated] = useState(false);

  // Resolve ID
  useEffect(() => {
    const direct = extractBookId({ book_id: bookCsvId, id: bookId });
    if (direct) {
      setResolvedId(direct);
      const saved = getLocalRating(direct);
      if (saved > 0) setUserRating(saved);
      return;
    }
    if (!bookTitle) {
      if (bookId) setResolvedId(Number(bookId));
      return;
    }
    const key = bookTitle.toLowerCase().trim();
    if (_titleIdCache.has(key)) {
      const cached = _titleIdCache.get(key);
      setResolvedId(cached);
      if (cached) {
        const s = getLocalRating(cached);
        if (s > 0) setUserRating(s);
      }
      return;
    }
    setResolving(true);
    resolveBookIdByTitle(bookTitle)
      .then((id) => {
        setResolvedId(id);
        if (id) {
          const s = getLocalRating(id);
          if (s > 0) setUserRating(s);
        }
      })
      .finally(() => setResolving(false));
  }, [bookId, bookCsvId, bookTitle]);

  // Fetch community stats
  useEffect(() => {
    if (!isValidBookId(resolvedId)) return;
    getBookRatings(resolvedId)
      .then((res) => {
        if (!res || typeof res !== "object") return;
        setAvgRating(res.average_rating || 0);
        setTotalRatings(res.total_ratings || 0);
      })
      .catch(() => {});
  }, [resolvedId]);
  const handleStarClick = async (starValue) => {
    if (!userId) {
      setMessage("Log in to rate");
      return;
    }
    setUserRating(starValue);
    const id = bookCsvId || resolvedId;
    if (id) saveRatingLocally(id, starValue);
    setSubmitting(true);
    setMessage("");
    try {
      await ensureBook({
        book_id: bookCsvId,
        title: bookTitle,
      });
      const ratingResponse = await rateBook({
        book_id: bookCsvId,
        rating: starValue,
      });
      setJustRated(true);
      setMessage(`Saved ${starValue}★`);
      const stats = await getBookRatings(bookCsvId);
      if (stats) {
        setAvgRating(stats.average_rating || 0);
        setTotalRatings(stats.total_ratings || 0);
      }
      if (onRatingChange) onRatingChange(starValue);
      setTimeout(() => {
        setMessage("");
        setJustRated(false);
      }, 2000);
    } catch (err) {
      console.error("Rating error:", err);
      setMessage("Failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };
  const canRate = !submitting;
  const renderStar = (starValue) => {
    const isActive = (hovered || userRating) >= starValue;
    return (
      <button
        key={starValue}
        onClick={() => canRate && handleStarClick(starValue)}
        onMouseEnter={() => canRate && setHovered(starValue)}
        onMouseLeave={() => setHovered(0)}
        disabled={!canRate}
        style={{
          background: "none",
          border: "none",
          cursor: canRate ? "pointer" : "wait",
          fontSize: "1.4rem",
          padding: "0 1px",
          color: isActive ? "#f59e0b" : "rgba(201,168,76,0.25)",
          transform: isActive ? "scale(1.18)" : "scale(1)",
          transition: "transform 0.1s ease, color 0.1s ease",
          lineHeight: 1,
        }}
        aria-label={`Rate ${starValue} star${starValue > 1 ? "s" : ""}`}
      >
        ★
      </button>
    );
  };

  const avgPercent = (avgRating / 5) * 100;

  return (
    <div style={{ fontFamily: "inherit" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginBottom: 5,
        }}
      >
        <div style={{ display: "flex" }}>
          {[1, 2, 3, 4, 5].map((v) => renderStar(v))}
        </div>
        {resolving && (
          <span
            style={{
              fontSize: "0.6rem",
              color: "rgba(201,168,76,0.5)",
              marginLeft: 4,
            }}
          >
            …
          </span>
        )}
        {submitting && (
          <span
            style={{
              fontSize: "0.6rem",
              color: "rgba(201,168,76,0.5)",
              marginLeft: 4,
            }}
          >
            saving…
          </span>
        )}
      </div>
      {userRating > 0 && !message && (
        <p
          style={{
            fontSize: "0.68rem",
            color: "rgba(201,168,76,0.6)",
            margin: "0 0 4px",
            fontFamily: "Montserrat Alternates,sans-serif",
          }}
        >
          Your rating: {userRating}★ · tap to change
        </p>
      )}
      {message && (
        <p
          style={{
            fontSize: "0.68rem",
            color: justRated
              ? "#50a870"
              : message.startsWith("Failed") ||
                  message.startsWith("Log") ||
                  message.startsWith("Rating un")
                ? "#ef4444"
                : "#50a870",
            margin: "2px 0 4px",
            fontFamily: "Montserrat Alternates,sans-serif",
          }}
        >
          {message}
        </p>
      )}
      {isValidBookId(resolvedId) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 2,
          }}
        >
          <div
            style={{
              width: 60,
              height: 3,
              background: "rgba(201,168,76,0.15)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${avgPercent}%`,
                height: "100%",
                background: "#f59e0b",
                borderRadius: 2,
                transition: "width 0.5s ease",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "0.68rem",
              color: "rgba(201,168,76,0.55)",
              fontFamily: "Montserrat Alternates,sans-serif",
            }}
          >
            {avgRating > 0 ? `${avgRating}/5` : "No ratings yet"}
            {totalRatings > 0 && (
              <span style={{ color: "rgba(201,168,76,0.35)", marginLeft: 4 }}>
                ({totalRatings})
              </span>
            )}
          </span>
        </div>
      )}
      {!isValidBookId(resolvedId) && !resolving && bookTitle && (
        <p
          style={{
            fontSize: "0.62rem",
            color: "rgba(201,168,76,0.3)",
            margin: "3px 0",
            fontFamily: "Montserrat Alternates,sans-serif",
          }}
        >
          Rating unavailable
        </p>
      )}
    </div>
  );
}

export default StarRating;
