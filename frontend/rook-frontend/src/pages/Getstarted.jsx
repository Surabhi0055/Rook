import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function GetStarted() {
  const navigate = useNavigate()

  const token   = localStorage.getItem('rook_access_token')
  const userRaw = localStorage.getItem('rook_user')
  const user    = (() => { try { return userRaw ? JSON.parse(userRaw) : null } catch { return null } })()
  const username   = user?.username || user?.name || ''
  const isLoggedIn = !!token
  const initial    = username.charAt(0).toUpperCase()

  // Lock body scroll on mount, restore on unmount
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    document.body.style.margin   = '0'
    document.body.style.padding  = '0'
    return () => { document.body.style.overflow = '' }
  }, [])

  function goToApp()    { navigate('/home') }
  function goToLogin()  { navigate('/auth') }
  function goToSignup() {
    sessionStorage.setItem('rook_auth_panel', 'register')
    navigate('/auth')
  }
  function doLogout() {
    localStorage.removeItem('rook_access_token')
    localStorage.removeItem('rook_refresh_token')
    localStorage.removeItem('rook_user')
    navigate('/', { replace: true })
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montaga&family=Montserrat+Alternates:wght@300;400;500;600;700;900&display=swap');
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
          --maroon:    #6b1e28;
          --grey-dark: #332e2b;
          --beige:     #ece3dc;
          --text-dark: #3a2a24;
          --gold:      #c9a84c;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.8); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .gs-root {
          position: relative;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          font-family: 'Montaga', serif;
        }
        /* ── Background ── */
        .gs-bg {
          position: absolute;
          inset: 0;
          background: url('/assets/bg.png') no-repeat center center / cover;
          z-index: 0;
        }
       
        /* ── Top bar ── */
        .gs-topbar {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 32px 60px 0;
        }
        .gs-logo-group {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .gs-logo-img {
          width: 72px;
          height: 72px;
          object-fit: contain;
        }
        .gs-logo-text {
          font-family: 'Montserrat Alternates', sans-serif;
          color: var(--grey-dark);
          font-size: 32px;
          font-weight: 500;
          letter-spacing: 4px;
          line-height: 1;
        }
        .gs-nav-btns {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-shrink: 0;
        }

        /* ── Buttons ── */
        .gs-btn-outline {
          font-family: "Montserrat Alternates", sans-serif;
          padding: 10px 28px;
          background: transparent;
          color: var(--grey-dark);
          border: 2px solid var(--grey-dark);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          transition: 0.3s ease;
        }
        .gs-btn-outline:hover { background: var(--grey-dark); color: #fff; }

        .gs-btn-filled {
          font-family: "Montserrat Alternates", sans-serif;
          padding: 10px 28px;
          background: var(--maroon);
          color: #fff;
          border: 2px solid var(--maroon);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          transition: 0.3s ease;
          box-shadow: 0 4px 16px rgba(107,30,40,0.4);
        }
        .gs-btn-filled:hover {
          background: #8a2535;
          border-color: #8a2535;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(107,30,40,0.55);
        }

        .gs-cta-btn {
          font-family: "Montserrat Alternates", sans-serif;
          padding: 16px 44px;
          background: var(--grey-dark);
          color: #fff;
          border: 2px solid var(--grey-dark);
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          transition: 0.3s ease;
          box-shadow: 0 5px 20px rgba(0,0,0,0.4);
        }
        .gs-cta-btn:hover {
          background: var(--maroon);
          border-color: var(--maroon);
          transform: translateY(-3px);
        }

        .gs-cta-btn-secondary {
          font-family: "Montserrat Alternates", sans-serif;
          padding: 16px 44px;
          background: transparent;
          color: var(--grey-dark);
          border: 2px solid var(--grey-dark);
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          transition: 0.3s ease;
        }
        .gs-cta-btn-secondary:hover {
          background: rgba(51,46,43,0.1);
          transform: translateY(-2px);
        }

        /* ── User chip ── */
        .gs-user-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 20px 8px 12px;
          background: rgba(51,46,43,0.12);
          border: 2px solid rgba(51,46,43,0.25);
          border-radius: 50px;
          cursor: pointer;
          transition: 0.3s ease;
        }
        .gs-user-chip:hover { background: rgba(214,205,176,0.86); }

        /* ── Hero ── */
        .gs-hero {
          position: absolute;
          top: 180px;
          left: 80px;
          width: min(520px, calc(100vw - 120px));
          z-index: 10;
          animation: fadeInUp 0.7s cubic-bezier(0.22,1,0.36,1) both;
        }

        .gs-welcome-pill {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          padding: 10px 20px;
          background: rgba(201,168,76,0.12);
          border: 1px solid rgba(201,168,76,0.35);
          border-radius: 50px;
          width: fit-content;
        }

        .gs-eyebrow {
          font-family: 'Montaga', serif;
          letter-spacing: 2px;
          font-size: 30px;
          color: var(--grey-dark);
          font-weight: 300;
          margin: 0;
        }

        .gs-headline {
          font-family: 'Montserrat Alternates', sans-serif;
          font-size: clamp(48px, 7vw, 72px);
          font-weight: 500;
          color: var(--maroon);
          margin: 6px 0 18px;
          line-height: 1.05;
        }

        .gs-subtext {
          font-family: 'Montaga', serif;
          font-size: 17px;
          color: var(--text-dark);
          line-height: 1.65;
          max-width: 440px;
          margin-bottom: 36px;
        }

        .gs-cta-row {
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
        }

        @media (max-width: 700px) {
          .gs-topbar { padding: 20px 24px 0; }
          .gs-logo-text { font-size: 24px; }
          .gs-logo-img  { width: 52px; height: 52px; }
          .gs-hero { top: 110px; left: 24px; width: calc(100vw - 48px); }
          .gs-cta-row { flex-direction: column; align-items: flex-start; }
          .gs-btn-outline, .gs-btn-filled { padding: 8px 16px; font-size: 11px; }
        }
      `}</style>

      <div className="gs-root">

        {/* ── Background image ── */}
        <div className="gs-bg" />

        {/* ── Top bar ── */}
        <div className="gs-topbar">

          {/* Logo */}
          <div className="gs-logo-group" onClick={() => navigate('/')}>
            <img
              src="/assets/rook.png"
              alt="ROOK"
              className="gs-logo-img"
              onError={e => e.target.style.display = 'none'}
            />
            <span className="gs-logo-text">ROOK</span>
          </div>

          {/* Nav buttons */}
          <div className="gs-nav-btns">
            {isLoggedIn && username ? (
              <>
                <div className="gs-user-chip" onClick={goToApp} title="Open ROOK App">
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'var(--maroon)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: '"Montserrat Alternates", sans-serif',
                    fontSize: 12, fontWeight: 700, color: 'var(--gold)', flexShrink: 0,
                  }}>{initial}</div>
                  <div style={{
                    fontFamily: '"Montserrat Alternates", sans-serif',
                    fontSize: 12, fontWeight: 500, color: 'var(--grey-dark)',
                    letterSpacing: 1, maxWidth: 120,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{username}</div>
                </div>
                <button className="gs-btn-outline" onClick={doLogout} style={{ padding: '8px 20px', fontSize: 11 }}>
                  Log Out
                </button>
              </>
            ) : (
              <>
                <button className="gs-btn-outline" onClick={goToLogin}>Log In</button>
                <button className="gs-btn-filled" onClick={goToSignup}>Sign Up</button>
              </>
            )}
          </div>
        </div>

        {/* ── Hero ── */}
        <section className="gs-hero">

          {isLoggedIn && username && (
            <div className="gs-welcome-pill">
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--gold)', flexShrink: 0,
                animation: 'pulse 2s ease infinite',
              }} />
              <div style={{
                fontFamily: '"Montaga", serif', fontSize: 13,
                color: 'var(--grey-dark)', letterSpacing: '0.05em',
              }}>
                Welcome back,{' '}
                <strong style={{
                  fontFamily: '"Montserrat Alternates", sans-serif',
                  fontWeight: 600, color: 'var(--maroon)',
                }}>{username}</strong>
              </div>
            </div>
          )}

          <h4 className="gs-eyebrow">FIND YOUR NEXT</h4>
          <h1 className="gs-headline">Great Read</h1>

          <p className="gs-subtext">
            Discover books tailored to your taste — search by title,
            explore genres, or let our recommendations surprise you.
          </p>

          <div className="gs-cta-row">
            {isLoggedIn ? (
              <>
                <button className="gs-cta-btn" onClick={goToApp}>Open ROOK →</button>
                <button className="gs-cta-btn-secondary" onClick={doLogout}>Log Out</button>
              </>
            ) : (
              <>
                <button className="gs-cta-btn" onClick={goToLogin}>Get Started →</button>
                <button className="gs-cta-btn-secondary" onClick={goToSignup}>Create Account</button>
              </>
            )}
          </div>
        </section>

      </div>
    </>
  )
}