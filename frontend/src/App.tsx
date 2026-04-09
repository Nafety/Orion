import { useState, useEffect, useMemo, useCallback } from 'react'
import Scene from './Scene'
import {
  Info, Clock, Users, Globe, ExternalLink, BarChart2, X,
  FilterX, AlertTriangle, ChevronRight, Copy, Check, SlidersHorizontal, LogOut, PanelRightClose, PanelRightOpen
} from 'lucide-react'

// ─── Config ───────────────────────────────────────────────────────────────────
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI

// ─── PKCE helpers ─────────────────────────────────────────────────────────────
function generateRandomString(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map(b => chars[b % chars.length]).join('')
}

async function generateCodeChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function startPKCEFlow(clientId: string) {
  const verifier = generateRandomString(64)
  const challenge = await generateCodeChallenge(verifier)
  localStorage.setItem('pkce_verifier', verifier)
  localStorage.setItem('spotify_client_id', clientId)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'user-top-read user-read-recently-played',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    show_dialog: 'true',
  })
  window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString()
}

async function exchangeCodeForToken(code: string, clientId: string, verifier: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(json.error_description || 'No access token')
  return json.access_token as string
}

// ─── Spotify API helpers ──────────────────────────────────────────────────────
async function spotifyGet(endpoint: string, token: string) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${endpoint}`)
  return res.json()
}

async function buildPayload(token: string) {
  const [topTracksData, topArtistsData, recentData] = await Promise.all([
    spotifyGet('/me/top/tracks?limit=50&time_range=medium_term', token),
    spotifyGet('/me/top/artists?limit=50&time_range=medium_term', token),
    spotifyGet('/me/player/recently-played?limit=50', token),
  ])

  const topTracks = topTracksData.items || []
  const topArtistsRaw = topArtistsData.items || []
  const recentRaw = recentData.items || []

  const topTracksMap: Record<string, string> = {}
  const topTrackIds = new Set<string>()
  for (const t of topTracks) {
    if (t.artists?.[0]?.id) {
      topTracksMap[t.artists[0].id] = t.name
      topTrackIds.add(t.id)
    }
  }

  const uniqueRecent: Record<string, any> = {}
  for (const r of recentRaw) {
    const t = r.track
    if (!t) continue
    if (!uniqueRecent[t.id]) uniqueRecent[t.id] = r
  }
  const recentPlays = Object.values(uniqueRecent)
  const recentArtistIds = recentPlays.map((r: any) => r.track.artists?.[0]?.id)

  const finalArtists = topArtistsRaw.map((artist: any) => ({
    id: artist.id,
    name: artist.name,
    popularity: artist.popularity,
    genres: artist.genres || [],
    image: artist.images?.[0]?.url || null,
    is_recent: recentArtistIds.includes(artist.id),
    top_track: topTracksMap[artist.id] || null,
    type: 'artist',
  }))

  const finalRecent: any[] = []
  const recentPopScores: number[] = []
  for (const r of recentPlays) {
    const t = (r as any).track
    recentPopScores.push(t.popularity)
    finalRecent.push({
      id: t.id,
      track_instance_id: t.id + (r as any).played_at,
      name: t.name,
      popularity: t.popularity,
      image: t.album?.images?.[0]?.url || null,
      is_recent: true,
      top_track: topTrackIds.has(t.id) ? t.name : null,
      type: 'track',
      artist_name: t.artists?.[0]?.name || 'Unknown',
    })
  }

  const topScore = finalArtists.length
    ? finalArtists.reduce((s: number, a: any) => s + a.popularity, 0) / finalArtists.length : 0
  const recentScore = recentPopScores.length
    ? recentPopScores.reduce((s, p) => s + p, 0) / recentPopScores.length : 0
  const uniqueRecentArtists = new Set(finalRecent.map(t => t.artist_name))

  const lastTrack = (recentPlays[0] as any)?.track
  const lastPlayed = lastTrack
    ? `${lastTrack.name} — ${lastTrack.artists?.[0]?.name || 'Unknown'}`
    : '—'

  return {
    top_artists: finalArtists,
    recent_tracks: finalRecent,
    stats: {
      top_mainstream_score: topScore,
      recent_mainstream_score: recentScore,
      total_genres: new Set(finalArtists.flatMap((a: any) => a.genres)).size,
      total_recent_artists: uniqueRecentArtists.size,
      last_played: lastPlayed,
    },
  }
}

// ─── Color helper ─────────────────────────────────────────────────────────────
const getStableColor = (str: string) => {
  if (!str || str === 'Autres' || str === 'Signal Original') return '#4b5563'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash % 360)}, 75%, 65%)`
}

