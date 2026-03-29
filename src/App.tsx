import { useEffect, useRef, useState } from 'react'
import { signInAsGuest } from './firebase/auth'
import LobbyPage from './pages/LobbyPage'
import WaitingRoomPage from './pages/WaitingRoomPage'
import GamePage from './pages/GamePage'

// ── 화면 에러 오버레이 ───────────────────────────────────────────
type ErrEntry = { id: number; msg: string; time: string }
let _errSeq = 0

function ErrorOverlay() {
  const [errors, setErrors] = useState<ErrEntry[]>([])
  const origRef = useRef<typeof console.error | null>(null)

  useEffect(() => {
    origRef.current = console.error
    // eslint-disable-next-line no-console
    console.error = (...args: unknown[]) => {
      origRef.current?.(...args)
      const msg = args.map(a =>
        typeof a === 'string' ? a
        : a instanceof Error ? `${a.name}: ${a.message}`
        : JSON.stringify(a)
      ).join(' ')
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setErrors(prev => [...prev.slice(-9), { id: ++_errSeq, msg, time }])
    }

    const onUnhandled = (e: PromiseRejectionEvent) => {
      console.error('[unhandledRejection]', e.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)

    return () => {
      // eslint-disable-next-line no-console
      console.error = origRef.current!
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [])

  if (errors.length === 0) return null

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, maxHeight: '40vh', overflowY: 'auto', background: 'rgba(20,0,0,0.92)', borderTop: '1px solid #7f1d1d', padding: '6px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>🐛 콘솔 에러 ({errors.length})</span>
        <button onClick={() => setErrors([])} style={{ color: '#9ca3af', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer' }}>전체 지우기</button>
      </div>
      {errors.map(e => (
        <div key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3 }}>
          <span style={{ color: '#6b7280', fontSize: 10, flexShrink: 0, marginTop: 1 }}>{e.time}</span>
          <span style={{ color: '#fca5a5', fontSize: 11, wordBreak: 'break-all', flex: 1 }}>{e.msg}</span>
          <button onClick={() => setErrors(prev => prev.filter(x => x.id !== e.id))} style={{ color: '#6b7280', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>
      ))}
    </div>
  )
}

export type AppScreen =
  | { screen: 'lobby' }
  | { screen: 'waiting'; roomCode: string }
  | { screen: 'game'; roomCode: string }

const SESSION_KEY = 'moh_session'

function saveSession(screen: AppScreen) {
  if (screen.screen === 'lobby') {
    sessionStorage.removeItem(SESSION_KEY)
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(screen))
  }
}

function restoreSession(): AppScreen {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) return JSON.parse(raw) as AppScreen
  } catch {}
  return { screen: 'lobby' }
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [current, setCurrent] = useState<AppScreen>(restoreSession)

  useEffect(() => {
    signInAsGuest().then(() => setReady(true))
  }, [])

  // 뒤로가기 방지 — 게임/대기실 중에는 history state 유지
  useEffect(() => {
    if (current.screen === 'lobby') return
    // 현재 상태를 history에 push해서 back 버튼 감지
    history.pushState({ moh: current }, '')
    const onPop = (e: PopStateEvent) => {
      if (e.state?.moh) {
        // 앱 내 상태로 복원 (실제 URL 이동 없음)
        history.pushState({ moh: current }, '')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [current])

  // 탭 닫기/새로고침 경고 (게임 중)
  useEffect(() => {
    if (current.screen !== 'game') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [current.screen])

  function go(screen: AppScreen) {
    saveSession(screen)
    setCurrent(screen)
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400 text-sm">연결 중...</p>
      </div>
    )
  }

  if (current.screen === 'game') {
    return (
      <>
        <GamePage roomCode={current.roomCode} onLeave={() => go({ screen: 'lobby' })} />
        <ErrorOverlay />
      </>
    )
  }

  if (current.screen === 'waiting') {
    return (
      <>
        <WaitingRoomPage
          roomCode={current.roomCode}
          onLeave={() => go({ screen: 'lobby' })}
          onGameStart={() => go({ screen: 'game', roomCode: current.roomCode })}
        />
        <ErrorOverlay />
      </>
    )
  }

  return (
    <>
      <LobbyPage onEnterRoom={(roomCode) => go({ screen: 'waiting', roomCode })} />
      <ErrorOverlay />
    </>
  )
}
