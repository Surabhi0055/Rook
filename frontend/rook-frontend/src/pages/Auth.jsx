import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
const API = (import.meta.env.VITE_API_URL || "") + "/api";
const GOOGLE_CLIENT_ID = '482908299007-4kjj83gbr0o8h68v2ootmo5dra93b3ei.apps.googleusercontent.com'

async function apiPost(path, body, token = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (token && typeof token === 'string' && token.trim() !== '') {
    headers['Authorization'] = 'Bearer ' + token
  }
  try {
    const res  = await fetch(API + path, { method: 'POST', headers, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      localStorage.removeItem('rook_access_token')
      window.location.href = '/auth'   
      return { ok: false, status: 401, data }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    console.error('[apiPost] Network error:', err)
    throw err
  }
}
function saveSession(data) {
  if (data.access_token)  localStorage.setItem('rook_access_token',  data.access_token)
  if (data.refresh_token) localStorage.setItem('rook_refresh_token', data.refresh_token)
  localStorage.setItem('rook_user', JSON.stringify(data.user || {}))

}
function getToken() {
  const token = localStorage.getItem("rook_access_token");
  return token && token.trim() !== "" ? token : null;
}
function getSavedCreds() {
  try { const r = localStorage.getItem('rook_remember'); return r ? JSON.parse(atob(r)) : null } catch { return null }
}
function saveCredentials(id, pw) { localStorage.setItem('rook_remember', btoa(JSON.stringify({ identifier:id, password:pw }))) }
function clearCredentials()      { localStorage.removeItem('rook_remember') }
function calcStrength(pw) {
  let s = 0
  if (pw.length >= 8)  s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw))        s++
  if (/[0-9]/.test(pw))        s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return s
}
const STRENGTH_LEVELS = [
  { w:'0%',   color:'transparent', text:'' },
  { w:'25%',  color:'#e74c3c',     text:'Weak' },
  { w:'50%',  color:'#e67e22',     text:'Fair' },
  { w:'75%',  color:'#f1c40f',     text:'Good' },
  { w:'90%',  color:'#2ecc71',     text:'Strong' },
  { w:'100%', color:'#27ae60',     text:'Very strong' },
]

/* ─────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────── */
const IconUser  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
const IconLock  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="16" height="16"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
const IconMail  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="16" height="16"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
const IconEye   = ({ off }) => off
  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="16" height="16"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
const IconBack  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
const IconCheck = () => <svg viewBox="0 0 24 24" fill="none" stroke="#6fcf97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="30" height="30"><polyline points="20 6 9 17 4 12"/></svg>

/* ─────────────────────────────────────────────────────────────
   GOOGLE SIGN-IN BUTTON COMPONENT
───────────────────────────────────────────────────────────── */
function GoogleSignInButton({ onCredential, onError, isLight }) {
  const containerRef = useRef(null)
  const attemptsRef  = useRef(0)
  const timerRef     = useRef(null)

  useEffect(() => {
    attemptsRef.current = 0

    function tryInit() {
      attemptsRef.current++
      if (!window.google?.accounts?.id) {
        if (attemptsRef.current < 50) {
          timerRef.current = setTimeout(tryInit, 200)
        } else {
          onError?.('Google Sign-In script failed to load. Check your connection.')
        }
        return
      }
      
      if (!containerRef.current) {
        timerRef.current = setTimeout(tryInit, 100)
        return
      }

      try {
        window.google.accounts.id.initialize({
          client_id:            GOOGLE_CLIENT_ID,
          callback:             handleCredentialResponse,
          ux_mode:              'popup',
          cancel_on_tap_outside: true,
        })

        const w = containerRef.current.offsetWidth
        window.google.accounts.id.renderButton(containerRef.current, {
          theme:          isLight ? 'outline' : 'filled_black',
          size:           'large',
          shape:          'pill',
          width:          w > 100 ? w : 352,
        })
      } catch (err) {
        console.warn("GSI rendering error:", err)
      }
    }

    tryInit()
    return () => {
      clearTimeout(timerRef.current)
    }
  }, [isLight])

  async function handleCredentialResponse(response) {
    if (!response?.credential) {
      onError?.('Google login failed — no credential received.')
      return
    }
    console.log('[Google] Credential received, posting to backend...')
    try {
      const { ok, data } = await apiPost('/auth/google', { id_token: response.credential })
      if (!ok) {
        console.error('[Google] Backend rejected token:', data)
        onError?.(data?.detail || 'Google login failed. Please try again.')
        return
      }
      console.log('[Google] Login success:', data.user?.username)
      onCredential(data)
    } catch (err) {
      console.error('[Google] Network error:', err)
      onError?.('Could not connect to server.')
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        width:        '100%', minHeight:    44,  borderRadius: 50,
        overflow:     'hidden', 
        background:   isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.07)',
        border:       `1px solid ${isLight ? 'rgba(107,30,40,0.2)' : 'rgba(201,168,76,0.22)'}`,
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        transition:   'all 0.25s',
      }}
    />
  )
}

