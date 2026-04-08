import { useEffect, useState } from 'react'
import RulesModal from '../components/RulesModal'
import {
  subscribeToPlayers, subscribeToMeta, setReady, changePlayerColor,
  deleteRoom, updateRoomSettings, subscribeToSpectators, leaveSpectator,
  switchToPlayer, switchToSpectator,
} from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { initPresence, startHeartbeat } from '../firebase/presenceService'
import { startGame } from '../firebase/hostService'
import type { Player, PlayerColor, RoomMeta, Spectator } from '../engine/types'

const COLOR_INFO: { value: PlayerColor; label: string; bg: string }[] = [
  { value: 'red',    label: '빨강', bg: 'bg-red-500' },
  { value: 'blue',   label: '파랑', bg: 'bg-blue-500' },
  { value: 'green',  label: '초록', bg: 'bg-green-500' },
  { value: 'yellow', label: '노랑', bg: 'bg-yellow-400' },
  { value: 'purple', label: '보라', bg: 'bg-purple-500' },
  { value: 'orange', label: '주황', bg: 'bg-orange-500' },
]

const COLOR_BG: Record<string, string> = Object.fromEntries(
  COLOR_INFO.map(c => [c.value, c.bg])
)

interface Props {
  roomCode: string
  onLeave: () => void
  onGameStart: () => void
}

