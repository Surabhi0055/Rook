import { createContext, useContext, useState, useEffect } from "react";

const AppContext = createContext(null);

function load(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }) {
  // ── Persistent state ──────────────────────────────────────────
  const [savedBooks, setSavedBooks] = useState(() => load("rook_saved", []));
  const [likedBooks, setLikedBooks] = useState(() => load("rook_liked", []));
  const [wishlistBooks, setWishlistBooks] = useState(() =>
    load("rook_wishlist", []),
  );
  const [readBooks, setReadBooks] = useState(() => load("rook_read", []));
  const [userProfile, setUserProfile] = useState(() =>
    load("rook_profile", {}),
  );
  const [theme, setTheme] = useState(() => load("rook_theme", "dark"));

  // ── Toast ─────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);

  // ── Modal ─────────────────────────────────────────────────────
  const [modalBook, setModalBook] = useState(null);

  // ── handleAuthor — set by Home.jsx on mount via setHandleAuthor ─
  const [handleAuthor, setHandleAuthor] = useState(() => () => {});

  // ── Auto-save to localStorage ─────────────────────────────────
  useEffect(() => {
    localStorage.setItem("rook_saved", JSON.stringify(savedBooks));
  }, [savedBooks]);
  useEffect(() => {
    localStorage.setItem("rook_liked", JSON.stringify(likedBooks));
  }, [likedBooks]);
  useEffect(() => {
    localStorage.setItem("rook_wishlist", JSON.stringify(wishlistBooks));
  }, [wishlistBooks]);
  useEffect(() => {
    localStorage.setItem("rook_read", JSON.stringify(readBooks));
  }, [readBooks]);
  useEffect(() => {
    localStorage.setItem("rook_profile", JSON.stringify(userProfile));
  }, [userProfile]);
  useEffect(() => {
    localStorage.setItem("rook_theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ── Toast helper ──────────────────────────────────────────────
  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // ── Book action helpers ───────────────────────────────────────
  const isSaved = (title) => savedBooks.some((b) => b.title === title);
  const isLiked = (title) => likedBooks.some((b) => b.title === title);
  const isWished = (title) => wishlistBooks.some((b) => b.title === title);
  const isRead = (title) => readBooks.some((b) => b.title === title);

  function toggleSave(book) {
    if (isSaved(book.title)) {
      setSavedBooks((prev) => prev.filter((b) => b.title !== book.title));
      showToast("Removed from Saved");
    } else {
      setSavedBooks((prev) => [{ ...book, savedAt: Date.now() }, ...prev]);
      showToast(`Saved "${book.title}"`);
    }
  }

  function toggleLike(book) {
    if (isLiked(book.title)) {
      setLikedBooks((prev) => prev.filter((b) => b.title !== book.title));
      showToast("Removed from Liked");
    } else {
      setLikedBooks((prev) => [{ ...book, likedAt: Date.now() }, ...prev]);
      showToast(`Liked "${book.title}"`);
    }
  }

  function toggleWish(book) {
    if (isWished(book.title)) {
      setWishlistBooks((prev) => prev.filter((b) => b.title !== book.title));
      showToast("Removed from Wishlist");
    } else {
      setWishlistBooks((prev) => [{ ...book, wishedAt: Date.now() }, ...prev]);
      showToast(`Added "${book.title}" to Wishlist`);
    }
  }
  function toggleRead(book) {
    if (isRead(book.title)) {
      setReadBooks((prev) => prev.filter((b) => b.title !== book.title));
      showToast("Removed from Read");
    } else {
      setReadBooks((prev) => [{ ...book, readAt: Date.now() }, ...prev]);
      showToast(`Marked "${book.title}" as read ✓`);
    }
  }
  // ── Context value ─────────────────────────────────────────────
  const value = {
    savedBooks,
    setSavedBooks,
    likedBooks,
    setLikedBooks,
    wishlistBooks,
    setWishlistBooks,
    userProfile,
    setUserProfile,
    theme,
    setTheme,
    toast,
    showToast,
    modalBook,
    setModalBook,
    isSaved,
    isLiked,
    isWished,
    toggleSave,
    toggleLike,
    toggleWish,
    handleAuthor,
    setHandleAuthor,
    readBooks,
    setReadBooks,
    isRead,
    toggleRead,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);

export { AppContext };