/* ─────────────────────────────────────────────────────────────
   SHARED UI COMPONENTS
───────────────────────────────────────────────────────────── */
function Field({ icon:Icon, type='text', value, onChange, placeholder, autoComplete, isLight }) {
  const [showPwd, setShowPwd] = useState(false)
  const isPassword = type === 'password'
  const inputType  = isPassword ? (showPwd ? 'text' : 'password') : type
  return (
    <div style={{ position:'relative' }}>
      <span style={{ position:'absolute', left:15, top:'50%', transform:'translateY(-50%)', color:'rgba(201,168,76,0.55)', pointerEvents:'none', display:'flex', alignItems:'center' }}>
        <Icon />
      </span>
      <input
        type={inputType} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        style={{ width:'100%', padding:'13px 44px', background:isLight?'rgba(255,255,255,0.55)':'rgba(107,30,40,0.35)', border:`1px solid ${isLight?'rgba(107,30,40,0.22)':'rgba(201,168,76,0.2)'}`, borderRadius:50, color:isLight?'#2a1a14':'#f0e8dc', fontFamily:'Montaga, serif', fontSize:14, outline:'none', transition:'all 0.25s', boxSizing:'border-box' }}
        onFocus={e => { e.target.style.borderColor = isLight?'rgba(107,30,40,0.45)':'rgba(201,168,76,0.5)'; e.target.style.boxShadow = isLight?'0 0 0 3px rgba(107,30,40,0.08)':'0 0 0 3px rgba(201,168,76,0.1)' }}
        onBlur={e  => { e.target.style.borderColor = isLight?'rgba(107,30,40,0.22)':'rgba(201,168,76,0.2)'; e.target.style.boxShadow = 'none' }}
      />
      {isPassword && (
        <span onClick={() => setShowPwd(v => !v)}
          style={{ position:'absolute', right:16, top:'50%', transform:'translateY(-50%)', cursor:'pointer', color:isLight?'rgba(60,35,25,0.5)':'rgba(232,221,208,0.5)', display:'flex', alignItems:'center' }}
          onMouseEnter={e => e.currentTarget.style.color='#c9a84c'}
          onMouseLeave={e => e.currentTarget.style.color=isLight?'rgba(60,35,25,0.5)':'rgba(232,221,208,0.5)'}>
          <IconEye off={showPwd} />
        </span>
      )}
    </div>
  )
}

function StrengthBar({ password }) {
  const level = STRENGTH_LEVELS[Math.min(calcStrength(password), 5)]
  if (!password) return null
  return (
    <div>
      <div style={{ height:3, borderRadius:2, background:'rgba(255,255,255,0.08)', overflow:'hidden', marginTop:6 }}>
        <div style={{ height:'100%', borderRadius:2, width:level.w, background:level.color, transition:'width 0.3s, background 0.3s' }} />
      </div>
      <div style={{ fontSize:11, color:level.color, fontFamily:'Montaga, serif', marginTop:4, textAlign:'right' }}>{level.text}</div>
    </div>
  )
}

