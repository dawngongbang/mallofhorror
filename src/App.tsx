import { useEffect, useState } from 'react'
import { signInAsGuest } from './firebase/auth'
import LobbyPage from './pages/LobbyPage'
import WaitingRoomPage from './pages/WaitingRoomPage'
import GamePage from './pages/GamePage'

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
      <GamePage
        roomCode={current.roomCode}
        onLeave={() => go({ screen: 'lobby' })}
      />
    )
  }

  if (current.screen === 'waiting') {
    return (
      <WaitingRoomPage
        roomCode={current.roomCode}
        onLeave={() => go({ screen: 'lobby' })}
        onGameStart={() => go({ screen: 'game', roomCode: current.roomCode })}
      />
    )
  }

  return (
    <LobbyPage
      onEnterRoom={(roomCode) => go({ screen: 'waiting', roomCode })}
    />
  )
}
