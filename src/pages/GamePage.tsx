import { useEffect, useState } from 'react'
import { subscribeToGame } from '../firebase/gameService'
import { subscribeToPlayers, subscribeToMeta } from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { hostRollDice } from '../firebase/hostService'
import { patchGameState } from '../firebase/gameService'
import { rollAndGetPlacementOptions, placeCharacter, startFirstRound } from '../engine/setup'
import type { GameState, Player, RoomMeta, ZoneName } from '../engine/types'
import { ZONE_CONFIGS, CHARACTER_CONFIGS } from '../engine/constants'

const ZONE_ORDER: ZoneName[] = ['bathroom', 'clothing', 'toy', 'parking', 'security', 'supermarket']

const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

const PHASE_LABEL: Partial<Record<string, string>> = {
  setup_place: '초기 배치',
  roll_dice: '주사위 굴리기',
  character_select: '캐릭터 선언',
  destination_seal: '목적지 선택',
  destination_reveal: '목적지 공개',
  move_execute: '이동 처리',
  event: '이벤트',
  voting: '투표',
  check_win: '승리 조건 확인',
  finished: '게임 종료',
}

interface Props {
  roomCode: string
  onLeave: () => void
}

export default function GamePage({ roomCode, onLeave }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [meta, setMeta] = useState<RoomMeta | null>(null)
  const [placementOptions, setPlacementOptions] = useState<ZoneName[]>([])
  const [actionLoading, setActionLoading] = useState(false)

  const uid = getCurrentUid()

  useEffect(() => {
    const unsubGame = subscribeToGame(roomCode, setGame)
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubMeta = subscribeToMeta(roomCode, setMeta)
    return () => { unsubGame(); unsubPlayers(); unsubMeta() }
  }, [roomCode])

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400 text-sm">게임 로딩 중...</p>
      </div>
    )
  }

  const isHost = meta?.hostId === uid
  const sheriffId = game.playerOrder[game.sheriffIndex]

  // ── setup_place 로직 ─────────────────────────────────────
  const currentSetupCharId = game.setupPlacementOrder[0] ?? null
  const currentSetupChar = currentSetupCharId ? game.characters[currentSetupCharId] : null
  // setup_place는 호스트가 대신 진행 (Security Rules: 호스트만 game 경로 쓰기 가능)
  const isMyTurnToPlace = isHost && !!currentSetupChar

  async function handleRollSetup() {
    if (!game || actionLoading) return
    setActionLoading(true)
    const { state: next, options } = rollAndGetPlacementOptions(game)
    await patchGameState(roomCode, { setupDiceRoll: next.setupDiceRoll })
    setPlacementOptions(options)
    setActionLoading(false)
  }

  async function handlePlaceCharacter(zone: ZoneName) {
    if (!game || !currentSetupCharId || actionLoading) return
    setActionLoading(true)
    let next = placeCharacter(game, currentSetupCharId, zone)

    // 모두 배치 완료 → 첫 라운드 시작
    if (next.setupPlacementOrder.length === 0) {
      next = startFirstRound(next)
    }

    await patchGameState(roomCode, {
      characters: next.characters,
      zones: next.zones,
      setupPlacementOrder: next.setupPlacementOrder,
      setupDiceRoll: null,
      ...(next.phase !== game.phase ? {
        phase: next.phase,
        round: next.round,
        lastDiceRoll: next.lastDiceRoll,
      } : {}),
    })
    setPlacementOptions([])
    setActionLoading(false)
  }

  // ── roll_dice 로직 ───────────────────────────────────────
  async function handleRollDice() {
    if (!game || actionLoading) return
    setActionLoading(true)
    await hostRollDice(roomCode, game)
    setActionLoading(false)
  }

  // ── 존 보드 렌더링 ────────────────────────────────────────
  function renderZone(zoneName: ZoneName) {
    const zoneState = game!.zones[zoneName]
    const config = ZONE_CONFIGS[zoneName]
    const chars = zoneState.characterIds.map(id => game!.characters[id]).filter(Boolean)

    return (
      <div key={zoneName} className="bg-zinc-800 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-white">{config.displayName}</span>
          <span className="text-xs text-zinc-500">#{config.zoneNumber}</span>
        </div>

        {/* 좀비 수 */}
        <div className="flex items-center gap-1">
          <span className="text-red-400 text-lg">🧟</span>
          <span className="text-white font-mono font-bold">{zoneState.zombies}</span>
          {config.defenseLimit > 0 && (
            <span className="text-zinc-500 text-xs ml-1">
              방어 {config.defenseLimit}
            </span>
          )}
        </div>

        {/* 캐릭터 */}
        <div className="flex flex-wrap gap-1 min-h-[24px]">
          {chars.map(char => {
            const owner = players[char.playerId]
            const charConfig = CHARACTER_CONFIGS[char.characterId]
            return (
              <div
                key={char.id}
                title={`${owner?.nickname ?? '?'} - ${charConfig?.name ?? char.characterId}`}
                className={`w-6 h-6 rounded-full border-2 border-zinc-600 flex items-center justify-center text-xs font-bold text-white ${
                  owner ? (COLOR_BG[owner.color] ?? 'bg-zinc-600') : 'bg-zinc-600'
                } ${!char.isAlive ? 'opacity-30' : ''}`}
              >
                {charConfig?.name?.charAt(0) ?? '?'}
              </div>
            )
          })}
        </div>

        {/* 수용 인원 */}
        <div className="text-xs text-zinc-600">
          {chars.filter(c => c.isAlive).length} / {config.maxCapacity === Infinity ? '∞' : config.maxCapacity}
        </div>
      </div>
    )
  }

  // ── 액션 패널 ──────────────────────────────────────────────
  function renderActionPanel() {
    switch (game!.phase) {
      case 'setup_place': {
        if (!currentSetupChar) return <p className="text-zinc-400 text-sm">배치 완료 대기 중...</p>
        const owner = players[currentSetupChar.playerId]
        const charConfig = CHARACTER_CONFIGS[currentSetupChar.characterId]

        if (!isMyTurnToPlace) {
          return (
            <div className="text-center">
              <p className="text-zinc-400 text-sm">
                <span className="text-white font-bold">{owner?.nickname ?? '?'}</span>님의
                <span className="text-yellow-400 font-bold"> {charConfig?.name}</span> 배치 중...
              </p>
              <p className="text-zinc-600 text-xs mt-1">남은 배치: {game!.setupPlacementOrder.length}개</p>
            </div>
          )
        }

        // 호스트 턴
        if (placementOptions.length > 0 || game?.setupDiceRoll) {
          const options = placementOptions.length > 0
            ? placementOptions
            : (Object.keys(game!.zones) as ZoneName[])
          return (
            <div>
              <p className="text-white text-sm font-bold mb-2">
                {owner?.nickname}의 <span className="text-yellow-400">{charConfig?.name}</span> 배치할 구역 선택
              </p>
              <div className="flex flex-wrap gap-2">
                {options.map(zone => (
                  <button
                    key={zone}
                    onClick={() => handlePlaceCharacter(zone)}
                    disabled={actionLoading}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {ZONE_CONFIGS[zone].displayName}
                  </button>
                ))}
              </div>
            </div>
          )
        }

        return (
          <div>
            <p className="text-white text-sm font-bold mb-2">
              {owner?.nickname}의 <span className="text-yellow-400">{charConfig?.name}</span> 배치
            </p>
            <button
              onClick={handleRollSetup}
              disabled={actionLoading}
              className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-semibold px-6 py-2 rounded-xl text-sm transition-colors"
            >
              {actionLoading ? '주사위 굴리는 중...' : '🎲 주사위 굴리기'}
            </button>
          </div>
        )
      }

      case 'roll_dice': {
        if (!isHost) {
          return (
            <p className="text-zinc-400 text-sm">
              보안관 <span className="text-white font-bold">{players[sheriffId]?.nickname ?? '?'}</span>이 주사위를 굴리는 중...
            </p>
          )
        }
        return (
          <button
            onClick={handleRollDice}
            disabled={actionLoading}
            className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-bold px-8 py-3 rounded-xl text-sm transition-colors"
          >
            {actionLoading ? '처리 중...' : '🎲 좀비 주사위 굴리기'}
          </button>
        )
      }

      case 'finished': {
        return (
          <div className="text-center">
            <p className="text-2xl font-bold text-white mb-2">게임 종료!</p>
            {game!.winners.length > 0 && (
              <p className="text-yellow-400 text-sm">
                승자: {game!.winners.map(id => players[id]?.nickname ?? id).join(', ')}
              </p>
            )}
            <button
              onClick={onLeave}
              className="mt-4 bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-2 rounded-xl text-sm transition-colors"
            >
              로비로 돌아가기
            </button>
          </div>
        )
      }

      default:
        return (
          <p className="text-zinc-500 text-sm">
            현재 페이즈: <span className="text-white">{PHASE_LABEL[game!.phase] ?? game!.phase}</span>
          </p>
        )
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-white">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="text-red-400 font-bold text-sm">MALL OF HORROR</span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400 text-xs">라운드 {game.round}</span>
          <span className="bg-zinc-800 text-yellow-400 text-xs px-2 py-0.5 rounded-full">
            {PHASE_LABEL[game.phase] ?? game.phase}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            보안관: <span className="text-white">{players[sheriffId]?.nickname ?? '?'}</span>
          </span>
          <button onClick={onLeave} className="text-zinc-600 hover:text-white text-xs transition-colors">
            나가기
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 존 보드 */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl mx-auto">
            {ZONE_ORDER.map(renderZone)}
          </div>

          {/* 액션 패널 */}
          <div className="max-w-2xl mx-auto mt-4 bg-zinc-900 rounded-2xl p-4">
            {renderActionPanel()}
          </div>
        </div>

        {/* 플레이어 사이드바 */}
        <div className="w-48 bg-zinc-900 border-l border-zinc-800 p-3 overflow-y-auto">
          <p className="text-xs text-zinc-500 mb-3">플레이어</p>
          <div className="space-y-2">
            {game.playerOrder.map(playerId => {
              const player = players[playerId]
              const isSheriff = playerId === sheriffId
              const myChars = Object.values(game.characters).filter(
                c => c.playerId === playerId && c.isAlive
              )
              return (
                <div key={playerId} className="bg-zinc-800 rounded-xl p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3 h-3 rounded-full ${COLOR_BG[player?.color ?? ''] ?? 'bg-zinc-600'}`} />
                    <span className="text-xs font-medium text-white truncate flex-1">
                      {player?.nickname ?? '?'}
                    </span>
                    {isSheriff && <span className="text-yellow-400 text-xs">👮</span>}
                    {playerId === uid && <span className="text-blue-400 text-xs">나</span>}
                  </div>
                  <div className="text-xs text-zinc-500">
                    생존 {myChars.length}명
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