function Alert({ msg, type }) {
  if (!msg) return null
  const s = type === 'error'
    ? { background:'rgba(255,107,107,0.15)', border:'1px solid rgba(255,107,107,0.35)', color:'#ffaaaa' }
    : { background:'rgba(111,207,151,0.12)', border:'1px solid rgba(111,207,151,0.3)',  color:'#8de0b0' }
  return <div style={{ ...s, padding:'10px 16px', borderRadius:10, fontSize:13, fontFamily:'Montaga, serif', marginTop:12, animation:'alertIn 0.25s ease both' }}>{msg}</div>
}

function PrimaryBtn({ onClick, loading, children, style={} }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{ width:'100%', padding:'14px', marginTop:10, background:'linear-gradient(135deg,#6b1e28 0%,#332e2b 100%)', border:'1px solid rgba(201,168,76,0.3)', borderRadius:50, color:'#e8ddd0', fontFamily:'Montserrat Alternates, sans-serif', fontSize:13, fontWeight:500, letterSpacing:'0.18em', textTransform:'uppercase', cursor:loading?'not-allowed':'pointer', transition:'all 0.25s', opacity:loading?0.7:1, ...style }}
      onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 6px 24px rgba(107,30,40,0.55)' }}}
      onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='none' }}>
      {loading
        ? <div style={{ width:16, height:16, border:'2px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite', margin:'0 auto' }} />
        : children}
    </button>
  )
}

function Divider({ isLight }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, margin:'14px 0 12px' }}>
      <div style={{ flex:1, height:1, background:'linear-gradient(90deg,transparent,rgba(201,168,76,0.2),transparent)' }} />
      <span style={{ fontSize:11, color:isLight?'rgba(60,35,25,0.45)':'rgba(232,221,208,0.5)', fontFamily:'Montaga, serif', letterSpacing:'0.1em', textTransform:'uppercase' }}>or</span>
      <div style={{ flex:1, height:1, background:'linear-gradient(90deg,transparent,rgba(201,168,76,0.2),transparent)' }} />
    </div>
  )
}

function SuccessPanel({ username, isNew }) {
  return (
    <div style={{ textAlign:'center', padding:'24px 0 8px' }}>
      <div style={{ width:68, height:68, borderRadius:'50%', background:'rgba(111,207,151,0.1)', border:'1.5px solid rgba(111,207,151,0.4)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', animation:'popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both 0.1s' }}><IconCheck /></div>
      <div style={{ fontFamily:'Montserrat Alternates, sans-serif', fontSize:24, fontWeight:600, color:'#f0e8dc', marginBottom:8, animation:'fadeUp 0.4s ease both 0.3s' }}>{isNew ? `Welcome, ${username}!` : `Welcome back, ${username}!`}</div>
      <div style={{ color:'rgba(232,221,208,0.65)', fontSize:13, fontFamily:'Montaga, serif', animation:'fadeUp 0.4s ease both 0.4s' }}>{isNew ? 'Your account has been created.' : 'You are now signed in.'}</div>
      {username && <div style={{ display:'inline-block', marginTop:12, padding:'5px 18px', background:'rgba(201,168,76,0.1)', border:'1px solid rgba(201,168,76,0.25)', borderRadius:20, color:'#c9a84c', fontFamily:'Montserrat Alternates, sans-serif', fontSize:13, fontWeight:600, letterSpacing:'0.06em', animation:'fadeUp 0.4s ease both 0.5s' }}>@{username}</div>}
      <div style={{ marginTop:22, height:3, borderRadius:2, background:'rgba(255,255,255,0.07)', overflow:'hidden' }}>
        <div style={{ height:'100%', background:'linear-gradient(90deg,#6b1e28,#c9a84c)', borderRadius:2, animation:'fillBar 2.6s linear both 0.6s' }} />
      </div>
      <div style={{ fontFamily:'Montaga, serif', fontSize:11.5, color:'rgba(232,221,208,0.5)', marginTop:8, letterSpacing:'0.05em', animation:'fadeUp 0.4s ease both 0.7s' }}>Redirecting you to the app…</div>
    </div>
  )
}