export default function WaitingRoomPage({ roomCode, onLeave, onGameStart }: Props) {
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [spectators, setSpectators] = useState<Record<string, Spectator>>({})
  const [meta, setMeta] = useState<RoomMeta | null>(null)
  const [myReady, setMyReady] = useState(false)
  const [startError, setStartError] = useState('')
  const [starting, setStarting] = useState(false)
  const [switchLoading, setSwitchLoading] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [showRules, setShowRules] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const uid = getCurrentUid()

  useEffect(() => {
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubSpectators = subscribeToSpectators(roomCode, setSpectators)
    const unsubMeta = subscribeToMeta(roomCode, (m) => {
      setMeta(m)
      if (m?.status === 'playing') onGameStart()
    })

    return () => {
      unsubPlayers()
      unsubSpectators()
      unsubMeta()
    }
  }, [roomCode])

  // 플레이어일 때만 presence 유지
  useEffect(() => {
    if (!uid || !players[uid]) return
    const stopPresence = initPresence(roomCode)
    const stopHeartbeat = startHeartbeat(roomCode)
    return () => { stopPresence(); stopHeartbeat() }
  }, [roomCode, uid, uid ? !!players[uid] : false])

  const isHost = meta?.hostId === uid
  const playerList = Object.values(players)
  const spectatorList = Object.values(spectators)
  const myPlayer = uid ? players[uid] : undefined
  const amISpectator = !!uid && !players[uid] && !!spectators[uid]
  const usedColors = playerList.map(p => p.color)
  const isTestMode = meta?.settings.isTestMode ?? false
  const minPlayers = isTestMode ? 2 : 3
  const allReady = playerList.length >= minPlayers && playerList.every(p => p.isReady || p.id === meta?.hostId)

  async function handleColorChange(color: PlayerColor) {
    try { await changePlayerColor(roomCode, color) } catch {}
  }

  async function toggleReady() {
    const next = !myReady
    setMyReady(next)
    await setReady(roomCode, next)
  }

  async function handleStartGame(forceStart = false) {
    if (!meta || starting) return
    if (!forceStart && !allReady) return
    const currentPlayers = Object.keys(players).length > 0 ? players : undefined
    if (!currentPlayers) { setStartError('플레이어 정보 로딩 중입니다.'); return }
    setStarting(true); setStartError('')
    try {
      await startGame(roomCode, currentPlayers, meta.settings)
    } catch (e: any) {
      setStartError(e?.message ?? '게임 시작 실패')
      setStarting(false)
    }
  }

  async function handleSwitch() {
    setSwitchLoading(true); setSwitchError('')
    try {
      if (amISpectator) {
        await switchToPlayer(roomCode)
      } else {
        await switchToSpectator(roomCode)
        setMyReady(false)
      }
    } catch (e: any) {
      setSwitchError(e?.message ?? '전환 실패')
    } finally {
      setSwitchLoading(false)
    }
  }

  async function handleLeave() {
    if (isHost) await deleteRoom(roomCode)
    else if (amISpectator) await leaveSpectator(roomCode)
    onLeave()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">
              대기실
              {amISpectator && <span className="ml-2 text-sm font-normal text-zinc-400">👁 관전 중</span>}
            </h2>
            <p className="text-zinc-500 text-xs mt-0.5">친구에게 코드를 알려주세요</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowRules(true)} className="text-zinc-500 hover:text-white text-sm transition-colors">📖</button>
            <button onClick={handleLeave} className="text-zinc-500 hover:text-white text-sm transition-colors">나가기</button>
          </div>
        </div>

        {/* 방 코드 */}
        <div className="bg-zinc-900 rounded-2xl p-5 mb-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">방 코드 <span className="text-zinc-700">· 눌러서 복사</span></p>
          <p
            onClick={() => {
              navigator.clipboard.writeText(roomCode)
              setCodeCopied(true)
              setTimeout(() => setCodeCopied(false), 2000)
            }}
            className={`text-4xl font-mono font-bold tracking-widest cursor-pointer transition-colors select-all ${codeCopied ? 'text-green-400' : 'text-red-400 hover:text-red-300'}`}
          >
            {codeCopied ? '복사됨!' : roomCode}
          </p>
          {isTestMode && <p className="text-xs text-yellow-600 mt-2">⚠ 테스트 모드 — 2인 시작 가능</p>}
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
                {meta?.hostId === player.id && <span className="text-xs text-yellow-400">호스트</span>}
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

          {/* 관전자 목록 */}
          {spectatorList.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-600 mb-2">👁 관전자 {spectatorList.length}명</p>
              <div className="space-y-1">
                {spectatorList.map(spec => (
                  <div key={spec.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg">
                    <span className="text-zinc-500 text-sm">{spec.nickname}</span>
                    {spec.id === uid && <span className="text-xs text-zinc-600">(나)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 색상 선택 (플레이어만) */}
        {!amISpectator && (
          <div className="bg-zinc-900 rounded-2xl p-5 mb-4">
            <p className="text-xs text-zinc-500 mb-3">내 색상</p>
            <div className="flex gap-2">
              {COLOR_INFO.map(c => {
                const isUsedByOther = usedColors.includes(c.value) && myPlayer?.color !== c.value
                const isMine = myPlayer?.color === c.value
                return (
                  <button
                    key={c.value}
                    onClick={() => !isUsedByOther && handleColorChange(c.value)}
                    title={c.label}
                    disabled={isUsedByOther}
                    className={`w-9 h-9 rounded-full ${c.bg} transition-all ${
                      isMine
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110'
                        : isUsedByOther
                        ? 'opacity-20 cursor-not-allowed'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* 게임 설정 (호스트만) */}
        {isHost && (
          <div className="bg-zinc-900 rounded-2xl p-5 mb-4">
            <p className="text-xs text-zinc-500 mb-3">게임 설정</p>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-400 mb-1.5">이동 선택 시간 <span className="text-zinc-500">({meta?.settings.sealTime ?? 60}초)</span></p>
                <div className="flex gap-1.5">
                  {[30, 60, 90, 120].map(sec => (
                    <button key={sec} onClick={() => updateRoomSettings(roomCode, { sealTime: sec })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${(meta?.settings.sealTime ?? 60) === sec ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                      {sec}초
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-zinc-400 mb-1.5">투표 시간 <span className="text-zinc-500">({meta?.settings.votingTime ?? 60}초)</span></p>
                <div className="flex gap-1.5">
                  {[30, 60, 90, 120].map(sec => (
                    <button key={sec} onClick={() => updateRoomSettings(roomCode, { votingTime: sec })}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${(meta?.settings.votingTime ?? 60) === sec ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                      {sec}초
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 관전/플레이 전환 */}
        <div className="mb-2">
          {switchError && <p className="text-red-400 text-xs text-center mb-1">{switchError}</p>}
          <button
            onClick={handleSwitch}
            disabled={switchLoading}
            className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-400 hover:text-zinc-200 font-medium rounded-xl py-2 text-xs transition-colors border border-zinc-700">
            {switchLoading ? '전환 중...' : amISpectator ? '👤 플레이어로 전환' : '👁 관전자로 전환'}
          </button>
        </div>

        {/* 준비/시작 버튼 */}
        <div className="space-y-2">
          {startError && <p className="text-red-400 text-xs text-center">{startError}</p>}
          {amISpectator ? (
            <p className="text-zinc-600 text-xs text-center py-2">게임 시작을 기다리는 중...</p>
          ) : isHost ? (
            <div className="space-y-2">
              <button
                onClick={() => handleStartGame(false)}
                disabled={!allReady || starting}
                className="w-full bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold rounded-xl py-3 text-sm transition-colors">
                {starting ? '게임 시작 중...' : allReady ? '게임 시작' : playerList.length < 2 ? '2명 이상 필요' : '모두 준비 완료 시 시작 가능'}
              </button>
              <button
                onClick={() => handleStartGame(true)}
                disabled={starting}
                className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 font-medium rounded-xl py-2 text-xs transition-colors border border-zinc-600">
                🧪 테스트 시작 (준비 없이)
              </button>
            </div>
          ) : (
            <button
              onClick={toggleReady}
              className={`w-full font-semibold rounded-xl py-3 text-sm transition-colors ${myReady ? 'bg-zinc-700 hover:bg-zinc-600 text-white' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
              {myReady ? '준비 취소' : '준비 완료'}
            </button>
          )}
        </div>
      </div>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
