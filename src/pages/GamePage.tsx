import { useEffect, useRef, useState } from 'react'
import {
  subscribeToGame, declareCharacter, sealDestination,
  submitVote, patchGameState,
} from '../firebase/gameService'
import { subscribeToPlayers, subscribeToMeta } from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { hostRollDice, hostResolveMovement, hostResolveVote, hostEndRound } from '../firebase/hostService'
import { rollAndGetPlacementOptions, placeCharacter, startFirstRound } from '../engine/setup'
import { startZoneAttackPhase, startZoneSurvivorPhase } from '../engine/event'
import { calculateVoteResult } from '../engine/combat'
import { EVENT_ZONE_ORDER, ZONE_CONFIGS, CHARACTER_CONFIGS } from '../engine/constants'
import type { GameState, Player, RoomMeta, ZoneName } from '../engine/types'

const ZONE_ORDER: ZoneName[] = ['bathroom', 'clothing', 'toy', 'parking', 'security', 'supermarket']

const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

const PHASE_LABEL: Record<string, string> = {
  setup_place: '초기 배치', roll_dice: '주사위', character_select: '캐릭터 선언',
  destination_seal: '목적지 선택', destination_reveal: '공개', move_execute: '이동',
  event: '이벤트', voting: '투표', check_win: '승리 체크', finished: '종료',
}

// Firebase는 빈 배열/객체를 null로 저장하므로 정규화 필요
function normalizeGame(g: GameState): GameState {
  // 각 zone의 characterIds 정규화
  const zones = g.zones ?? {} as GameState['zones']
  const normalizedZones = Object.fromEntries(
    Object.entries(zones).map(([k, z]) => [k, { ...z, characterIds: (z as any).characterIds ?? [] }])
  ) as GameState['zones']

  // currentVote 내부 배열 정규화
  const cv = g.currentVote
  const normalizedVote = cv ? {
    ...cv,
    eligibleVoters: cv.eligibleVoters ?? [],
    candidates:     cv.candidates     ?? [],
    votes:          cv.votes          ?? {},
    status:         cv.status         ?? {},
    bonusVoteWeights: cv.bonusVoteWeights ?? {},
  } : null

  return {
    ...g,
    playerOrder:            g.playerOrder            ?? [],
    setupPlacementOrder:    g.setupPlacementOrder    ?? [],
    declarationOrder:       g.declarationOrder       ?? [],
    resolvedMoves:          g.resolvedMoves          ?? [],
    winners:                g.winners                ?? [],
    characterDeclarations:  g.characterDeclarations  ?? {},
    destinationStatus:      g.destinationStatus      ?? {},
    sealedDestinations:     g.sealedDestinations     ?? {},
    characters:             g.characters             ?? {},
    zones:                  normalizedZones,
    finalScores:            g.finalScores            ?? {},
    currentVote:            normalizedVote,
  }
}

interface Props { roomCode: string; onLeave: () => void }

