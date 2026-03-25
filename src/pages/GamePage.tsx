import { useEffect, useRef, useState } from 'react'
import {
  subscribeToGame, declareCharacter, sealDestination,
  submitVote, patchGameState, subscribeToMyItems, submitItemSearchChoice,
} from '../firebase/gameService'
import { subscribeToPlayers, subscribeToMeta } from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { hostRollDice, hostApplyDiceRoll, hostResolveMovement, hostResolveVote, hostEndRound, hostResolveItemSearch } from '../firebase/hostService'
import { deleteRoom } from '../firebase/roomService'
import { rollAndGetPlacementOptions, placeCharacter, startFirstRound } from '../engine/setup'
import { startZoneAttackPhase, startZoneSurvivorPhase, determineSurvivorEvent, checkAndCloseZone } from '../engine/event'
import { calculateVoteResult, calcDefense, isUnderAttack } from '../engine/combat'
import { EVENT_ZONE_ORDER, ZONE_CONFIGS, CHARACTER_CONFIGS, ITEM_CONFIGS, DICE_TO_ZONE } from '../engine/constants'
import { isZoneFull, calcBonusZombies } from '../engine/dice'
import type { GameState, Player, RoomMeta, ZoneName } from '../engine/types'

const ZONE_ORDER: ZoneName[] = ['bathroom', 'clothing', 'toy', 'parking', 'security', 'supermarket']

// instanceId 예: "hidden_card_0", "sprint_2", "axe_0" → itemId 추출
function instanceIdToItemId(instanceId: string): string {
  const parts = instanceId.split('_')
  parts.pop()
  return parts.join('_')
}

const ITEM_CATEGORY: Record<string, string> = {
  axe: '🪓', pistol: '🔫', shotgun: '🔫', bat: '🏏', grenade: '💣', chainsaw: '⚙️',
  sprint: '👟', hidden_card: '🃏', threat: '😤', hardware: '🔧', cctv: '📷',
}

const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

const PHASE_LABEL: Record<string, string> = {
  setup_place: '초기 배치', roll_dice: '주사위', dice_reveal: '주사위 공개',
  character_select: '캐릭터 선언', destination_seal: '목적지 선택',
  destination_reveal: '공개', move_execute: '이동',
  event: '이벤트', zone_announce: '구역 공지', voting: '투표',
  check_win: '승리 체크', finished: '종료',
}