function ThemeToggle({ isLight, onToggle }) {
  return (
    <div style={{ position:'fixed', top:18, right:20, zIndex:50 }}>
      <div onClick={() => onToggle(!isLight)}
        style={{ width:44, height:24, borderRadius:12, cursor:'pointer', position:'relative', background:isLight?'rgba(201,168,76,0.2)':'rgba(107,30,40,0.5)', border:`1px solid ${isLight?'rgba(107,30,40,0.3)':'rgba(201,168,76,0.3)'}`, display:'flex', alignItems:'center', padding:'0 3px', transition:'all 0.3s' }}>
        <div style={{ width:18, height:18, borderRadius:'50%', background:isLight?'#6b1e28':'#c9a84c', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, transform:isLight?'translateX(20px)':'translateX(0)', transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)', boxShadow:'0 1px 4px rgba(0,0,0,0.35)', pointerEvents:'none' }}>
          {isLight ? '☀️' : '🌙'}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   LOGIN PANEL
───────────────────────────────────────────────────────────── */
function LoginPanel({ onSwitch, onSuccess, isLight }) {
  const [identifier, setIdentifier] = useState('')
  const [password,   setPassword]   = useState('')
  const [remember,   setRemember]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [alert,      setAlert]      = useState({ msg:'', type:'error' })

  // Refs for stale-closure-safe Enter key handler
  const refs = useRef({})
  refs.current = { identifier, password, remember }

  useEffect(() => {
    const saved = getSavedCreds()
    if (saved) { setIdentifier(saved.identifier); setPassword(saved.password); setRemember(true) }
  }, [])

  useEffect(() => {
    const fn = e => { if (e.key === 'Enter') doLogin() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  async function doLogin() {
    const { identifier:id, password:pw, remember:rem } = refs.current
    if (!id || !pw) return setAlert({ msg:'Please fill in all fields', type:'error' })
    setLoading(true); setAlert({ msg:'', type:'error' })
    try {
      const { ok, data } = await apiPost('/auth/login', { identifier:id, password:pw })
      if (!ok) { setAlert({ msg:data.detail || 'Login failed', type:'error' }); return }
      saveSession(data)
      rem ? saveCredentials(id, pw) : clearCredentials()
      onSuccess(data.user?.username || id, false)
    } catch {
      setAlert({ msg:'Could not connect to server. Is the API running?', type:'error' })
    } finally { setLoading(false) }
  }

  // Google credential response arrives here after backend returns tokens
  function handleGoogleSuccess(data) {
    saveSession(data)
    onSuccess(data.user?.username || data.user?.email || 'Reader', data.is_new_user ?? false)
  }

  return (
    <>
      <h1 style={{ fontFamily:'Montserrat Alternates, sans-serif', fontSize:26, fontWeight:600, color:isLight?'#2a1a14':'#f0e8dc', textAlign:'center', letterSpacing:'0.04em', marginTop:14, marginBottom:5 }}>Welcome Back</h1>
      <p style={{ textAlign:'center', fontSize:13, color:isLight?'rgba(60,35,25,0.6)':'rgba(232,221,208,0.65)', fontFamily:'Montaga, serif', marginBottom:20 }}>
        Don't have an account?{' '}
        <span onClick={() => onSwitch('register')} style={{ color:'#c9a84c', cursor:'pointer' }} onMouseEnter={e=>e.target.style.color='#e5c96d'} onMouseLeave={e=>e.target.style.color='#c9a84c'}>Sign up</span>
      </p>

      {/* ── Google button — no hidden iframe hack ── */}
      <GoogleSignInButton
        onCredential={handleGoogleSuccess}
        onError={msg => setAlert({ msg, type:'error' })}
        isLight={isLight}
      />

      <Divider isLight={isLight} />

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <Field icon={IconUser} type="text"     value={identifier} onChange={setIdentifier} placeholder="Username or email" autoComplete="username"         isLight={isLight} />
        <Field icon={IconLock} type="password" value={password}   onChange={setPassword}   placeholder="Password"          autoComplete="current-password" isLight={isLight} />
      </div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8, marginBottom:2 }}>
        <label style={{ display:'flex', alignItems:'center', gap:7, fontFamily:'Montaga, serif', fontSize:12.5, color:isLight?'#2a1a14':'rgba(232,221,208,0.65)', cursor:'pointer', userSelect:'none' }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
            style={{ appearance:'none', WebkitAppearance:'none', width:15, height:15, borderRadius:4, border:'1px solid rgba(201,168,76,0.35)', background:remember?'#6b1e28':'rgba(107,30,40,0.25)', cursor:'pointer', flexShrink:0, transition:'all 0.2s' }} />
          Remember me
        </label>
        <span onClick={() => onSwitch('forgot')} style={{ fontSize:12, color:isLight?'#2a1a14':'rgba(232,221,208,0.6)', fontFamily:'Montaga, serif', cursor:'pointer' }} onMouseEnter={e=>e.target.style.color='#c9a84c'} onMouseLeave={e=>e.target.style.color=isLight?'#2a1a14':'rgba(232,221,208,0.6)'}>
          forgot password?
        </span>
      </div>
      <PrimaryBtn onClick={doLogin} loading={loading}>Login</PrimaryBtn>
      <Alert msg={alert.msg} type={alert.type} />
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   REGISTER PANEL
───────────────────────────────────────────────────────────── */
function RegisterPanel({ onSwitch, onSuccess, isLight }) {
  const [username, setUsername] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [alert,    setAlert]    = useState({ msg:'', type:'error' })

  const refs = useRef({})
  refs.current = { username, email, password }

  useEffect(() => {
    const fn = e => { if (e.key === 'Enter') doRegister() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  async function doRegister() {
    const { username:u, email:em, password:pw } = refs.current
    if (!u || !pw) return setAlert({ msg:'Username and password are required', type:'error' })
    if (pw.length < 8) return setAlert({ msg:'Password must be at least 8 characters', type:'error' })
    setLoading(true); setAlert({ msg:'', type:'error' })
    try {
      const body = { username:u, password:pw }
      if (em) body.email = em
      const { ok, data } = await apiPost('/auth/register', body)
      if (!ok) { setAlert({ msg:data.detail || 'Registration failed', type:'error' }); return }
      saveSession(data)
      onSuccess(data.user?.username || u, true)
    } catch {
      setAlert({ msg:'Could not connect to server. Is the API running?', type:'error' })
    } finally { setLoading(false) }
  }

  function handleGoogleSuccess(data) {
    saveSession(data)
    onSuccess(data.user?.username || data.user?.email || 'Reader', data.is_new_user ?? false)
  }

  return (
    <>
      <h1 style={{ fontFamily:'Montserrat Alternates, sans-serif', fontSize:26, fontWeight:600, color:isLight?'#2a1a14':'#f0e8dc', textAlign:'center', letterSpacing:'0.04em', marginTop:14, marginBottom:5 }}>Create Account</h1>
      <p style={{ textAlign:'center', fontSize:13, color:isLight?'rgba(60,35,25,0.6)':'rgba(232,221,208,0.65)', fontFamily:'Montaga, serif', marginBottom:20 }}>
        Already a member?{' '}
        <span onClick={() => onSwitch('login')} style={{ color:'#c9a84c', cursor:'pointer' }} onMouseEnter={e=>e.target.style.color='#e5c96d'} onMouseLeave={e=>e.target.style.color='#c9a84c'}>Log In</span>
      </p>

      <GoogleSignInButton
        onCredential={handleGoogleSuccess}
        onError={msg => setAlert({ msg, type:'error' })}
        isLight={isLight}
      />

      <Divider isLight={isLight} />

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <Field icon={IconUser} type="text"     value={username} onChange={setUsername} placeholder="Username"               autoComplete="username"     isLight={isLight} />
        <Field icon={IconMail} type="email"    value={email}    onChange={setEmail}    placeholder="Email (optional)"       autoComplete="email"        isLight={isLight} />
        <Field icon={IconLock} type="password" value={password} onChange={setPassword} placeholder="Password (min 8 chars)" autoComplete="new-password" isLight={isLight} />
        <StrengthBar password={password} />
      </div>
      <PrimaryBtn onClick={doRegister} loading={loading} style={{ marginTop:14 }}>Create Account</PrimaryBtn>
      <Alert msg={alert.msg} type={alert.type} />
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   FORGOT PASSWORD PANEL
───────────────────────────────────────────────────────────── */
function ForgotPanel({ onSwitch, onSuccess, isLight }) {
  const [step,    setStep]    = useState(1)
  const [email,   setEmail]   = useState('')
  const [fpEmail, setFpEmail] = useState('')
  const [otp,     setOtp]     = useState('')
  const [newPwd,  setNewPwd]  = useState('')
  const [loading, setLoading] = useState(false)
  const [alert,   setAlert]   = useState({ msg:'', type:'error' })

  async function requestOTP(isResend = false) {
    const addr = isResend ? fpEmail : email
    if (!addr) return setAlert({ msg:'Please enter your email address', type:'error' })
    setLoading(true); setAlert({ msg:'', type:'error' })
    try {
      const { ok, data } = await apiPost('/auth/forgot-password/request', { email:addr })
      if (!ok) { setAlert({ msg:data.detail || 'Something went wrong', type:'error' }); return }
      setFpEmail(addr); setStep(2)
      if (isResend) setAlert({ msg:'✓ New code sent!', type:'success' })
    } catch { setAlert({ msg:'Could not connect to server.', type:'error' }) }
    finally  { setLoading(false) }
  }
  async function verifyOTP() {
    if (otp.length !== 6) return setAlert({ msg:'Please enter the 6-digit code', type:'error' })
    setLoading(true); setAlert({ msg:'', type:'error' })
    try {
      const { ok, data } = await apiPost('/auth/forgot-password/verify', { email:fpEmail, otp })
      if (!ok) { setAlert({ msg:data.detail || 'Invalid code', type:'error' }); return }
      setStep(3); setAlert({ msg:'', type:'error' })
    } catch { setAlert({ msg:'Could not connect to server.', type:'error' }) }
    finally  { setLoading(false) }
  }
  async function resetPassword() {
    if (!newPwd || newPwd.length < 8) return setAlert({ msg:'Password must be at least 8 characters', type:'error' })
    setLoading(true); setAlert({ msg:'', type:'error' })
    try {
      const { ok, data } = await apiPost('/auth/forgot-password/reset', { email:fpEmail, new_password:newPwd })
      if (!ok) { setAlert({ msg:data.detail || 'Reset failed', type:'error' }); return }
      saveSession(data); onSuccess(data.user?.username || '', false)
    } catch { setAlert({ msg:'Could not connect to server.', type:'error' }) }
    finally  { setLoading(false) }
  }

  const tc = isLight ? '#2a1a14' : '#f0e8dc'
  const mc = isLight ? 'rgba(60,35,25,0.6)' : 'rgba(232,221,208,0.65)'
  return (
    <>
      <div onClick={() => onSwitch('login')} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontFamily:'Montaga, serif', color:mc, cursor:'pointer', marginBottom:14, width:'fit-content' }} onMouseEnter={e=>e.currentTarget.style.color='#c9a84c'} onMouseLeave={e=>e.currentTarget.style.color=mc}>
        <IconBack /> Back to login
      </div>
      {step === 1 && <>
        <h1 style={{ fontFamily:'Montserrat Alternates, sans-serif', fontSize:22, fontWeight:600, color:tc, textAlign:'center', marginTop:10, marginBottom:5 }}>Forgot Password</h1>
        <p style={{ textAlign:'center', fontSize:13, color:mc, fontFamily:'Montaga, serif', marginBottom:20 }}>Enter your registered email address</p>
        <Field icon={IconMail} type="email" value={email} onChange={setEmail} placeholder="your@email.com" autoComplete="email" isLight={isLight} />
        <PrimaryBtn onClick={() => requestOTP(false)} loading={loading} style={{ marginTop:14 }}>Send Code</PrimaryBtn>
      </>}
      {step === 2 && <>
        <h1 style={{ fontFamily:'Montserrat Alternates, sans-serif', fontSize:22, fontWeight:600, color:tc, textAlign:'center', marginTop:10, marginBottom:5 }}>Enter Code</h1>
        <p style={{ textAlign:'center', fontSize:13, color:mc, fontFamily:'Montaga, serif', marginBottom:20 }}>We sent a 6-digit code to {fpEmail}</p>
        <div style={{ position:'relative' }}>
          <span style={{ position:'absolute', left:15, top:'50%', transform:'translateY(-50%)', color:'rgba(201,168,76,0.55)', pointerEvents:'none', display:'flex', alignItems:'center' }}><IconLock /></span>
          <input type="text" value={otp} onChange={e=>setOtp(e.target.value)} placeholder="6-digit code" maxLength={6} autoComplete="one-time-code"
            style={{ width:'100%', padding:'13px 44px', background:isLight?'rgba(255,255,255,0.55)':'rgba(107,30,40,0.35)', border:`1px solid ${isLight?'rgba(107,30,40,0.22)':'rgba(201,168,76,0.2)'}`, borderRadius:50, color:tc, fontFamily:'Montaga, serif', fontSize:18, letterSpacing:'0.3em', textAlign:'center', outline:'none', boxSizing:'border-box' }} />
        </div>
        <PrimaryBtn onClick={verifyOTP} loading={loading} style={{ marginTop:14 }}>Verify Code</PrimaryBtn>
        <p style={{ textAlign:'center', marginTop:12, fontSize:12, color:mc, fontFamily:'Montaga, serif' }}>
          Didn't receive it? <span onClick={() => requestOTP(true)} style={{ color:'#c9a84c', cursor:'pointer' }}>Resend</span>
        </p>
      </>}
      {step === 3 && <>
        <h1 style={{ fontFamily:'Montserrat Alternates, sans-serif', fontSize:22, fontWeight:600, color:tc, textAlign:'center', marginTop:10, marginBottom:5 }}>New Password</h1>
        <p style={{ textAlign:'center', fontSize:13, color:mc, fontFamily:'Montaga, serif', marginBottom:20 }}>Choose a strong new password</p>
        <Field icon={IconLock} type="password" value={newPwd} onChange={setNewPwd} placeholder="New password (min 8 chars)" autoComplete="new-password" isLight={isLight} />
        <StrengthBar password={newPwd} />
        <PrimaryBtn onClick={resetPassword} loading={loading} style={{ marginTop:14 }}>Reset Password</PrimaryBtn>
      </>}
      <Alert msg={alert.msg} type={alert.type} />
    </>
  )
}

/* ─────────────────────────────────────────────────────────────
   ROOT AUTH COMPONENT
───────────────────────────────────────────────────────────── */
export default function Auth() {
  const navigate = useNavigate()

  useEffect(() => {
    if (localStorage.getItem('rook_access_token'))
      navigate('/home', { replace:true })
  }, [])

  const [panel,   setPanel]   = useState(() => sessionStorage.getItem('rook_auth_panel') || 'login')
  const [isLight, setIsLight] = useState(() => localStorage.getItem('rook_theme') === 'light')
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark')
    localStorage.setItem('rook_theme', isLight ? 'light' : 'dark')
  }, [isLight])

  useEffect(() => { sessionStorage.removeItem('rook_auth_panel') }, [])

  function handleSuccess(username, isNew) {
    setSuccess({ username, isNew })
    setTimeout(() => navigate('/home', { replace:true }), 3100)
  }

  const cardBg     = isLight ? 'rgba(245,237,228,0.78)' : 'rgba(0,0,0,0.0975)'
  const cardBorder = isLight ? 'rgba(107,30,40,0.25)'   : 'rgba(201,168,76,0.25)'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montaga&family=Montserrat+Alternates:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        @keyframes cardIn  { from { opacity:0; transform:translateY(28px) scale(0.97); } to { opacity:1; transform:none; } }
        @keyframes panelIn { from { opacity:0; transform:translateX(12px); } to { opacity:1; transform:none; } }
        @keyframes alertIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
        @keyframes popIn   { from { transform:scale(0.4); opacity:0; } to { transform:scale(1); opacity:1; } }
        @keyframes fadeUp  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
        @keyframes fillBar { from { width:0; } to { width:100%; } }
        @keyframes spin    { to { transform:rotate(360deg); } }
        input::placeholder { color:${isLight ? 'rgba(60,35,25,0.45)' : 'rgba(232,221,208,0.45)'}; }
      `}</style>

      <div style={{ position:'fixed', inset:0, background:'linear-gradient(135deg,#1a0608 0%,#2a1015 40%,#0e0406 100%)', zIndex:-1 }} />
      <div style={{ position:'fixed', inset:0, backgroundImage:"url('assets/sign_in.png')", backgroundSize:'cover', backgroundPosition:'center', filter:isLight?'brightness(0.9) saturate(0.8)':'brightness(0.55) saturate(0.9)', transform:'scale(1.05)', transition:'filter 0.6s' }} />
      <div style={{ position:'fixed', inset:0, zIndex:2, pointerEvents:'none', background:'radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.75) 100%)' }} />
      <ThemeToggle isLight={isLight} onToggle={setIsLight} />

      <div style={{ position:'relative', zIndex:10, width:'100%', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Montaga, serif' }}>
        <div style={{ width:'100%', maxWidth:440, padding:'44px 44px 40px', margin:'0 16px', background:cardBg, backdropFilter:'blur(58px) saturate(1.4)', WebkitBackdropFilter:'blur(58px) saturate(1.4)', border:`1px solid ${cardBorder}`, borderRadius:24, boxShadow:'0 8px 48px rgba(0,0,0,0.75)', position:'relative', overflow:'hidden', animation:'cardIn 0.55s cubic-bezier(0.22,1,0.36,1) both', transition:'background 0.3s, border-color 0.3s' }}>
          <div style={{ position:'absolute', top:0, left:'10%', right:'10%', height:1, background:'linear-gradient(90deg,transparent,#c9a84c,transparent)', opacity:0.6 }} />
          <div style={{ animation:'panelIn 0.35s ease both' }}>
            {success ? (
              <SuccessPanel username={success.username} isNew={success.isNew} />
            ) : panel === 'login' ? (
              <LoginPanel    onSwitch={setPanel} onSuccess={handleSuccess} isLight={isLight} />
            ) : panel === 'register' ? (
              <RegisterPanel onSwitch={setPanel} onSuccess={handleSuccess} isLight={isLight} />
            ) : (
              <ForgotPanel   onSwitch={setPanel} onSuccess={handleSuccess} isLight={isLight} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}