import { useEffect, useState } from 'react'
import { subscribeToPlayers, subscribeToMeta, setReady, updateRoomStatus } from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { initPresence, startHeartbeat } from '../firebase/presenceService'
import type { Player, RoomMeta } from '../engine/types'

const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

interface Props {
  roomCode: string
  onLeave: () => void
}

export default function WaitingRoomPage({ roomCode, onLeave }: Props) {
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [meta, setMeta] = useState<RoomMeta | null>(null)
  const [myReady, setMyReady] = useState(false)
  const uid = getCurrentUid()

  useEffect(() => {
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubMeta = subscribeToMeta(roomCode, setMeta)
    const stopPresence = initPresence(roomCode)
    const stopHeartbeat = startHeartbeat(roomCode)

    return () => {
      unsubPlayers()
      unsubMeta()
      stopPresence()
      stopHeartbeat()
    }
  }, [roomCode])

  const isHost = meta?.hostId === uid
  const playerList = Object.values(players)
  const allReady = playerList.length >= 2 && playerList.every(p => p.isReady)

  async function toggleReady() {
    const next = !myReady
    setMyReady(next)
    await setReady(roomCode, next)
  }

  async function handleStartGame() {
    await updateRoomStatus(roomCode, 'playing')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">대기실</h2>
            <p className="text-zinc-500 text-xs mt-0.5">친구에게 코드를 알려주세요</p>
          </div>
          <button onClick={onLeave} className="text-zinc-500 hover:text-white text-sm transition-colors">
            나가기
          </button>
        </div>

        {/* 방 코드 */}
        <div className="bg-zinc-900 rounded-2xl p-5 mb-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">방 코드</p>
          <p className="text-4xl font-mono font-bold text-red-400 tracking-widest">{roomCode}</p>
        </div>

        {/* 플레이어 목록 */}
        <div className="bg-zinc-900 rounded-2xl p-5 mb-4">
          <p className="text-xs text-zinc-500 mb-3">
            플레이어 {playerList.length} / {meta?.settings.playerCount ?? '?'}
          </p>
          <div className="space-y-2">
            {playerList.map(player => (
              <div key={player.id} className="flex items-center gap-3 py-2 px-3 bg-zinc-800 rounded-xl">
                <div className={`w-4 h-4 rounded-full ${COLOR_BG[player.color] ?? 'bg-zinc-600'}`} />
                <span className="flex-1 text-sm font-medium text-white">{player.nickname}</span>
                {meta?.hostId === player.id && (
                  <span className="text-xs text-yellow-400">호스트</span>
                )}
                <span className={`text-xs font-medium ${player.isReady ? 'text-green-400' : 'text-zinc-500'}`}>
                  {player.isReady ? '준비 완료' : '대기 중'}
                </span>
              </div>
            ))}
            {/* 빈 슬롯 */}
            {Array.from({ length: Math.max(0, (meta?.settings.playerCount ?? 4) - playerList.length) }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-3 bg-zinc-800/40 rounded-xl border border-dashed border-zinc-700">
                <div className="w-4 h-4 rounded-full bg-zinc-700" />
                <span className="text-sm text-zinc-600">비어있음</span>
              </div>
            ))}
          </div>
        </div>

        {/* 버튼 */}
        <div className="space-y-2">
          {isHost ? (
            <button
              onClick={handleStartGame}
              disabled={!allReady}
              className="w-full bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              {allReady ? '게임 시작' : '모두 준비 완료 시 시작 가능'}
            </button>
          ) : (
            <button
              onClick={toggleReady}
              className={`w-full font-semibold rounded-xl py-3 text-sm transition-colors ${
                myReady
                  ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
            >
              {myReady ? '준비 취소' : '준비 완료'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