// Firebase는 빈 배열/객체를 null로 저장하므로 정규화 필요
function normalizeGame(g: GameState): GameState {
  // 각 zone의 characterIds 정규화
  const zones = g.zones ?? {} as GameState['zones']
  const normalizedZones = Object.fromEntries(
    Object.entries(zones).map(([k, z]) => {
      const raw = (z as any).characterIds
      // Firebase가 배열을 객체로 반환하는 경우 대비
      const characterIds: string[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
          ? Object.values(raw) as string[]
          : []
      return [k, { ...z, characterIds, isClosed: (z as any).isClosed ?? false }]
    })
  ) as GameState['zones']

  // currentVote 내부 배열 정규화
  const cv = g.currentVote
  const toArray = (v: unknown): string[] =>
    Array.isArray(v) ? v as string[]
    : v && typeof v === 'object' ? Object.values(v) as string[]
    : []
  const normalizedVote = cv ? {
    ...cv,
    eligibleVoters: toArray(cv.eligibleVoters),
    candidates:     toArray(cv.candidates),
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
    playerItemCounts:       g.playerItemCounts       ?? {},
    currentVote:            normalizedVote,
  }
}

interface Props { roomCode: string; onLeave: () => void }

export default function GamePage({ roomCode, onLeave }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [meta, setMeta] = useState<RoomMeta | null>(null)
  const [selectedSetupCharId, setSelectedSetupCharId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [processSignal, setProcessSignal] = useState(0)
  const [myItemIds, setMyItemIds] = useState<string[]>([])
  const gameRef = useRef<GameState | null>(null)
  gameRef.current = game  // 항상 최신 game 참조 (stale closure 방지)
  // 트럭 수색 아이템 선택 상태
  const [truckKept, setTruckKept] = useState<string | null>(null)
  const [truckGiven, setTruckGiven] = useState<string | null>(null)
  const [truckGivenTo, setTruckGivenTo] = useState<string | null>(null)
  const processingRef = useRef(false)
  const uid = getCurrentUid()

  useEffect(() => {
    const unsubGame = subscribeToGame(roomCode, g => setGame(g ? normalizeGame(g) : null))
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubMeta = subscribeToMeta(roomCode, setMeta)
    const unsubItems = uid ? subscribeToMyItems(roomCode, uid, setMyItemIds) : () => {}
    return () => { unsubGame(); unsubPlayers(); unsubMeta(); unsubItems() }
  }, [roomCode, uid])

  // ── 호스트 자동 진행 ─────────────────────────────────────────
  const isHost = meta?.hostId === uid
  useEffect(() => {
    if (!isHost || !game || processingRef.current) return

    async function runHostStep() {
      if (!game || processingRef.current) return
      processingRef.current = true
      let didWork = false
      try {
        // character_select: 전원 선언 완료 → destination_seal
        if (game.phase === 'character_select') {
          const declared = Object.keys(game.characterDeclarations)
          if (declared.length >= game.playerOrder.length) {
            await patchGameState(roomCode, { phase: 'destination_seal' })
            didWork = true
          }
        }

        // destination_seal: 전원 봉인 완료 → 이동 처리
        else if (game.phase === 'destination_seal') {
          const sealed = Object.values(game.destinationStatus).filter(Boolean).length
          if (sealed >= game.playerOrder.length) {
            await hostResolveMovement(roomCode, game)
            didWork = true
          }
        }

        // event: 트럭 수색 아이템 선택 대기 중이면 넘어가지 않음
        else if (game.phase === 'event' && !game.currentVote && !game.itemSearchPreview) {
          await patchGameState(roomCode, { phase: 'zone_announce' })
          didWork = true
        }

        // event: 트럭 수색 승자가 선택을 제출했으면 처리
        else if (game.phase === 'event' && game.itemSearchChoice && game.itemSearchWinnerId) {
          const { keptInstanceId, givenToPlayerId, givenInstanceId, returnedInstanceId } = game.itemSearchChoice
          await hostResolveItemSearch(
            roomCode, game, game.itemSearchWinnerId,
            keptInstanceId, givenToPlayerId, givenInstanceId, returnedInstanceId
          )
          await patchGameState(roomCode, { phase: 'zone_announce' })
          didWork = true
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
            const nextState = await hostResolveVote(roomCode, game, victimId)
            if (nextState.phase === 'event' && !nextState.itemSearchPreview) {
              await patchGameState(roomCode, { phase: 'zone_announce' })
            }
            didWork = true
          }
        }
      } finally {
        processingRef.current = false
        // 실제로 작업을 수행한 경우에만 재실행 신호 (무한루프 방지)
        if (didWork) setProcessSignal(s => s + 1)
      }
    }

    runHostStep()
  }, [game, isHost, roomCode, processSignal])

  // ── dice_reveal: 3초 후 자동 좀비 배치 ───────────────────────
  useEffect(() => {
    if (!isHost || !game || game.phase !== 'dice_reveal') return
    const capturedGame = game
    const timer = setTimeout(async () => {
      await hostApplyDiceRoll(roomCode, capturedGame)
    }, 3000)
    return () => clearTimeout(timer)
  }, [game?.phase, isHost, roomCode])

  // zone_announce deps용: 현재 구역 좀비 수 (좀비 습격 후 0으로 바뀔 때 effect 재실행 필요)
  const zoneAnnounceZone = game?.phase === 'zone_announce' ? EVENT_ZONE_ORDER[game.currentEventZoneIndex] : null
  const zoneAnnounceZombies = zoneAnnounceZone ? game?.zones?.[zoneAnnounceZone]?.zombies : undefined

  // ── zone_announce: 2초 후 실제 구역 이벤트 처리 ──────────────
  useEffect(() => {
    if (!isHost || !game || game.phase !== 'zone_announce') return
    const zoneIndex = game.currentEventZoneIndex
    const timer = setTimeout(async () => {
      // gameRef.current로 최신 상태 사용 (stale closure 방지)
      const g = gameRef.current
      if (!g || g.phase !== 'zone_announce' || g.currentEventZoneIndex !== zoneIndex) return

      const zone = EVENT_ZONE_ORDER[zoneIndex]
      const nextZoneIndex = zoneIndex + 1

      // 폐쇄 조건 체크 (좀비 8개 이상 + 사람 없음 → 폐쇄)
      const closedState = checkAndCloseZone(zone, g)
      if (closedState) {
        if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
          await patchGameState(roomCode, { zones: closedState.zones, currentEventZoneIndex: nextZoneIndex, phase: 'event' })
        } else {
          await hostEndRound(roomCode, closedState)
        }
        return
      }

      // 이미 폐쇄된 구역이면 스킵
      if (g.zones[zone].isClosed) {
        if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
          await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event' })
        } else {
          await hostEndRound(roomCode, g)
        }
        return
      }

      const attackState = startZoneAttackPhase(zone, g)
      if (attackState) {
        await patchGameState(roomCode, { currentVote: attackState.currentVote, phase: 'voting' })
        return
      }
      const survivorState = startZoneSurvivorPhase(zone, g)
      if (survivorState) {
        await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting' })
        return
      }
      if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
        await patchGameState(roomCode, {
          currentEventZoneIndex: nextZoneIndex,
          phase: 'event',
        })
      } else {
        await hostEndRound(roomCode, g)
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.currentEventZoneIndex, zoneAnnounceZombies, isHost, roomCode])

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400 text-sm">게임 로딩 중...</p>
      </div>
    )
  }

  const sheriffId = game.playerOrder[game.sheriffIndex]

  // ── setup_place ──────────────────────────────────────────────
  const currentSetupPlayerId = game.setupPlacementOrder[0] ?? null
  const isMyTurnToPlace = currentSetupPlayerId === uid

  // 주사위 결과로 배치 가능한 구역 계산 (Firebase에서 직접 파생)
  const setupZoneOptions: ZoneName[] = (() => {
    if (!game.setupDiceRoll) return []
    const d = game.setupDiceRoll as [number, number]
    const z1 = DICE_TO_ZONE[d[0]], z2 = DICE_TO_ZONE[d[1]]
    const candidates = z1 === z2 ? [z1] : [z1, z2]
    const available = candidates.filter(z => !isZoneFull(z, game) && !game.zones[z].isClosed)
    return available.length > 0 ? available : ZONE_ORDER.filter(z => !isZoneFull(z, game) && !game.zones[z].isClosed)
  })()

  // 내 미배치 캐릭터 목록 (zone==='parking'이지만 아직 zones.parking.characterIds에 없는 것들)
  const myUnplacedChars = uid
    ? Object.values(game.characters).filter(c =>
        c.playerId === uid &&
        c.isAlive &&
        c.zone === 'parking' &&
        !game.zones.parking.characterIds.includes(c.id)
      )
    : []

  async function handleRollSetup() {
    if (!game || actionLoading) return
    setActionLoading(true)
    const { state: next } = rollAndGetPlacementOptions(game)
    await patchGameState(roomCode, { setupDiceRoll: next.setupDiceRoll })
    setActionLoading(false)
  }

  async function handlePlaceCharacter(charInstanceId: string, zone: ZoneName) {
    if (!game || !charInstanceId || actionLoading) return
    setActionLoading(true)
    let next = placeCharacter(game, charInstanceId, zone)
    if (next.setupPlacementOrder.length === 0) next = startFirstRound(next)
    await patchGameState(roomCode, {
      characters: next.characters,
      zones: next.zones,
      setupPlacementOrder: next.setupPlacementOrder,
      setupDiceRoll: null,
      ...(next.phase !== game.phase ? {
        phase: next.phase, round: next.round, lastDiceRoll: next.lastDiceRoll,
        declarationOrder: next.declarationOrder,
        currentEventZoneIndex: 0,
      } : {}),
    })
    setSelectedSetupCharId(null)
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

  // 선언 순서상 현재 차례인 플레이어 (보안관부터 순서대로)
  const currentDeclarerId = game?.declarationOrder.find(pid => !game.characterDeclarations[pid]) ?? null

  async function handleDeclareCharacter(charInstanceId: string) {
    if (!uid || myDeclaredCharId || actionLoading) return
    if (currentDeclarerId !== uid) return  // 내 차례가 아님
    setActionLoading(true)
    await declareCharacter(roomCode, {
      playerId: uid,
      characterId: charInstanceId,
      order: game!.declarationOrder.indexOf(uid),
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
        className={`rounded-xl p-3 flex flex-col gap-2 transition-all ${
          zoneState.isClosed
            ? 'bg-zinc-900 opacity-60 ring-2 ring-zinc-700'
            : isVotingZone ? 'bg-zinc-800 ring-2 ring-red-500'
            : isCurrentEventZone ? 'bg-zinc-800 ring-2 ring-yellow-500'
            : 'bg-zinc-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold ${zoneState.isClosed ? 'text-zinc-500 line-through' : 'text-white'}`}>
            {config.displayName}
            {zoneState.isClosed && <span className="ml-1 text-xs no-underline not-italic text-red-600">🔒폐쇄</span>}
          </span>
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
        {zoneName === 'parking' && (
          <div className="text-xs text-zinc-500 flex items-center gap-1">
            <span>🚚</span>
            <span>트럭 {game!.itemDeck.length}장 남음</span>
          </div>
        )}
      </div>
    )
  }

  // ── 액션 패널 ────────────────────────────────────────────────
  function renderActionPanel() {
    switch (game!.phase) {
      // ── 초기 배치 ───────────────────────────────────────────
      case 'setup_place': {
        if (!currentSetupPlayerId) return <p className="text-zinc-400 text-sm">배치 완료 대기 중...</p>
        const currentOwner = players[currentSetupPlayerId]

        if (!isMyTurnToPlace) {
          const d = game!.setupDiceRoll as [number, number] | null
          return (
            <div className="text-center">
              <p className="text-zinc-400 text-sm mb-1">
                <span className="text-white font-bold">{currentOwner?.nickname}</span>님이 캐릭터 배치 중...
              </p>
              {d ? (
                <p className="text-xs text-zinc-500">
                  🎲 {d[0]}, {d[1]} →{' '}
                  <span className="text-yellow-400">{setupZoneOptions.map(z => ZONE_CONFIGS[z].displayName).join(' 또는 ')}</span>
                  {' '}중 선택
                </p>
              ) : (
                <p className="text-zinc-600 text-xs">주사위 대기 중...</p>
              )}
              <p className="text-zinc-700 text-xs mt-1">남은 배치: {game!.setupPlacementOrder.length}번</p>
            </div>
          )
        }

        // 주사위 굴리기 전
        if (!game!.setupDiceRoll) {
          return (
            <div>
              <p className="text-white text-sm font-bold mb-3">내 차례 — 주사위를 굴려 배치 구역을 결정하세요</p>
              <button onClick={handleRollSetup} disabled={actionLoading}
                className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-semibold px-6 py-2 rounded-xl text-sm transition-colors">
                {actionLoading ? '굴리는 중...' : '🎲 주사위 굴리기'}
              </button>
            </div>
          )
        }

        // 주사위 결과 공개 후 — 캐릭터 & 구역 선택
        const d = game!.setupDiceRoll as [number, number]
        return (
          <div>
            <p className="text-xs text-zinc-500 mb-2">
              🎲 주사위: {d[0]}, {d[1]} →{' '}
              <span className="text-yellow-400">{setupZoneOptions.map(z => ZONE_CONFIGS[z].displayName).join(' 또는 ')}</span>
            </p>

            {/* 캐릭터 선택 */}
            <p className="text-white text-sm font-bold mb-2">배치할 캐릭터 선택</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {myUnplacedChars.map(char => {
                const cfg = CHARACTER_CONFIGS[char.characterId]
                const isSelected = selectedSetupCharId === char.id
                return (
                  <button key={char.id}
                    onClick={() => setSelectedSetupCharId(isSelected ? null : char.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isSelected
                        ? 'bg-yellow-500 text-black'
                        : 'bg-zinc-700 hover:bg-zinc-600 text-white'
                    }`}>
                    {cfg?.name}
                  </button>
                )
              })}
            </div>

            {/* 구역 선택 (캐릭터 선택 후 활성화) */}
            {selectedSetupCharId && (
              <>
                <p className="text-white text-sm font-bold mb-2">배치할 구역 선택</p>
                <div className="flex flex-wrap gap-2">
                  {setupZoneOptions.map(zone => (
                    <button key={zone}
                      onClick={() => handlePlaceCharacter(selectedSetupCharId, zone)}
                      disabled={actionLoading}
                      className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">
                      {ZONE_CONFIGS[zone].displayName}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      }

      // ── 주사위 결과 공개 (보안관만 확인 가능) ────────────────────
      case 'dice_reveal': {
        // 보안관이 아니면 결과 숨김 (CCTV 아이템 미구현으로 추후 추가 예정)
        if (uid !== sheriffId) {
          return (
            <div className="text-center">
              <p className="text-zinc-400 text-sm">보안관이 주사위 결과를 확인 중...</p>
              <p className="text-zinc-600 text-xs mt-1">잠시 후 이동 페이즈가 시작됩니다</p>
            </div>
          )
        }
        const roll = game!.lastDiceRoll
        if (!roll) return <p className="text-zinc-400 text-sm">주사위 결과 로딩 중...</p>
        const { belleZone, mostCrowdedZone } = calcBonusZombies(game!)
        return (
          <div className="text-center">
            <p className="text-sm font-bold text-white mb-3">🎲 주사위 결과 (보안관만 확인 가능)</p>
            <div className="flex justify-center gap-2 mb-3">
              {roll.dice.map((d, i) => (
                <div key={i} className="w-10 h-10 bg-zinc-700 rounded-xl flex items-center justify-center text-xl font-bold text-white">
                  {d}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 mb-3 text-sm">
              {Object.entries(roll.zombiesByZone).map(([zone, count]) => (
                <span key={zone} className="bg-zinc-800 px-2 py-1 rounded-lg">
                  <span className="text-yellow-400">{ZONE_CONFIGS[zone as ZoneName]?.displayName}</span>
                  <span className="text-red-400 ml-1">+{count}🧟</span>
                </span>
              ))}
            </div>
            <div className="text-xs space-y-1 text-zinc-400">
              {mostCrowdedZone && (
                <p>👥 사람 가장 많은 곳: <span className="text-white font-bold">{ZONE_CONFIGS[mostCrowdedZone].displayName}</span> → 좀비 +1</p>
              )}
              {belleZone && (
                <p>💃 미녀 가장 많은 곳: <span className="text-white font-bold">{ZONE_CONFIGS[belleZone].displayName}</span> → 좀비 +1</p>
              )}
              {!mostCrowdedZone && !belleZone && (
                <p className="text-zinc-600">보너스 좀비 없음 (동률)</p>
              )}
            </div>
            <p className="text-zinc-600 text-xs mt-3">잠시 후 이동 페이즈가 시작됩니다...</p>
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

      // ── 캐릭터 선언 (보안관부터 순서대로) ────────────────────
      case 'character_select': {
        const declaredCount = Object.keys(game!.characterDeclarations).length
        const total = game!.playerOrder.length

        return (
          <div>
            {/* 선언 완료된 목록 */}
            {declaredCount > 0 && (
              <div className="mb-3">
                <p className="text-xs text-zinc-500 mb-1">선언 완료</p>
                <div className="flex flex-wrap gap-2">
                  {game!.declarationOrder
                    .filter(pid => game!.characterDeclarations[pid])
                    .map(pid => {
                      const decl = game!.characterDeclarations[pid]
                      const charConfig = CHARACTER_CONFIGS[game!.characters[decl.characterId]?.characterId]
                      const player = players[pid]
                      return (
                        <div key={pid} className="flex items-center gap-1.5 bg-zinc-800 rounded-lg px-2 py-1">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${COLOR_BG[player?.color ?? ''] ?? 'bg-zinc-600'}`} />
                          <span className="text-xs text-zinc-400">{player?.nickname}</span>
                          <span className="text-xs text-white font-medium">→ {charConfig?.name}</span>
                          <span className="text-xs text-zinc-500">({ZONE_CONFIGS[game!.characters[decl.characterId]?.zone]?.displayName})</span>
                        </div>
                      )
                    })
                  }
                </div>
              </div>
            )}

            {/* 내가 이미 선언함 */}
            {myDeclaredCharId && currentDeclarerId && (
              <p className="text-zinc-400 text-sm">
                <span className="text-white font-bold">{players[currentDeclarerId]?.nickname}</span>님이 선택 중...
              </p>
            )}

            {/* 내 차례 */}
            {!myDeclaredCharId && currentDeclarerId === uid && (
              <div>
                <p className="text-white text-sm font-bold mb-2">내 차례 — 이동할 캐릭터 선택</p>
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
              </div>
            )}

            {/* 다른 사람 차례 (나는 아직 선언 안 함 — 순서 기다리는 중) */}
            {!myDeclaredCharId && currentDeclarerId !== uid && (
              <p className="text-zinc-400 text-sm">
                <span className="text-white font-bold">{players[currentDeclarerId ?? '']?.nickname}</span>님이 선택 중... (내 차례 대기)
              </p>
            )}

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
              {ZONE_ORDER.filter(zone => zone !== myMovingCharData?.zone && !game!.zones[zone].isClosed).map(zone => (
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

      // ── 구역 공지 ────────────────────────────────────────────
      case 'zone_announce': {
        const zoneIdx = game!.currentEventZoneIndex
        const zone = EVENT_ZONE_ORDER[zoneIdx]
        const config = ZONE_CONFIGS[zone]
        const zoneState = game!.zones[zone]
        const aliveCount = zoneState.characterIds.filter(id => game!.characters[id]?.isAlive).length
        const defense = calcDefense(zone, game!)
        const attacked = isUnderAttack(zone, game!)
        const survivorEvent = !attacked ? determineSurvivorEvent(zone, game!) : null

        return (
          <div className="text-center">
            <p className="text-xs text-zinc-500 mb-1">이벤트 ({zoneIdx + 1}/6)</p>
            <p className="text-lg font-bold text-white mb-3">
              #{config.zoneNumber} {config.displayName}
              {zoneState.isClosed && <span className="ml-2 text-sm text-red-500">🔒 폐쇄</span>}
            </p>
            <div className="flex justify-center gap-4 mb-3 text-sm text-zinc-300">
              <span>🧟 좀비 <strong className="text-white">{zoneState.zombies}</strong></span>
              <span>👤 사람 <strong className="text-white">{aliveCount}</strong></span>
              {config.defenseLimit > 0 && (
                <span>🛡 방어 <strong className="text-white">{defense}</strong></span>
              )}
            </div>
            {zoneState.isClosed ? (
              <p className="text-red-600 font-bold">🔒 폐쇄된 구역입니다. 이벤트가 발생하지 않습니다.</p>
            ) : aliveCount === 0 ? (
              zoneState.zombies === 0
                ? <p className="text-zinc-500 text-sm">사람도 좀비도 없습니다.</p>
                : zoneState.zombies >= 8
                  ? <p className="text-red-600 font-bold">🔒 좀비가 가득 찼습니다! 구역이 폐쇄됩니다.</p>
                  : <p className="text-zinc-500 text-sm">사람이 없습니다.</p>
            ) : zoneState.zombies === 0 ? (
              survivorEvent === 'sheriff' ? (
                <p className="text-yellow-400 font-bold">👮 보안관 선출 투표를 진행합니다</p>
              ) : survivorEvent === 'truck_search' ? (
                <p className="text-blue-400 font-bold">🚚 트럭 수색 투표를 진행합니다</p>
              ) : (
                <p className="text-zinc-400 text-sm">좀비가 없습니다. 이상 없음.</p>
              )
            ) : attacked ? (
              <p className="text-red-400 font-bold text-base">💀 좀비의 공세를 이겨내지 못하였습니다!</p>
            ) : (
              <p className="text-green-400 font-bold text-base">🛡 좀비 방어에 성공하였습니다!</p>
            )}
          </div>
        )
      }

      // ── 이벤트 처리 / 트럭 수색 선택 ────────────────────────
      case 'event': {
        const preview = game!.itemSearchPreview
        const winnerId = game!.itemSearchWinnerId
        if (!preview || !winnerId) {
          return <p className="text-zinc-500 text-xs">이벤트 처리 중...</p>
        }

        const isWinner = uid === winnerId
        const winnerName = players[winnerId]?.nickname ?? '?'

        if (!isWinner) {
          return (
            <div className="text-center">
              <p className="text-lg mb-1">🚚</p>
              <p className="text-zinc-300 text-sm">
                <span className="font-bold text-white">{winnerName}</span>님이 트럭을 수색 중입니다...
              </p>
            </div>
          )
        }

        // 승자 UI: 덱 장수에 따라 분기
        const drawCount = preview.length  // 1, 2, 3
        const allOtherPlayers = game!.playerOrder.filter(id => id !== uid)
        const truckReturned = drawCount === 3
          ? preview.find(id => id !== truckKept && id !== truckGiven) ?? null
          : null
        const canSubmit = drawCount === 1
          ? true  // 1장: 바로 확정
          : drawCount === 2
            ? truckKept !== null && truckGiven !== null && truckGivenTo !== null && truckKept !== truckGiven
            : truckKept !== null && truckGiven !== null && truckGivenTo !== null && truckKept !== truckGiven

        const subtitle = drawCount === 1
          ? '트럭에 1장만 남았습니다 — 자동 획득'
          : drawCount === 2
            ? '1장 보관 · 1장 증정'
            : '1장 보관 · 1장 증정 · 1장 반환'

        async function handleTruckSubmit() {
          if (!canSubmit || !preview) return
          const kept = drawCount === 1 ? preview[0] : truckKept
          if (!kept) return
          setActionLoading(true)
          try {
            if (drawCount === 1) {
              await submitItemSearchChoice(roomCode, kept)
            } else if (drawCount === 2 && truckGiven && truckGivenTo) {
              await submitItemSearchChoice(roomCode, kept, truckGivenTo, truckGiven)
            } else if (drawCount === 3 && truckGiven && truckGivenTo && truckReturned) {
              await submitItemSearchChoice(roomCode, kept, truckGivenTo, truckGiven, truckReturned)
            }
            setTruckKept(null); setTruckGiven(null); setTruckGivenTo(null)
          } finally {
            setActionLoading(false)
          }
        }

        return (
          <div>
            <p className="text-white text-sm font-bold mb-1">🚚 트럭 수색</p>
            <p className="text-zinc-400 text-xs mb-3">{subtitle}</p>

            {/* 1장: 바로 확정 버튼만 */}
            {drawCount === 1 && (() => {
              const instanceId = preview[0]
              const itemId = instanceIdToItemId(instanceId)
              const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
              return (
                <div className="bg-green-900/40 border border-green-600 rounded-xl p-3 mb-4 flex items-center gap-3">
                  <span className="text-2xl">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                  <div>
                    <p className="text-white text-sm font-medium">{cfg?.name ?? itemId}</p>
                    <p className="text-zinc-400 text-xs">{cfg?.description ?? ''}</p>
                  </div>
                </div>
              )
            })()}

            {/* 2~3장: 보관/증정 선택 */}
            {drawCount >= 2 && (
              <div className="flex flex-col gap-2 mb-4">
                {preview.map(instanceId => {
                  const itemId = instanceIdToItemId(instanceId)
                  const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
                  const isKept = truckKept === instanceId
                  const isGiven = truckGiven === instanceId
                  const isReturned = drawCount === 3 && !isKept && !isGiven
                  return (
                    <div key={instanceId} className={`rounded-xl p-3 border transition-colors ${
                      isKept ? 'bg-green-900/50 border-green-500' :
                      isGiven ? 'bg-blue-900/50 border-blue-500' :
                      'bg-zinc-800 border-zinc-700'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                        <div>
                          <p className="text-white text-sm font-medium">{cfg?.name ?? itemId}</p>
                          <p className="text-zinc-400 text-xs">{cfg?.description ?? ''}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setTruckKept(instanceId); if (truckGiven === instanceId) setTruckGiven(null) }}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                            isKept ? 'bg-green-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                          }`}>
                          보관
                        </button>
                        <button
                          onClick={() => { setTruckGiven(instanceId); if (truckKept === instanceId) setTruckKept(null) }}
                          className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                            isGiven ? 'bg-blue-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                          }`}>
                          증정
                        </button>
                        {isReturned && (
                          <span className="text-xs text-zinc-500 px-2 py-1">반환 예정</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 증정 대상 선택 (2장 이상) */}
            {drawCount >= 2 && truckGiven && (
              <div className="mb-4">
                <p className="text-zinc-400 text-xs mb-2">증정할 플레이어 선택</p>
                <div className="flex flex-wrap gap-2">
                  {allOtherPlayers.map(pid => (
                    <button key={pid}
                      onClick={() => setTruckGivenTo(pid)}
                      className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                        truckGivenTo === pid
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                      }`}>
                      {players[pid]?.nickname ?? pid}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleTruckSubmit}
              disabled={!canSubmit || actionLoading}
              className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold py-2 rounded-xl text-sm transition-colors">
              {actionLoading ? '처리 중...' : '확정'}
            </button>
          </div>
        )
      }

      // ── 투표 ────────────────────────────────────────────────
      case 'voting': {
        if (!game!.currentVote) return <p className="text-zinc-400 text-sm">투표 준비 중...</p>
        const vote = game!.currentVote
        const voteZone = ZONE_CONFIGS[vote.zone]
        const voteTypeLabel = vote.type === 'zombie_attack' ? '좀비 공격' :
          vote.type === 'truck_search' ? '트럭 수색' : '보안관 선출'

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
          <button onClick={async () => {
            if (isHost) await deleteRoom(roomCode)
            onLeave()
          }} className="text-zinc-600 hover:text-white text-xs transition-colors">나가기</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 존 보드 */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl mx-auto">
            {ZONE_ORDER.map(renderZone)}
          </div>
          {/* 임시 보안관 공지 (초기 배치 중에만 표시) */}
          {game.phase === 'setup_place' && (
            <div className="max-w-2xl mx-auto mt-4 bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-4 py-2.5 text-center">
              <p className="text-yellow-300 text-sm">
                ⭐ <span className="font-bold">{players[sheriffId]?.nickname ?? '?'}</span>님이 임시 보안관으로 선택되었습니다
              </p>
            </div>
          )}

          {/* 보안관 주사위 결과 상시 표시 */}
          {uid === sheriffId && game.lastDiceRoll && game.phase !== 'roll_dice' && game.phase !== 'setup_place' && (
            <div className="max-w-2xl mx-auto mt-3 bg-zinc-900 border border-yellow-700 rounded-xl px-4 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-yellow-500 text-xs font-bold">🎲 이번 라운드 주사위</span>
              <div className="flex gap-1">
                {game.lastDiceRoll.dice.map((d, i) => (
                  <span key={i} className="w-7 h-7 bg-zinc-700 rounded-lg flex items-center justify-center text-sm font-bold text-white">{d}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 text-xs text-zinc-400">
                {Object.entries(game.lastDiceRoll.zombiesByZone).map(([z, count]) => (
                  <span key={z}>{ZONE_CONFIGS[z as ZoneName]?.displayName} +{count}🧟</span>
                ))}
              </div>
            </div>
          )}

          {/* 액션 패널 */}
          <div className="max-w-2xl mx-auto mt-4 bg-zinc-900 rounded-2xl p-4">
            {renderActionPanel()}
          </div>

          {/* 내 아이템 패널 */}
          {myItemIds.length > 0 && (
            <div className="max-w-2xl mx-auto mt-3 bg-zinc-900 rounded-2xl p-4">
              <p className="text-xs text-zinc-500 mb-2">내 아이템</p>
              <div className="flex flex-wrap gap-2">
                {myItemIds.map(instanceId => {
                  const itemId = instanceIdToItemId(instanceId)
                  const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
                  if (!cfg) return null
                  return (
                    <div key={instanceId}
                      title={cfg.description}
                      className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-2.5 py-1.5 cursor-default transition-colors">
                      <span className="text-sm">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                      <span className="text-xs font-medium text-white">{cfg.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 플레이어 사이드바 */}
        <div className="w-44 bg-zinc-900 border-l border-zinc-800 p-3 overflow-y-auto shrink-0">
          <p className="text-xs text-zinc-500 mb-3">플레이어</p>
          <div className="space-y-2">
            {game.playerOrder.map(playerId => {
              const player = players[playerId]
              const isSheriff = playerId === sheriffId
              const aliveChars = Object.values(game.characters)
                .filter(c => c.playerId === playerId && c.isAlive)
              const aliveCount = aliveChars.length
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
                  {/* 살아있는 캐릭터 */}
                  <div className="flex flex-wrap gap-1 mt-1 mb-1">
                    {aliveChars.map(c => {
                      const cfg = CHARACTER_CONFIGS[c.characterId]
                      const zoneCfg = ZONE_CONFIGS[c.zone]
                      return (
                        <span
                          key={c.id}
                          title={`${cfg?.name} — ${zoneCfg?.displayName}`}
                          className={`text-xs px-1.5 py-0.5 rounded font-medium bg-zinc-700 text-zinc-200`}
                        >
                          {cfg?.name ?? c.characterId}
                        </span>
                      )
                    })}
                    {aliveCount === 0 && (
                      <span className="text-xs text-zinc-600">전멸</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-600">{aliveCount}명 생존</span>
                    <div className="flex items-center gap-1">
                      {game.playerItemCounts[playerId] > 0 && (
                        <span className="text-xs text-zinc-500">
                          🎒{game.playerItemCounts[playerId]}
                        </span>
                      )}
                      {statusDot && (
                        <span className={`text-xs ${statusDot === '✓' ? 'text-green-400' : 'text-zinc-600'}`}>
                          {statusDot}
                        </span>
                      )}
                    </div>
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
