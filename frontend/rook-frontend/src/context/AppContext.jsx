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
  // ── User Key Detection ────────────────────────────────────────
  const [userKey, setUserKey] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem('rook_user') || '{}');
      return u.username || u.email || 'guest';
    } catch { return 'guest'; }
  });

  // Helper to get namespaced key
  const nk = (key) => `${key}_${userKey}`;

  // ── Persistent state ──────────────────────────────────────────
  const [savedBooks, setSavedBooks] = useState(() => load(nk("rook_saved"), []));
  const [likedBooks, setLikedBooks] = useState(() => load(nk("rook_liked"), []));
  const [wishlistBooks, setWishlistBooks] = useState(() =>
    load(nk("rook_wishlist"), []),
  );
  const [readBooks, setReadBooks] = useState(() => load(nk("rook_read"), []));
  const [userProfile, setUserProfile] = useState(() =>
    load(nk("rook_profile"), {}),
  );
  const [theme, setTheme] = useState(() => load("rook_theme", "dark"));

  // ── Toast ─────────────────────────────────────────────────────
  const [toast, setToast] = useState(null);

  // ── Modal ─────────────────────────────────────────────────────
  const [modalBook, setModalBook] = useState(null);

  // ── handleAuthor — set by Home.jsx on mount via setHandleAuthor ─
  const [handleAuthor, setHandleAuthor] = useState(() => () => {});

  // ── Sync userKey when rook_user changes ────────────────────────
  useEffect(() => {
    const handleStorage = () => {
      try {
        const u = JSON.parse(localStorage.getItem('rook_user') || '{}');
        const newKey = u.username || u.email || 'guest';
        if (newKey !== userKey) {
          setUserKey(newKey);
          // Reload data for the new user
          setSavedBooks(load(`rook_saved_${newKey}`, []));
          setLikedBooks(load(`rook_liked_${newKey}`, []));
          setWishlistBooks(load(`rook_wishlist_${newKey}`, []));
          setReadBooks(load(`rook_read_${newKey}`, []));
          setUserProfile(load(`rook_profile_${newKey}`, {}));
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorage);
    // Also poll slightly for local changes that don't trigger 'storage' event
    const interval = setInterval(handleStorage, 1000);
    return () => {
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
    };
  }, [userKey]);

  // ── Auto-save to localStorage ─────────────────────────────────
  useEffect(() => {
    localStorage.setItem(nk("rook_saved"), JSON.stringify(savedBooks));
  }, [savedBooks, userKey]);
  useEffect(() => {
    localStorage.setItem(nk("rook_liked"), JSON.stringify(likedBooks));
  }, [likedBooks, userKey]);
  useEffect(() => {
    localStorage.setItem(nk("rook_wishlist"), JSON.stringify(wishlistBooks));
  }, [wishlistBooks, userKey]);
  useEffect(() => {
    localStorage.setItem(nk("rook_read"), JSON.stringify(readBooks));
  }, [readBooks, userKey]);
  useEffect(() => {
    localStorage.setItem(nk("rook_profile"), JSON.stringify(userProfile));
  }, [userProfile, userKey]);
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