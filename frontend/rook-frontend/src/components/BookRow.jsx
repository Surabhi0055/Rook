import BookCard from './BookCard'

export default function BookRow({ books = [], loading = false, error = null, useGrid = false }) {

  if (loading) {
    return (
      <>
        <style>{`
          .bk-row-scroll {
            padding: 12px 28px 28px;
            overflow-x: auto;
            overflow-y: visible;
            scrollbar-width: thin;
            scrollbar-color: rgba(114,57,63,0.4) transparent;
          }
          .bk-row-inner {
            display: flex;
            gap: 16px;
            min-width: max-content;
            padding-bottom: 8px;
            align-items: flex-start;   /* key: all cards anchor to top, no height stretching */
          }
          .bk-grid-inner {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
            gap: 20px;
            align-items: start;        /* same fix for grid */
          }
          .bk-skeleton-card {
            width: 148px;
            flex-shrink: 0;
          }
          .bk-skeleton-cover {
            width: 148px;
            height: 222px;
            border-radius: 10px;
            background: linear-gradient(
              90deg,
              rgba(255,255,255,0.04) 25%,
              rgba(255,255,255,0.09) 50%,
              rgba(255,255,255,0.04) 75%
            );
            background-size: 200% 100%;
            animation: sk-shimmer 1.4s infinite;
          }
          .bk-skeleton-line {
            height: 10px;
            border-radius: 5px;
            margin-top: 8px;
            background: rgba(255,255,255,0.07);
            animation: sk-shimmer 1.4s infinite;
          }
          .bk-skeleton-line.short { width: 60%; }
          @keyframes sk-shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
        <div className="bk-row-scroll">
          <div className="bk-row-inner">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bk-skeleton-card">
                <div className="bk-skeleton-cover" />
                <div className="bk-skeleton-line" />
                <div className="bk-skeleton-line short" />
              </div>
            ))}
          </div>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '24px 36px',
        fontFamily: 'Montaga, serif',
        fontSize: 13,
        color: 'var(--text-muted, rgba(240,232,220,0.5))',
      }}>
        Could not load books — {error}
      </div>
    )
  }

  if (!books.length) {
    return (
      <div style={{
        padding: '24px 36px',
        fontFamily: 'Montaga, serif',
        fontSize: 13,
        color: 'var(--text-muted, rgba(240,232,220,0.5))',
      }}>
        No books found
      </div>
    )
  }

  const mid = Math.floor(books.length / 2)

  if (useGrid) {
    return (
      <>
        <style>{`
          .bk-grid-inner {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
            gap: 20px;
            align-items: start;
            padding: 16px 28px 48px;
          }
        `}</style>
        <div className="bk-grid-inner">
          {books.map((book, i) => (
            <BookCard
              key={book.title + (book.authors || '') + i}
              book={book}
              featured={false}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <style>{`
        .bk-row-scroll {
          padding: 12px 28px 28px;
          overflow-x: auto;
          overflow-y: visible;
          scrollbar-width: thin;
          scrollbar-color: rgba(114,57,63,0.4) transparent;
        }
        .bk-row-scroll::-webkit-scrollbar { height: 4px; }
        .bk-row-scroll::-webkit-scrollbar-track { background: transparent; }
        .bk-row-scroll::-webkit-scrollbar-thumb { background: rgba(114,57,63,0.4); border-radius: 2px; }

        .bk-row-inner {
          display: flex;
          gap: 16px;
          min-width: max-content;
          padding-bottom: 8px;
          align-items: flex-start;   /* ALL cards anchor to top — no height stretching */
        }
      `}</style>
      <div className="bk-row-scroll">
        <div className="bk-row-inner">
          {books.map((book, i) => (
            <BookCard
              key={book.title + (book.authors || '') + i}
              book={book}
              featured={i === mid}
            />
          ))}
        </div>
      </div>
    </>
  )
}