import { useEffect, useState } from 'react'
import { signInAsGuest } from './firebase/auth'
import LobbyPage from './pages/LobbyPage'
import WaitingRoomPage from './pages/WaitingRoomPage'
import GamePage from './pages/GamePage'

export type AppScreen =
  | { screen: 'lobby' }
  | { screen: 'waiting'; roomCode: string }
  | { screen: 'game'; roomCode: string }

export default function App() {
  const [ready, setReady] = useState(false)
  const [current, setCurrent] = useState<AppScreen>({ screen: 'lobby' })

  useEffect(() => {
    signInAsGuest().then(() => setReady(true))
  }, [])

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
        onLeave={() => setCurrent({ screen: 'lobby' })}
      />
    )
  }

  if (current.screen === 'waiting') {
    return (
      <WaitingRoomPage
        roomCode={current.roomCode}
        onLeave={() => setCurrent({ screen: 'lobby' })}
        onGameStart={() => setCurrent({ screen: 'game', roomCode: current.roomCode })}
      />
    )
  }

  return (
    <LobbyPage
      onEnterRoom={(roomCode) => setCurrent({ screen: 'waiting', roomCode })}
    />
  )
}