export default function GamePage({ roomCode, onLeave }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [meta, setMeta] = useState<RoomMeta | null>(null)
  const [placementOptions, setPlacementOptions] = useState<ZoneName[]>([])
  const [actionLoading, setActionLoading] = useState(false)
  const processingRef = useRef(false)
  const uid = getCurrentUid()

  useEffect(() => {
    const unsubGame = subscribeToGame(roomCode, g => setGame(g ? normalizeGame(g) : null))
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubMeta = subscribeToMeta(roomCode, setMeta)
    return () => { unsubGame(); unsubPlayers(); unsubMeta() }
  }, [roomCode])

  // ── 호스트 자동 진행 ─────────────────────────────────────────
  const isHost = meta?.hostId === uid
  useEffect(() => {
    if (!isHost || !game || processingRef.current) return

    async function runHostStep() {
      if (!game || processingRef.current) return
      processingRef.current = true
      try {
        // character_select: 전원 선언 완료 → destination_seal
        if (game.phase === 'character_select') {
          const declared = Object.keys(game.characterDeclarations)
          if (declared.length >= game.playerOrder.length) {
            const declarationOrder = Object.values(game.characterDeclarations)
              .sort((a, b) => a.declaredAt - b.declaredAt)
              .map(d => d.playerId)
            await patchGameState(roomCode, { phase: 'destination_seal', declarationOrder })
          }
        }

        // destination_seal: 전원 봉인 완료 → 이동 처리
        else if (game.phase === 'destination_seal') {
          const sealed = Object.values(game.destinationStatus).filter(Boolean).length
          if (sealed >= game.playerOrder.length) {
            await hostResolveMovement(roomCode, game)
          }
        }

        // event: 구역별 자동 처리
        else if (game.phase === 'event' && !game.currentVote) {
          const zone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
          const attackState = startZoneAttackPhase(zone, game)
          if (attackState) {
            await patchGameState(roomCode, { currentVote: attackState.currentVote, phase: 'voting' })
            return
          }
          const survivorState = startZoneSurvivorPhase(zone, game)
          if (survivorState) {
            await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting' })
            return
          }
          if (game.currentEventZoneIndex + 1 < EVENT_ZONE_ORDER.length) {
            await patchGameState(roomCode, { currentEventZoneIndex: game.currentEventZoneIndex + 1 })
          } else {
            await hostEndRound(roomCode, game)
          }
        }

        // voting: 전원 투표 완료 → 결과 처리
        else if (game.phase === 'voting' && game.currentVote) {
          const allVoted = game.currentVote.eligibleVoters.length > 0 &&
            game.currentVote.eligibleVoters.every(id => game.currentVote!.status[id])
          if (allVoted) {
            let victimId: string | undefined
            if (game.currentVote.type === 'zombie_attack') {
              const result = calculateVoteResult(game.currentVote, game)
              if (result.winner) {
                const loserCharsInZone = Object.values(game.characters)
                  .filter(c =>
                    c.playerId === result.winner &&
                    c.isAlive &&
                    game.zones[game.currentVote!.zone].characterIds.includes(c.id)
                  )
                victimId = loserCharsInZone[0]?.id
              }
            }
            await hostResolveVote(roomCode, game, victimId)
          }
        }
      } finally {
        processingRef.current = false
      }
    }

    runHostStep()
  }, [game, isHost, roomCode])

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400 text-sm">게임 로딩 중...</p>
      </div>
    )
  }

  const sheriffId = game.playerOrder[game.sheriffIndex]

  // ── setup_place ──────────────────────────────────────────────
  const currentSetupCharId = game.setupPlacementOrder[0] ?? null
  const currentSetupChar = currentSetupCharId ? game.characters[currentSetupCharId] : null
  const isMyTurnToPlace = currentSetupChar?.playerId === uid

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
    if (next.setupPlacementOrder.length === 0) next = startFirstRound(next)
    await patchGameState(roomCode, {
      characters: next.characters,
      zones: next.zones,
      setupPlacementOrder: next.setupPlacementOrder,
      setupDiceRoll: null,
      ...(next.phase !== game.phase ? {
        phase: next.phase, round: next.round, lastDiceRoll: next.lastDiceRoll,
        currentEventZoneIndex: 0,
      } : {}),
    })
    setPlacementOptions([])
    setActionLoading(false)
  }

  // ── roll_dice ────────────────────────────────────────────────
  async function handleRollDice() {
    if (!game || actionLoading) return
    setActionLoading(true)
    await hostRollDice(roomCode, game)
    setActionLoading(false)
  }

  // ── character_select ─────────────────────────────────────────
  const myDeclaredCharId = game.characterDeclarations[uid ?? '']?.characterId
  const myAliveChars = uid
    ? Object.values(game.characters).filter(c => c.playerId === uid && c.isAlive)
    : []

  async function handleDeclareCharacter(charInstanceId: string) {
    if (!uid || myDeclaredCharId || actionLoading) return
    setActionLoading(true)
    await declareCharacter(roomCode, {
      playerId: uid,
      characterId: charInstanceId,
      order: Object.keys(game!.characterDeclarations).length,
      declaredAt: Date.now(),
    })
    setActionLoading(false)
  }

  // ── destination_seal ─────────────────────────────────────────
  const mySealedZone = game.sealedDestinations[uid ?? '']?.targetZone
  const myMovingChar = uid ? game.characterDeclarations[uid]?.characterId : undefined
  const myMovingCharData = myMovingChar ? game.characters[myMovingChar] : undefined

  async function handleSealDestination(zone: ZoneName) {
    if (!uid || mySealedZone || actionLoading) return
    setActionLoading(true)
    await sealDestination(roomCode, zone)
    setActionLoading(false)
  }

  // ── voting ───────────────────────────────────────────────────
  const myVote = uid && game.currentVote ? game.currentVote.votes[uid] : undefined

  async function handleVote(targetPlayerId: string) {
    if (!uid || !game || !game.currentVote || myVote || actionLoading) return
    setActionLoading(true)
    await submitVote(roomCode, game.currentVote.zone, targetPlayerId)
    setActionLoading(false)
  }

  // ── 존 보드 ──────────────────────────────────────────────────
  function renderZone(zoneName: ZoneName) {
    const zoneState = game!.zones[zoneName]
    const config = ZONE_CONFIGS[zoneName]
    const chars = zoneState.characterIds.map(id => game!.characters[id]).filter(Boolean)
    const isCurrentEventZone =
      game!.phase === 'event' && EVENT_ZONE_ORDER[game!.currentEventZoneIndex] === zoneName
    const isVotingZone = game!.phase === 'voting' && game!.currentVote?.zone === zoneName

    return (
      <div
        key={zoneName}
        className={`bg-zinc-800 rounded-xl p-3 flex flex-col gap-2 transition-all ${
          isVotingZone ? 'ring-2 ring-red-500' : isCurrentEventZone ? 'ring-2 ring-yellow-500' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-white">{config.displayName}</span>
          <span className="text-xs text-zinc-500">#{config.zoneNumber}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-red-400">🧟</span>
          <span className="text-white font-mono font-bold">{zoneState.zombies}</span>
          {config.defenseLimit > 0 && (
            <span className="text-zinc-500 text-xs ml-1">방어 {config.defenseLimit}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 min-h-[24px]">
          {chars.map(char => {
            const owner = players[char.playerId]
            const charConfig = CHARACTER_CONFIGS[char.characterId]
            const isMoving = game!.characterDeclarations[char.playerId]?.characterId === char.id
            return (
              <div
                key={char.id}
                title={`${owner?.nickname ?? '?'} — ${charConfig?.name}`}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold text-white
                  ${owner ? (COLOR_BG[owner.color] ?? 'bg-zinc-600') : 'bg-zinc-600'}
                  ${!char.isAlive ? 'opacity-20' : ''}
                  ${isMoving ? 'border-yellow-400' : 'border-zinc-600'}`}
              >
                {charConfig?.name?.charAt(0) ?? '?'}
              </div>
            )
          })}
        </div>
        <div className="text-xs text-zinc-600">
          {chars.filter(c => c.isAlive).length} / {config.maxCapacity === Infinity ? '∞' : config.maxCapacity}
        </div>
      </div>
    )
  }

  // ── 액션 패널 ────────────────────────────────────────────────
  function renderActionPanel() {
    switch (game!.phase) {
      // ── 초기 배치 ───────────────────────────────────────────
      case 'setup_place': {
        if (!currentSetupChar) return <p className="text-zinc-400 text-sm">배치 완료 대기 중...</p>
        const owner = players[currentSetupChar.playerId]
        const charConfig = CHARACTER_CONFIGS[currentSetupChar.characterId]

        if (!isMyTurnToPlace) {
          return (
            <div className="text-center">
              <p className="text-zinc-400 text-sm">
                <span className="text-white font-bold">{owner?.nickname}</span>님의{' '}
                <span className="text-yellow-400 font-bold">{charConfig?.name}</span> 배치 중...
              </p>
              <p className="text-zinc-600 text-xs mt-1">남은 배치: {game!.setupPlacementOrder.length}개</p>
            </div>
          )
        }

        if (placementOptions.length > 0 || game!.setupDiceRoll) {
          const options = placementOptions.length > 0 ? placementOptions : ZONE_ORDER
          return (
            <div>
              <p className="text-white text-sm font-bold mb-2">
                <span className="text-yellow-400">{charConfig?.name}</span> 배치할 구역 선택
              </p>
              <div className="flex flex-wrap gap-2">
                {options.map(zone => (
                  <button key={zone} onClick={() => handlePlaceCharacter(zone)} disabled={actionLoading}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">
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
              내 차례: <span className="text-yellow-400">{charConfig?.name}</span> 배치
            </p>
            <button onClick={handleRollSetup} disabled={actionLoading}
              className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-semibold px-6 py-2 rounded-xl text-sm transition-colors">
              {actionLoading ? '굴리는 중...' : '🎲 주사위 굴리기'}
            </button>
          </div>
        )
      }

      // ── 주사위 (2라운드~) ────────────────────────────────────
      case 'roll_dice': {
        if (!isHost) {
          return (
            <p className="text-zinc-400 text-sm">
              보안관 <span className="text-white font-bold">{players[sheriffId]?.nickname}</span>이 주사위를 굴리는 중...
            </p>
          )
        }
        return (
          <button onClick={handleRollDice} disabled={actionLoading}
            className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-bold px-8 py-3 rounded-xl text-sm transition-colors">
            {actionLoading ? '처리 중...' : '🎲 좀비 주사위 굴리기'}
          </button>
        )
      }

      // ── 캐릭터 선언 ─────────────────────────────────────────
      case 'character_select': {
        const declaredCount = Object.keys(game!.characterDeclarations).length
        const total = game!.playerOrder.length

        if (myDeclaredCharId) {
          const charConfig = CHARACTER_CONFIGS[game!.characters[myDeclaredCharId]?.characterId]
          return (
            <div>
              <p className="text-green-400 text-sm font-bold mb-1">
                ✓ {charConfig?.name} 선언 완료
              </p>
              <p className="text-zinc-500 text-xs">{declaredCount} / {total}명 선언 완료</p>
            </div>
          )
        }

        return (
          <div>
            <p className="text-white text-sm font-bold mb-2">이동할 캐릭터 선택</p>
            <div className="flex gap-2 flex-wrap">
              {myAliveChars.map(char => {
                const charConfig = CHARACTER_CONFIGS[char.characterId]
                return (
                  <button key={char.id} onClick={() => handleDeclareCharacter(char.id)}
                    disabled={actionLoading}
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 text-white text-sm px-4 py-2 rounded-xl transition-colors">
                    {charConfig?.name ?? char.characterId}
                    <span className="text-zinc-400 text-xs ml-1">({ZONE_CONFIGS[char.zone].displayName})</span>
                  </button>
                )
              })}
            </div>
            <p className="text-zinc-600 text-xs mt-2">{declaredCount} / {total}명 선언 완료</p>
          </div>
        )
      }

      // ── 목적지 선택 ─────────────────────────────────────────
      case 'destination_seal': {
        const sealedCount = Object.values(game!.destinationStatus).filter(Boolean).length
        const total = game!.playerOrder.length

        if (mySealedZone) {
          return (
            <div>
              <p className="text-green-400 text-sm font-bold mb-1">✓ 목적지 봉인 완료</p>
              <p className="text-zinc-500 text-xs">{sealedCount} / {total}명 완료</p>
            </div>
          )
        }

        return (
          <div>
            <p className="text-white text-sm font-bold mb-1">목적지 선택</p>
            {myMovingCharData && (
              <p className="text-zinc-400 text-xs mb-2">
                이동 캐릭터: <span className="text-yellow-400">{CHARACTER_CONFIGS[myMovingCharData.characterId]?.name}</span>
                {' '}({ZONE_CONFIGS[myMovingCharData.zone].displayName} → ?)
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              {ZONE_ORDER.map(zone => (
                <button key={zone} onClick={() => handleSealDestination(zone)} disabled={actionLoading}
                  className="bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-700 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
                  {ZONE_CONFIGS[zone].displayName}
                </button>
              ))}
            </div>
            <p className="text-zinc-600 text-xs mt-2">{sealedCount} / {total}명 완료</p>
          </div>
        )
      }

      // ── 이벤트 처리 ─────────────────────────────────────────
      case 'event': {
        const zone = EVENT_ZONE_ORDER[game!.currentEventZoneIndex]
        return (
          <p className="text-zinc-400 text-sm">
            이벤트 처리 중: <span className="text-yellow-400 font-bold">{ZONE_CONFIGS[zone].displayName}</span>
            <span className="text-zinc-600 text-xs ml-2">({game!.currentEventZoneIndex + 1}/6)</span>
          </p>
        )
      }

      // ── 투표 ────────────────────────────────────────────────
      case 'voting': {
        if (!game!.currentVote) return <p className="text-zinc-400 text-sm">투표 준비 중...</p>
        const vote = game!.currentVote
        const voteZone = ZONE_CONFIGS[vote.zone]
        const voteTypeLabel = vote.type === 'zombie_attack' ? '좀비 공격' :
          vote.type === 'item_search' ? '아이템 탐색' : '보안관 선출'

        const candidates = vote.candidates.map(id => ({
          id,
          nickname: players[id]?.nickname ?? '?',
          color: players[id]?.color ?? 'red',
          voted: !!vote.status[id],
        }))

        const votedCount = vote.eligibleVoters.filter(id => vote.status[id]).length

        if (myVote) {
          return (
            <div>
              <p className="text-sm text-zinc-400 mb-1">
                <span className="text-yellow-400 font-bold">{voteZone.displayName}</span> — {voteTypeLabel}
              </p>
              <p className="text-green-400 text-sm">
                ✓ {players[myVote]?.nickname}에게 투표 완료
              </p>
              <p className="text-zinc-600 text-xs mt-1">{votedCount} / {vote.eligibleVoters.length}명 투표 완료</p>
            </div>
          )
        }

        const canVote = vote.eligibleVoters.includes(uid ?? '')
        return (
          <div>
            <p className="text-sm text-zinc-400 mb-2">
              <span className="text-yellow-400 font-bold">{voteZone.displayName}</span> — {voteTypeLabel}
            </p>
            {canVote ? (
              <>
                <p className="text-white text-sm font-bold mb-2">투표할 대상 선택</p>
                <div className="flex gap-2 flex-wrap">
                  {candidates.map(c => (
                    <button key={c.id} onClick={() => handleVote(c.id)} disabled={actionLoading}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                        vote.candidates.includes(c.id)
                          ? 'bg-zinc-700 hover:bg-red-800 text-white'
                          : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      }`}>
                      <div className={`w-3 h-3 rounded-full ${COLOR_BG[c.color]}`} />
                      {c.nickname}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-zinc-500 text-sm">이번 투표에 참여하지 않습니다.</p>
            )}
            <p className="text-zinc-600 text-xs mt-2">{votedCount} / {vote.eligibleVoters.length}명 투표 완료</p>
          </div>
        )
      }

      // ── 게임 종료 ────────────────────────────────────────────
      case 'finished': {
        return (
          <div className="text-center">
            <p className="text-2xl font-bold text-white mb-2">게임 종료!</p>
            {game!.winners.length > 0 && (
              <p className="text-yellow-400 text-sm mb-3">
                승자: {game!.winners.map(id => players[id]?.nickname ?? id).join(', ')}
              </p>
            )}
            <button onClick={onLeave}
              className="bg-zinc-700 hover:bg-zinc-600 text-white px-6 py-2 rounded-xl text-sm transition-colors">
              로비로 돌아가기
            </button>
          </div>
        )
      }

      default:
        return (
          <p className="text-zinc-500 text-sm">
            {PHASE_LABEL[game!.phase] ?? game!.phase}
          </p>
        )
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────
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
          <span className="text-xs text-zinc-600">#{roomCode}</span>
          <button onClick={onLeave} className="text-zinc-600 hover:text-white text-xs transition-colors">나가기</button>
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
        <div className="w-44 bg-zinc-900 border-l border-zinc-800 p-3 overflow-y-auto shrink-0">
          <p className="text-xs text-zinc-500 mb-3">플레이어</p>
          <div className="space-y-2">
            {game.playerOrder.map(playerId => {
              const player = players[playerId]
              const isSheriff = playerId === sheriffId
              const aliveCount = Object.values(game.characters)
                .filter(c => c.playerId === playerId && c.isAlive).length
              const isDeclared = !!game.characterDeclarations[playerId]
              const isSealed = !!game.destinationStatus[playerId]
              const hasVoted = !!game.currentVote?.status[playerId]

              let statusDot = ''
              if (game.phase === 'character_select') statusDot = isDeclared ? '✓' : '...'
              else if (game.phase === 'destination_seal') statusDot = isSealed ? '✓' : '...'
              else if (game.phase === 'voting') statusDot = hasVoted ? '✓' : '...'

              return (
                <div key={playerId} className="bg-zinc-800 rounded-xl p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${COLOR_BG[player?.color ?? ''] ?? 'bg-zinc-600'}`} />
                    <span className="text-xs font-medium text-white truncate flex-1">
                      {player?.nickname ?? '?'}
                    </span>
                    {isSheriff && <span className="text-yellow-400 text-xs">👮</span>}
                    {playerId === uid && <span className="text-blue-400 text-xs">나</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">생존 {aliveCount}명</span>
                    {statusDot && (
                      <span className={`text-xs ${statusDot === '✓' ? 'text-green-400' : 'text-zinc-600'}`}>
                        {statusDot}
                      </span>
                    )}
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