// ─── Setup Modal ──────────────────────────────────────────────────────────────
function SetupModal({ onConnect }: { onConnect: (clientId: string) => void }) {
  const [clientId, setClientId] = useState(() => localStorage.getItem('spotify_client_id') || '')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const handleCopy = () => {
    navigator.clipboard.writeText(REDIRECT_URI)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleConnect = () => {
    const trimmed = clientId.trim()
    if (trimmed.length < 10) { setError('Client ID invalide.'); return }
    setError('')
    onConnect(trimmed)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1,1,3,0.85)', backdropFilter: 'blur(12px)' }}>
      <div style={{ background: '#0a0a0f', border: '0.5px solid rgba(34,211,238,0.25)', borderRadius: '24px', width: '100%', maxWidth: '460px', padding: '2rem', color: 'white', fontFamily: 'var(--font-sans)', boxShadow: '0 0 60px rgba(34,211,238,0.05)', margin: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#1DB954', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 500, letterSpacing: '-0.3px' }}>Spotify Configuration</p>
            <p style={{ margin: 0, fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>ORION · One-time step</p>
          </div>
        </div>

        <div style={{ background: 'rgba(234,179,8,0.07)', border: '0.5px solid rgba(234,179,8,0.3)', borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <AlertTriangle size={14} style={{ color: 'rgb(234,179,8)', flexShrink: 0, marginTop: '2px' }} />
          <p style={{ margin: 0, fontSize: '12px', color: 'rgba(234,179,8,0.85)', lineHeight: 1.6 }}>
            <strong>Why this step?</strong> Spotify blocks unverified apps. Create your own app for free to connect without restrictions.
            <span style={{ display: 'block', marginTop: '4px', color: 'rgba(234,179,8,0.6)', fontSize: '11px' }}>
              No data is stored on any server — everything stays in your browser.
            </span>
          </p>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <Step n={1}>
            Go to{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: '#22d3ee', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              developer.spotify.com/dashboard <ExternalLink size={11} />
            </a>
            {' '}→ <strong style={{ fontWeight: 500 }}>Create app</strong>
          </Step>
          <Step n={2}>
            In <em>Redirect URIs</em>, add exactly:
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '7px 10px' }}>
              <code style={{ fontSize: '11px', color: '#22d3ee', flex: 1, wordBreak: 'break-all' }}>{REDIRECT_URI}</code>
              <button onClick={handleCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#4ade80' : 'rgba(255,255,255,0.4)', padding: '2px', display: 'flex' }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          </Step>
          <Step n={3}>
            Check <strong style={{ fontWeight: 500 }}>Web API</strong> in the APIs, save, then copy the <strong style={{ fontWeight: 500 }}>Client ID</strong>.
          </Step>
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '6px' }}>Client ID</label>
          <input
            value={clientId}
            onChange={e => { setClientId(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleConnect()}
            placeholder="ex : a1b2c3d4e5f6..."
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: `0.5px solid ${error ? 'rgba(239,68,68,0.5)' : 'rgba(34,211,238,0.3)'}`, borderRadius: '10px', padding: '10px 14px', color: 'white', fontSize: '13px', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--font-mono)' }}
          />
          {error && <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'rgb(239,68,68)' }}>{error}</p>}
        </div>

        <button
          onClick={handleConnect}
          style={{ width: '100%', padding: '12px', background: 'transparent', border: '1px solid #22d3ee', borderRadius: '10px', color: '#22d3ee', fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.15em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', transition: 'all 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#22d3ee'; (e.currentTarget as HTMLButtonElement).style.color = '#000' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#22d3ee' }}
        >
          Look at the stars <ChevronRight size={14} />
        </button>

        <p style={{ textAlign: 'center', fontSize: '10px', color: 'rgba(255,255,255,0.18)', margin: '0.75rem 0 0', letterSpacing: '0.05em' }}>
          No data stored · Made with ♥ by Nafety
        </p>
      </div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: '0.6rem', alignItems: 'flex-start' }}>
      <div style={{ width: '20px', height: '20px', borderRadius: '50%', border: '0.5px solid rgba(34,211,238,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
        <span style={{ fontSize: '10px', color: '#22d3ee', fontWeight: 500 }}>{n}</span>
      </div>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.65 }}>{children}</div>
    </div>
  )
}

// ─── Sidebar / Drawer content (shared) ───────────────────────────────────────
function PanelContent({
  activeTab, payload, dynamicLegend, activeFilter, setActiveFilter, currentMainstreamScore, onDisconnect
}: {
  activeTab: 'all' | 'recent'
  payload: any
  dynamicLegend: { label: string; color: string }[]
  activeFilter: string | null
  setActiveFilter: (f: string | null) => void
  currentMainstreamScore: number
  onDisconnect: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>

      {/* Stats block */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '14px', flexShrink: 0 }}>
        <p style={{ margin: '0 0 10px', fontSize: '7.5px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)' }}>Statistics</p>

        {/* Mainstream bar */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', marginBottom: '5px' }}>
            <span>Mainstream Index</span>
            <span style={{ color: '#22d3ee' }}>{Math.round(currentMainstreamScore)}%</span>
          </div>
          <div style={{ width: '100%', height: '2px', background: 'rgba(255,255,255,0.06)', borderRadius: '1px' }}>
            <div style={{ height: '100%', background: '#22d3ee', borderRadius: '1px', transition: 'width 1s ease-out', width: `${currentMainstreamScore}%` }} />
          </div>
        </div>

        {/* Pills */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '9px 10px' }}>
            <p style={{ margin: '0 0 2px', fontSize: '7px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)' }}>
              {activeTab === 'all' ? 'Styles' : 'Artistes'}
            </p>
            <p style={{ margin: 0, fontSize: '24px', fontWeight: 300, color: 'white', lineHeight: 1 }}>
              {activeTab === 'all' ? payload.stats.total_genres : payload.stats.total_recent_artists}
            </p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '9px 10px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '7px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)' }}>Last played</p>
            <p style={{ margin: 0, fontSize: '9px', fontWeight: 700, color: '#22d3ee', lineHeight: 1.4, wordBreak: 'break-word' }}>
              {payload.stats.last_played}
            </p>
          </div>
        </div>
      </div>

      {/* Indicators */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '14px', flexShrink: 0 }}>
        <p style={{ margin: '0 0 8px', fontSize: '7.5px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)' }}>Indicators</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '11px', height: '11px', borderRadius: '50%', border: '1px solid #facc15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <div style={{ width: '3px', height: '3px', background: '#facc15', borderRadius: '50%' }} />
            </div>
            <span style={{ fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b89a0a' }}>Ring : Top Track Hit</span>
          </div>
          {activeTab === 'all' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#22d3ee', flexShrink: 0 }} />
              <span style={{ fontSize: '8px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0e8fa0' }}>Glow : Recent Track</span>
            </div>
          )}
        </div>
      </div>

      {/* Filter list */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.07)',
        borderRadius: '14px',
        padding: '14px',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: '7.5px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)' }}>
            {activeTab === 'all' ? 'Genres' : 'Artistes'}
          </p>
          {activeFilter && (
            <button onClick={() => setActiveFilter(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#22d3ee', display: 'flex', alignItems: 'center', padding: 0 }}>
              <FilterX size={11} />
            </button>
          )}
        </div>
        <div className="scrollable"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1px',
            WebkitOverflowScrolling: 'touch',
          }}>
          {dynamicLegend.map(item => (
            <button
              key={item.label}
              onClick={() => setActiveFilter(activeFilter === item.label ? null : item.label)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                padding: '5px 8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                textAlign: 'left',
                background: activeFilter === item.label ? 'rgba(255,255,255,0.08)' : 'transparent',
              }}
            >
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, backgroundColor: item.color }} />
              <span style={{
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: activeFilter === item.label ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.38)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Disconnect button */}
      <button
        onClick={onDisconnect}
        style={{
          flexShrink: 0,
          width: '100%',
          padding: '8px',
          background: 'transparent',
          border: '0.5px solid rgba(239,68,68,0.25)',
          borderRadius: '10px',
          color: 'rgba(239,68,68,0.4)',
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          transition: 'border-color 0.2s, color 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'rgba(239,68,68,0.6)'
          e.currentTarget.style.color = 'rgba(239,68,68,0.85)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(239,68,68,0.25)'
          e.currentTarget.style.color = 'rgba(239,68,68,0.4)'
        }}
      >
        <LogOut size={10} /> Déconnecter
      </button>

    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
type AppState = 'landing' | 'loading' | 'ready' | 'error'

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing')
  const [payload, setPayload] = useState<any>(null)
  const [loadingMsg, setLoadingMsg] = useState('Mapping Neural Network...')
  const [activeTab, setActiveTab] = useState<'all' | 'recent'>('all')
  const [selectedNode, setSelectedNode] = useState<any>(null)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // ── Sidebar collapsed state (desktop only) ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const savedToken = sessionStorage.getItem('spotify_access_token')
    if (savedToken) {
      setAppState('loading')
      setLoadingMsg('Restoring session...')
      buildPayload(savedToken)
        .then(data => { setPayload(data); setAppState('ready') })
        .catch(() => {
          sessionStorage.removeItem('spotify_access_token')
          setAppState('landing')
        })
      return
    }

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')

    if (code || errorParam) {
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    if (errorParam) { setErrorMsg(`Spotify rejected the connection: ${errorParam}`); setAppState('error'); return }
    if (!code) return

    const verifier = localStorage.getItem('pkce_verifier')
    const clientId = localStorage.getItem('spotify_client_id')
    if (!verifier || !clientId) { setErrorMsg('Session expired. Please try again.'); setAppState('error'); return }

    localStorage.removeItem('pkce_verifier')
    setAppState('loading')

    const run = async () => {
      try {
        setLoadingMsg("Exchanging authorization code...")
        const accessToken = await exchangeCodeForToken(code, clientId, verifier)
        sessionStorage.setItem('spotify_access_token', accessToken)
        setLoadingMsg('Mapping Neural Network...')
        const data = await buildPayload(accessToken)
        setPayload(data)
        setAppState('ready')
      } catch (err: any) {
        console.error(err)
        setErrorMsg(err?.message || 'Erreur inconnue')
        setAppState('error')
      }
    }
    run()
  }, [])

  const handleConnect = useCallback(async (clientId: string) => {
    setShowSetup(false)
    await startPKCEFlow(clientId)
  }, [])

  const handleDisconnect = useCallback(() => {
    sessionStorage.removeItem('spotify_access_token')
    setPayload(null)
    setSelectedNode(null)
    setActiveFilter(null)
    setActiveTab('all')
    setDrawerOpen(false)
    setAppState('landing')
  }, [])

  const handleTabChange = (tab: 'all' | 'recent') => {
    setSelectedNode(null); setActiveFilter(null); setActiveTab(tab)
  }

  const displayData = useMemo(() => {
    if (!payload) return []
    return activeTab === 'all' ? payload.top_artists : payload.recent_tracks
  }, [payload, activeTab])

  const dynamicLegend = useMemo(() => {
    if (!payload) return []
    const source = activeTab === 'all'
      ? payload.top_artists.flatMap((a: any) => (a.genres?.length > 0) ? a.genres : ['Original Signal'])
      : payload.recent_tracks.map((t: any) => t.artist_name)
    const unique = Array.from(new Set(source)) as string[]
    return unique.sort().map(name => ({ label: name, color: getStableColor(name) }))
  }, [payload, activeTab])

  // ── Landing ──
  if (appState === 'landing') return (
    <>
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#010103] text-white font-sans">
        <Globe size={48} className="text-cyan-500 mb-6" />
        <h1 className="text-6xl sm:text-8xl font-black italic tracking-tighter uppercase leading-none text-center px-4">
          ORION<span className="text-cyan-500">.</span>
        </h1>
        <p className="text-white/30 text-xs tracking-widest uppercase mt-3 mb-8">Your musical universe in 3D</p>
        <button
          onClick={() => setShowSetup(true)}
          className="px-8 sm:px-12 py-4 border border-cyan-500 text-cyan-500 uppercase font-bold hover:bg-cyan-500 hover:text-black transition-all shadow-[0_0_30px_rgba(34,211,238,0.2)] text-sm"
        >
          Look at the stars
        </button>
      </div>
      {showSetup && <SetupModal onConnect={handleConnect} />}
    </>
  )

  // ── Error ──
  if (appState === 'error') return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[#010103] text-white font-sans gap-4 p-8 text-center">
      <p className="text-red-400 text-sm font-mono">{errorMsg}</p>
      <button onClick={() => { setAppState('landing'); setErrorMsg('') }} className="px-8 py-3 border border-cyan-500 text-cyan-500 uppercase font-bold hover:bg-cyan-500 hover:text-black transition-all text-xs">Retry</button>
    </div>
  )

  // ── Loading ──
  if (appState === 'loading' || !payload) return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[#010103] text-cyan-500 font-mono gap-3">
      <div className="text-xs tracking-[0.5em] uppercase animate-pulse">{loadingMsg}</div>
      <div className="w-48 h-[1px] bg-white/5 overflow-hidden relative">
        <div className="absolute inset-y-0 bg-cyan-500" style={{ width: '40%', animation: 'scanline 1.5s ease-in-out infinite' }} />
      </div>
      <style>{`@keyframes scanline { 0%{left:-40%} 100%{left:140%} }`}</style>
    </div>
  )

  // ── Ready ──
  const cleanId = selectedNode?.id?.match(/[a-zA-Z0-9]{22}/)?.[0] || selectedNode?.id
  const currentMainstreamScore = activeTab === 'all' ? payload.stats.top_mainstream_score : payload.stats.recent_mainstream_score

  return (
    <div className="h-full w-full bg-[#010103] text-white font-sans overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* ══════════════════════════════════════════════════════════════
          DESKTOP (lg+) — horizontal split: scene | right sidebar
         ══════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex h-full w-full">

        {/* Scene area */}
        <div className="relative flex-1 min-w-0">
          <Scene data={displayData} viewType={activeTab} onNodeSelect={setSelectedNode} selectedNode={selectedNode} activeFilter={activeFilter} />

          {/* Tab switcher */}
          <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-2 p-1 bg-black/40 backdrop-blur-3xl rounded-full border border-white/10 z-50">
            <button onClick={() => handleTabChange('all')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${activeTab === 'all' ? 'bg-cyan-500 text-black shadow-[0_0_20px_#22d3ee]' : 'text-white/50 hover:text-white'}`}>
              <Users size={14} className="inline mr-2" /> Top Artists
            </button>
            <button onClick={() => handleTabChange('recent')} className={`px-6 py-2 rounded-full text-[10px] font-bold uppercase transition-all ${activeTab === 'recent' ? 'bg-cyan-500 text-black shadow-[0_0_20px_#22d3ee]' : 'text-white/50 hover:text-white'}`}>
              <Clock size={14} className="inline mr-2" /> Recent
            </button>
          </div>

          {/* Wordmark */}
          <div className="absolute bottom-8 left-8 text-white italic font-black text-6xl pointer-events-none uppercase tracking-tighter opacity-80 z-10">
            ORION<span className="text-cyan-500">.</span>
          </div>

          {/* ── Node detail panel — FIXED: no scroll, compact layout ── */}
          {selectedNode && (
            <div
              key={`${activeTab}-${selectedNode.id}`}
              style={{
                position: 'absolute',
                left: '32px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '272px',
                background: 'rgba(0,0,0,0.88)',
                backdropFilter: 'blur(24px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '2rem',
                padding: '20px',
                zIndex: 100,
                boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                animation: 'slideInLeft 0.4s ease-out',
                // No overflow, no maxHeight — fits naturally
              }}
            >
              {/* Close */}
              <button
                onClick={() => setSelectedNode(null)}
                style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={16} />
              </button>

              {/* Image — square, fixed size */}
              <div style={{ width: '100%', aspectRatio: '1', borderRadius: '1.25rem', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0, position: 'relative' }}>
                <img src={selectedNode.image} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }} />
              </div>

              {/* Spotify embed — fixed height, no scrollbar */}
              <div style={{ borderRadius: '12px', overflow: 'hidden', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, height: '80px' }}>
                <iframe
                  title="Spotify Player"
                  src={`https://open.spotify.com/embed/${selectedNode.type}/${cleanId}?utm_source=generator&theme=0`}
                  width="100%"
                  height="80"
                  frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  style={{ display: 'block', border: 'none' }}
                  scrolling="no"
                />
              </div>

              {/* Name & genre */}
              <div style={{ flexShrink: 0 }}>
                {activeTab === 'recent' && selectedNode.top_track && (
                  <div style={{ marginBottom: '6px', display: 'inline-block', padding: '2px 10px', background: '#facc15', color: '#000', fontSize: '8px', fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '0.05em', borderRadius: '999px' }}>
                    ★ Top Track Hit
                  </div>
                )}
                <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.04em', textTransform: 'uppercase', lineHeight: 1.1, wordBreak: 'break-word' }}>
                  {selectedNode.name}
                </h2>
                <p style={{ margin: 0, fontSize: '9px', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(34,211,238,0.7)' }}>
                  {activeTab === 'all' ? (selectedNode.genres?.[0] || 'Signal Original') : (selectedNode.artist_name || 'Unknown Artist')}
                </p>
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', fontWeight: 900, fontSize: '7px', letterSpacing: '0.12em' }}>
                    <BarChart2 size={11} /> Pop.
                  </div>
                  <div style={{ fontSize: '18px', fontFamily: 'var(--font-mono)', color: 'white' }}>{selectedNode.popularity}%</div>
                </div>
                {activeTab === 'all' && selectedNode.top_track && (
                  <div style={{ flex: 1, padding: '10px 12px', background: 'rgba(250,204,21,0.08)', borderRadius: '12px', border: '1px solid rgba(250,204,21,0.18)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#eab308', textTransform: 'uppercase', fontWeight: 900, fontSize: '7px', letterSpacing: '0.12em', marginBottom: '4px' }}>
                      <Info size={10} /> Top Track
                    </div>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: 'white', textTransform: 'uppercase', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedNode.top_track}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right sidebar with collapse toggle ── */}
        <div style={{
          width: sidebarCollapsed ? '0px' : '256px',
          flexShrink: 0,
          background: 'rgba(3,3,10,0.96)',
          borderLeft: '0.5px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
          position: 'relative',
        }}>
          {/* Inner wrapper preserves layout during collapse animation */}
          <div style={{ width: '256px', padding: '20px 14px', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', opacity: sidebarCollapsed ? 0 : 1, transition: 'opacity 0.2s', pointerEvents: sidebarCollapsed ? 'none' : 'auto' }}>
            <PanelContent
              activeTab={activeTab} payload={payload} dynamicLegend={dynamicLegend}
              activeFilter={activeFilter} setActiveFilter={setActiveFilter}
              currentMainstreamScore={currentMainstreamScore}
              onDisconnect={handleDisconnect}
            />
          </div>
        </div>

        {/* ── Sidebar toggle button — floats on the edge ── */}
        <button
          onClick={() => setSidebarCollapsed(c => !c)}
          title={sidebarCollapsed ? 'Open panel' : 'Close panel'}
          style={{
            position: 'absolute',
            right: sidebarCollapsed ? '8px' : 'calc(256px + 8px)',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 60,
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: 'rgba(3,3,10,0.96)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'right 0.3s cubic-bezier(0.4,0,0.2,1), color 0.2s, border-color 0.2s',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#22d3ee'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.4)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)' }}
        >
          {sidebarCollapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MOBILE (< lg) — full-screen scene + bottom bar + drawer
         ══════════════════════════════════════════════════════════════ */}
      <div className="flex lg:hidden h-full w-full flex-col relative">

        {/* Scene — fills everything */}
        <div className="absolute inset-0">
          <Scene data={displayData} viewType={activeTab} onNodeSelect={setSelectedNode} selectedNode={selectedNode} activeFilter={activeFilter} />
        </div>

        {/* Tab switcher — top center */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-1.5 p-1 bg-black/55 backdrop-blur-xl rounded-full border border-white/10 z-50">
          <button onClick={() => handleTabChange('all')} className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase transition-all ${activeTab === 'all' ? 'bg-cyan-500 text-black' : 'text-white/50'}`}>
            <Users size={11} className="inline mr-1" /> Artists
          </button>
          <button onClick={() => handleTabChange('recent')} className={`px-4 py-1.5 rounded-full text-[9px] font-bold uppercase transition-all ${activeTab === 'recent' ? 'bg-cyan-500 text-black' : 'text-white/50'}`}>
            <Clock size={11} className="inline mr-1" /> Recent
          </button>
        </div>

        {/* Wordmark — above bottom bar */}
        <div className="absolute bottom-[60px] left-4 text-white italic font-black text-2xl pointer-events-none uppercase tracking-tighter opacity-50 z-10">
          ORION<span className="text-cyan-500">.</span>
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 z-40 bg-[#08080f]/90 backdrop-blur-xl border-t border-white/8 flex items-center justify-between px-4 py-2.5" style={{ minHeight: '52px' }}>
          <div className="flex flex-col min-w-0 flex-1 pr-3">
            <span className="text-[6.5px] uppercase tracking-widest text-white/25 font-black mb-0.5">Last played</span>
            <span className="text-[9px] font-bold text-cyan-400 truncate leading-tight">{payload.stats.last_played}</span>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-[8px] font-bold uppercase text-white/50 hover:text-white transition-all shrink-0"
          >
            <SlidersHorizontal size={11} />
            {activeFilter && <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shrink-0" />}
            Filtres
          </button>
        </div>

        {/* Mobile node detail — bottom sheet */}
        {selectedNode && (
          <>
            <div className="absolute inset-0 z-[100] bg-black/40" onClick={() => setSelectedNode(null)} />
            <div
              style={{
                position: 'absolute',
                insetInline: 0,
                bottom: 0,
                zIndex: 110,
                background: 'rgba(12,12,22,0.97)',
                backdropFilter: 'blur(24px)',
                borderTop: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '2rem 2rem 0 0',
                padding: '16px',
                animation: 'slideUp 0.3s ease-out',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                // Fixed max height, no internal scroll
                maxHeight: '75vh',
                overflow: 'hidden',
              }}
            >
              <div style={{ width: '32px', height: '3px', background: 'rgba(255,255,255,0.15)', borderRadius: '999px', margin: '0 auto 2px', flexShrink: 0 }} />

              {/* Header row: image + info + close */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexShrink: 0 }}>
                <img src={selectedNode.image} style={{ width: '56px', height: '56px', borderRadius: '12px', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }} alt="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {activeTab === 'recent' && selectedNode.top_track && (
                    <div style={{ marginBottom: '4px', display: 'inline-block', padding: '1px 8px', background: '#facc15', color: '#000', fontSize: '7px', fontWeight: 900, fontStyle: 'italic', textTransform: 'uppercase', borderRadius: '999px' }}>★ Hit</div>
                  )}
                  <h2 style={{ margin: '0 0 2px', fontSize: '15px', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.03em', textTransform: 'uppercase', lineHeight: 1.1 }}>
                    {selectedNode.name}
                  </h2>
                  <p style={{ margin: 0, fontSize: '9px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(34,211,238,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeTab === 'all' ? (selectedNode.genres?.[0] || 'Signal Original') : (selectedNode.artist_name || 'Unknown')}
                  </p>
                </div>
                <button onClick={() => setSelectedNode(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  <X size={16} />
                </button>
              </div>

              {/* Spotify embed — fixed height, no scroll */}
              <div style={{ borderRadius: '12px', overflow: 'hidden', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, height: '80px' }}>
                <iframe
                  title="Spotify Player"
                  src={`https://open.spotify.com/embed/${selectedNode.type}/${cleanId}?utm_source=generator&theme=0`}
                  width="100%"
                  height="80"
                  frameBorder="0"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  style={{ display: 'block', border: 'none' }}
                  scrolling="no"
                />
              </div>

              {/* Stats row */}
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', fontWeight: 900, fontSize: '7px', letterSpacing: '0.1em' }}>
                    <BarChart2 size={10} /> Pop.
                  </div>
                  <div style={{ fontSize: '16px', fontFamily: 'var(--font-mono)', color: 'white' }}>{selectedNode.popularity}%</div>
                </div>
                {activeTab === 'all' && selectedNode.top_track && (
                  <div style={{ flex: 1, padding: '10px 12px', background: 'rgba(250,204,21,0.08)', borderRadius: '12px', border: '1px solid rgba(250,204,21,0.18)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#eab308', textTransform: 'uppercase', fontWeight: 900, fontSize: '7px', letterSpacing: '0.1em', marginBottom: '3px' }}>
                      <Info size={10} /> Top Track
                    </div>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: 'white', textTransform: 'uppercase', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedNode.top_track}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Mobile drawer — stats + filters */}
        {drawerOpen && (
          <>
            <div className="absolute inset-0 z-[120] bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <div
              className="absolute inset-x-0 bottom-0 z-[130] bg-[#0c0c16] border-t border-white/10 rounded-t-[2rem] p-5 flex flex-col"
              style={{
                maxHeight: '82vh',
                height: '82vh',
                animation: 'slideUp 0.3s ease-out',
                overflow: 'hidden'
              }}
            >
              <div className="w-8 h-0.5 bg-white/15 rounded-full mx-auto mb-4 shrink-0" />
              <div className="flex items-center justify-between mb-4 shrink-0">
                <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Stats & Filtres</span>
                <button onClick={() => setDrawerOpen(false)} className="text-white/30 hover:text-white"><X size={16} /></button>
              </div>
              <div
                className="flex-1 min-h-0"
                style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
              >
                <PanelContent
                  activeTab={activeTab} payload={payload} dynamicLegend={dynamicLegend}
                  activeFilter={activeFilter}
                  setActiveFilter={f => { setActiveFilter(f); setDrawerOpen(false) }}
                  currentMainstreamScore={currentMainstreamScore}
                  onDisconnect={handleDisconnect}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes slideInLeft {
          from { opacity:0; transform:translate(-20px,-50%); }
          to   { opacity:1; transform:translate(0,-50%); }
        }
        @keyframes slideUp {
          from { opacity:0; transform:translateY(30px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>
    </div>
  )
}