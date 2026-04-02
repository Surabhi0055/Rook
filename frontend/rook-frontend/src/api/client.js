// src/api/client.js

const BASE = "/api";

// ─────────────────────────────────────────────
// Auth Headers
// ─────────────────────────────────────────────
function getAuthHeaders() {
  const token = localStorage.getItem("rook_access_token");

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function ensureBook(book) {
  const res = await fetch(`${BASE}/books/add-or-get`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      book_id: book.book_id,  
      title: book.title,
      authors: book.authors,
      image_url: book.image_url,
      description: book.description,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to ensure book exists");
  }

  return await res.json();
}
// ─────────────────────────────────────────────
// SAFE RESPONSE HANDLER
// ─────────────────────────────────────────────
async function handleResponse(res) {
  let text;

  try {
    text = await res.text();   // ✅ READ ONLY ONCE
  } catch {
    throw new Error("Failed to read response");
  }
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text };   // fallback if not JSON
  }
  if (!res.ok) {
    if (data.detail === "Token expired") {
      localStorage.removeItem("rook_access_token");
      window.location.href = "/login";
      throw new Error("Session expired. Please login again.");
    }
    throw new Error(data.detail || "API Error");
  }
  return data;
}
// ─────────────────────────────────────────────
// Generic GET
// ─────────────────────────────────────────────
async function get(path) {
  const url = `${BASE}${path}`;
  console.log("GET:", url);

  const res = await fetch(url, {
    headers: getAuthHeaders(),
  });

  return handleResponse(res, path);
}

// ─────────────────────────────────────────────
// Generic POST
// ─────────────────────────────────────────────
async function post(path, body) {
  const url = `${BASE}${path}`;
  console.log("POST:", url, body);

  const res = await fetch(url, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });

  return handleResponse(res, path);
}

// ─────────────────────────────────────────────
// 📚 BOOKS (FIXED PATHS)
// ─────────────────────────────────────────────
export const getTrending = (topN = 20) =>
  get(`/trending?top_n=${topN}`);   // ✅ FIXED

export const getNewReleases = (topN = 20) =>
  get(`/trending/new?top_n=${topN}`); // (keep if exists in backend)

export const searchBooks = (query, topN = 10) =>
  get(`/search?query=${encodeURIComponent(query)}&top_n=${topN}`); // ✅ FIXED

// ─────────────────────────────────────────────
// 🎯 RECOMMENDATIONS
// ─────────────────────────────────────────────
export const getByMood = (mood, topN = 20, useLlm = false) =>
  post(`/recommend/mood`, {
    mood,
    top_n: topN,
    use_llm: useLlm,
  });

export const getByDescription = (description, topN = 12) =>
  post(`/recommend/description`, {
    description,
    top_n: topN,
  });

export const getByAuthor = (author, topN = 12) =>
  get(`/recommend/author?author=${encodeURIComponent(author)}&top_n=${topN}`);

export const getByTitle = (title, topN = 10) =>
  get(`/recommend/title?title=${encodeURIComponent(title)}&top_n=${topN}`); // ✅ FIXED

export const getByGenre = (genre, topN = 20) =>
  get(`/recommend/genre?genre=${encodeURIComponent(genre)}&top_n=${topN}`);

export const getForUser = (userId, topN = 12) =>
  get(`/recommend/user?user_id=${userId}&top_n=${topN}`);

export const getHybrid = (body) =>
  post(`/recommend/hybrid`, body);

// ─────────────────────────────────────────────
// ⭐ RATINGS (FIXED)
// ─────────────────────────────────────────────
export const rateBook = (data) =>
  post(`/ratings/rate`, data);   // ✅ FIXED (your backend uses this)

export const getBookRatings = (bookId) => {
  const id = Number(bookId);

  if (!bookId || !Number.isInteger(id) || id <= 0) {
    return Promise.resolve({ average_rating: 0, total_ratings: 0 });
  }

  return get(`/ratings/${id}`);
};

// ─────────────────────────────────────────────
// 👤 USER
// ─────────────────────────────────────────────
export const getUser = (userId) =>
  get(`/users/${userId}`);

// ─────────────────────────────────────────────
// 🔐 AUTH
// ─────────────────────────────────────────────
export const googleLogin = (token) =>
  post(`/auth/google`, { token });