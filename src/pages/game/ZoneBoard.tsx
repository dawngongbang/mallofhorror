import {
  declareCharacter,
  selectDestination,
  patchGameState,
} from '../../firebase/gameService'
import { ZONE_CONFIGS, CHARACTER_CONFIGS, EVENT_ZONE_ORDER, DICE_TO_ZONE } from '../../engine/constants'
import { isZoneFull } from '../../engine/dice'
import { calcDefense } from '../../engine/combat'
import type { GameState, Player, ZoneName } from '../../engine/types'
import { ZONE_MAP_POSITIONS, COLOR_BG, CHAR_ICON } from './constants'
import { placeCharacter, startFirstRound } from '../../engine/setup'

const ZONE_ORDER: ZoneName[] = ['bathroom', 'clothing', 'toy', 'parking', 'security', 'supermarket']

interface ZoneBoardProps {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  roomCode: string
  transitCharIds: Set<string>
  hoveredZone: ZoneName | null
  setHoveredZone: (z: ZoneName | null) => void
  hoveredCharId: string | null
  setHoveredCharId: (id: string | null) => void
  selectedSetupCharId: string | null
  setupDiceTopReady: boolean
  actionLoading: boolean
  setActionLoading: (v: boolean) => void
  pendingSetupFromPos: React.MutableRefObject<{ charId: string; pos: { x: number; y: number } } | null>
  getHandCardPos: (cardIndex: number, totalCards: number) => { x: number; y: number }
  onDestinationPreSelect?: (zone: ZoneName) => void
}

export default function ZoneBoard({
  game,
  players,
  uid,
  roomCode,
  transitCharIds,
  hoveredZone,
  setHoveredZone,
  hoveredCharId,
  setHoveredCharId,
  selectedSetupCharId,
  setupDiceTopReady,
  actionLoading,
  setActionLoading,
  pendingSetupFromPos,
  getHandCardPos,
  onDestinationPreSelect,
}: ZoneBoardProps) {
  // Derived values
  const myUnplacedChars = uid
    ? Object.values(game.characters).filter(c =>
        c.playerId === uid &&
        c.isAlive &&
        c.zone === 'parking' &&
        !game.zones.parking.characterIds.includes(c.id)
      )
    : []

  const setupZoneOptions: ZoneName[] = (() => {
    if (!game.setupDiceRoll) return []
    const d = game.setupDiceRoll as [number, number]
    const z1 = DICE_TO_ZONE[d[0]], z2 = DICE_TO_ZONE[d[1]]
    const candidates = z1 === z2 ? [z1] : [z1, z2]
    const available = candidates.filter(z => !isZoneFull(z, game) && !game.zones[z].isClosed)
    return available.length > 0 ? available : ['parking' as ZoneName]
  })()

  const isMyTurnToPlace = game.setupPlacementOrder[0] === uid
  const myDeclaredCharId = game.characterDeclarations[uid ?? '']?.characterId

  // 좀비 주사위 결과 표시 가능 여부 (정식보안관 or CCTV 사용자)
  const sheriffId = game.playerOrder[game.sheriffIndex]
  const canSeeDice = !!game.lastDiceRoll && (
    (uid === sheriffId && game.isRealSheriff) ||
    (uid ? game.cctvViewers.includes(uid) : false)
  )
  // roll_dice/dice_reveal 중엔 아직 애니메이션 중이므로 구역 뱃지 숨김 (헤더 배너와 동일 기준)
  const incomingZombies: Partial<Record<ZoneName, number>> =
    canSeeDice && game.lastDiceRoll && !['roll_dice', 'dice_reveal'].includes(game.phase)
      ? game.lastDiceRoll.zombiesByZone as Partial<Record<ZoneName, number>>
      : {}
  const currentDeclarerId = game?.declarationOrder.find(pid => !game.characterDeclarations[pid]) ?? null
  const mySealedZone = game.sealedDestinations[uid ?? '']?.targetZone
  const myDestConfirmed = !!(uid && game.destinationStatus[uid])
  const myMovingChar = uid ? game.characterDeclarations[uid]?.characterId : undefined
  const myMovingCharData = myMovingChar ? game.characters[myMovingChar] : undefined

  async function handlePlaceCharacter(charInstanceId: string, zone: ZoneName) {
    if (!game || !charInstanceId || actionLoading) return
    // 이미 배치된 캐릭터(parking 아닌 구역)는 재배치 불가
    if (game.characters[charInstanceId]?.zone !== 'parking') return
    setActionLoading(true)
    const cardIndex = myUnplacedChars.findIndex(c => c.id === charInstanceId)
    if (cardIndex >= 0) {
      pendingSetupFromPos.current = { charId: charInstanceId, pos: getHandCardPos(cardIndex, myUnplacedChars.length) }
    }
    let next = placeCharacter(game, charInstanceId, zone)
    if (next.setupPlacementOrder.length === 0) next = startFirstRound(next)
    try {
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
    } finally { setActionLoading(false) }
  }

  async function handleDeclareCharacter(charInstanceId: string) {
    if (!uid || myDeclaredCharId || actionLoading) return
    if (currentDeclarerId !== uid) return
    setActionLoading(true)
    try {
      await declareCharacter(roomCode, {
        playerId: uid,
        characterId: charInstanceId,
        order: game!.declarationOrder.indexOf(uid),
        declaredAt: Date.now(),
      })
    } finally { setActionLoading(false) }
  }

  async function handleSelectDestination(zone: ZoneName) {
    if (!uid || myDestConfirmed || actionLoading) return
    setActionLoading(true)
    try { await selectDestination(roomCode, zone) }
    finally { setActionLoading(false) }
  }

  function renderZone(zoneName: ZoneName) {
    const zoneState = game!.zones[zoneName]
    const config = ZONE_CONFIGS[zoneName]
    const chars = zoneState.characterIds.map(id => game!.characters[id]).filter(Boolean).filter(c => !transitCharIds.has(c.id))
    const activeEventZone = EVENT_ZONE_ORDER[game!.currentEventZoneIndex]
    const isVotingZone = game!.phase === 'voting' && game!.currentVote?.zone === zoneName
    const isWeaponZone = game!.phase === 'weapon_use' && activeEventZone === zoneName
    const isAnnounceZone = game!.phase === 'zone_announce' && activeEventZone === zoneName
    const isEventZone = game!.phase === 'event' && activeEventZone === zoneName
    const isActiveZone = isVotingZone || isWeaponZone || isAnnounceZone || isEventZone

    const actualDefense = isActiveZone ? calcDefense(zoneName, game!) : null
    const isUnderAttackNow = actualDefense !== null && zoneState.zombies > actualDefense && zoneState.zombies > 0

    const phaseBadge = isVotingZone ? { label: '🗳️', cls: 'bg-red-600 text-white' }
      : isWeaponZone   ? { label: '⚔️', cls: 'bg-orange-500 text-white' }
      : isAnnounceZone ? { label: '📢', cls: 'bg-yellow-500 text-black' }
      : isEventZone    ? { label: '▶', cls: 'bg-zinc-600 text-white' }
      : null

    const pos = ZONE_MAP_POSITIONS[zoneName]

    const isMyTurnToSelect = game!.phase === 'character_select' && currentDeclarerId === uid && !myDeclaredCharId
    const isDestSelectable = game!.phase === 'destination_seal'
      && !myDestConfirmed
      && zoneName !== myMovingCharData?.zone
      && !zoneState.isClosed
    const isDestInvalid = game!.phase === 'destination_seal'
      && !myDestConfirmed
      && !isDestSelectable
    const isSelectedDest = game!.phase === 'destination_seal' && mySealedZone === zoneName
    const isHoveredDest = hoveredZone === zoneName && isDestSelectable

    const selectedIsUnplaced = !!selectedSetupCharId
      && game!.characters[selectedSetupCharId]?.zone === 'parking'
    const isSetupPlaceable = game!.phase === 'setup_place'
      && isMyTurnToPlace
      && !!game!.setupDiceRoll
      && setupDiceTopReady
      && selectedIsUnplaced
      && setupZoneOptions.includes(zoneName)
    const isSetupInvalid = game!.phase === 'setup_place'
      && isMyTurnToPlace
      && !!game!.setupDiceRoll
      && setupDiceTopReady
      && selectedIsUnplaced
      && !setupZoneOptions.includes(zoneName)
    const isHoveredSetup = hoveredZone === zoneName && isSetupPlaceable

    return (
      <div
        key={zoneName}
        style={{ left: pos.left, top: pos.top, width: pos.width ?? '29%' }}
        onClick={
          isDestSelectable ? () => onDestinationPreSelect ? onDestinationPreSelect(zoneName) : handleSelectDestination(zoneName)
          : isSetupPlaceable ? () => handlePlaceCharacter(selectedSetupCharId!, zoneName)
          : undefined
        }
        onMouseEnter={(isDestSelectable || isSetupPlaceable) ? () => setHoveredZone(zoneName) : undefined}
        onMouseLeave={() => setHoveredZone(null)}
        className={`absolute rounded-lg p-1.5 flex flex-col gap-1 text-xs backdrop-blur-sm transition-all z-10
          ${(isDestSelectable || isSetupPlaceable) ? 'cursor-pointer' : ''}
          ${zoneState.isClosed
            ? 'bg-zinc-950/85 opacity-70 ring-1 ring-zinc-700'
            : isSelectedDest  ? 'bg-blue-950/90 ring-2 ring-blue-400 z-20'
            : isHoveredDest || isHoveredSetup ? 'bg-blue-900/85 ring-2 ring-blue-400/70 z-20'
            : isDestInvalid || isSetupInvalid ? 'bg-red-950/60 ring-1 ring-red-800/60 opacity-70'
            : isVotingZone    ? 'bg-red-950/90 ring-2 ring-red-500 z-20'
            : isWeaponZone    ? 'bg-orange-950/90 ring-2 ring-orange-400 z-20'
            : isAnnounceZone  ? 'bg-yellow-950/90 ring-2 ring-yellow-400 z-20'
            : isEventZone     ? 'bg-zinc-900/90 ring-2 ring-yellow-600 z-20'
            : 'bg-zinc-950/80 ring-1 ring-zinc-700/60'}`}
      >
        {/* 구역명 + 상태 배지 */}
        <div className="flex items-center justify-between gap-0.5">
          <span className={`font-bold leading-tight truncate ${zoneState.isClosed ? 'text-zinc-500 line-through' : 'text-white'}`}>
            <span className="text-zinc-400 mr-0.5">{config.zoneNumber}</span>{config.displayName}
            {zoneState.isClosed && <span className="ml-1 text-red-600 no-underline not-italic">🔒</span>}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            {incomingZombies[zoneName] != null && (
              <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-yellow-900/80 text-yellow-300 border border-yellow-700/60">
                +{incomingZombies[zoneName]}🧟
              </span>
            )}
            {phaseBadge && (
              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${phaseBadge.cls}`}>{phaseBadge.label}</span>
            )}
          </div>
        </div>

        {/* 좀비 아이콘 */}
        <div className="flex flex-wrap gap-0 min-h-[18px] leading-none">
          {(() => {
            const total = zoneState.zombies
            const visible = Math.min(total, 9)
            const newCount = game!.lastSpawnedZones?.[zoneName] ?? 0
            const newStart = visible - Math.min(newCount, visible)
            return (
              <>
                {Array.from({ length: visible }).map((_, i) => {
                  const isNew = newCount > 0 && i >= newStart
                  return (
                    <span key={i} className={`text-base leading-none ${
                      isUnderAttackNow ? 'text-red-300' : isNew ? 'animate-pulse' : ''
                    }`} style={isNew && !isUnderAttackNow ? { filter: 'sepia(1) saturate(3) hue-rotate(20deg)' } : undefined}>🧟</span>
                  )
                })}
                {total > 9 && (
                  <span className="text-red-400 font-bold text-xs self-center ml-0.5">+{total - 9}</span>
                )}
                {total === 0 && (
                  <span className="text-zinc-600 text-[10px]">좀비 없음</span>
                )}
              </>
            )
          })()}
        </div>

        {/* 방어력 (활성 구역만) */}
        {actualDefense !== null && config.defenseLimit > 0 && (
          <div className={`text-[10px] font-semibold ${isUnderAttackNow ? 'text-red-400' : 'text-green-400'}`}>
            🛡 {actualDefense}/{config.defenseLimit}{isUnderAttackNow ? ' ⚠️습격' : ' ✓'}
          </div>
        )}
        {zoneName === 'parking' && isActiveZone && (
          <div className="text-[10px] text-red-400 font-semibold">⚠️ 항상 습격</div>
        )}

        {/* 캐릭터 토큰 */}
        <div className="flex flex-wrap gap-0.5 min-h-[18px]">
          {chars.map(char => {
            const owner = players[char.playerId]
            const charConfig = CHARACTER_CONFIGS[char.characterId]
            const isMovingPhase = ['character_select', 'destination_seal', 'destination_reveal', 'move_execute'].includes(game!.phase)
            const isMoving = isMovingPhase && game!.characterDeclarations[char.playerId]?.characterId === char.id
            const isHidden = !!(game!.hiddenCharacters?.[char.id])
            const isMyChar = char.playerId === uid && char.isAlive && !isHidden
            const isClickableChar = isMyTurnToSelect && isMyChar
            return (
              <div
                key={char.id}
                title={`${owner?.nickname ?? '?'} — ${charConfig?.name}${isHidden ? ' (숨음)' : ''}`}
                onClick={isClickableChar
                  ? (e) => { e.stopPropagation(); handleDeclareCharacter(char.id) }
                  : (e) => e.stopPropagation()
                }
                onMouseEnter={isClickableChar ? () => setHoveredCharId(char.id) : undefined}
                onMouseLeave={isClickableChar ? () => setHoveredCharId(null) : undefined}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all
                  ${isClickableChar ? 'cursor-pointer' : ''}
                  ${owner ? (COLOR_BG[owner.color] ?? 'bg-zinc-600') : 'bg-zinc-600'}
                  ${!char.isAlive ? 'opacity-20 text-white' : isHidden ? 'opacity-30 text-white border-dashed' : 'text-white'}
                  ${hoveredCharId === char.id ? 'scale-150 border-white shadow-lg z-10' : isMoving ? 'border-yellow-400' : isHidden ? 'border-purple-500' : 'border-zinc-600'}`}
              >
                {isHidden ? '🫥' : (CHAR_ICON[char.characterId] ?? charConfig?.name?.charAt(0) ?? '?')}
              </div>
            )
          })}
          {chars.filter(c => c.isAlive).length > 0 && (() => {
            const aliveCount = chars.filter(c => c.isAlive).length
            const isFull = config.maxCapacity !== Infinity && aliveCount >= config.maxCapacity
            return (
              <span className={`text-[10px] self-center ml-0.5 font-semibold ${isFull ? 'text-red-400' : 'text-zinc-500'}`}>
                {aliveCount}/{config.maxCapacity === Infinity ? '∞' : config.maxCapacity}
              </span>
            )
          })()}
        </div>

        {/* 주차장 트럭 */}
        {zoneName === 'parking' && (
          <div className="text-zinc-400 flex items-center gap-0.5">
            <span>🚚</span>
            <span>{game!.itemDeck.length}장</span>
          </div>
        )}
      </div>
    )
  }

  return <>{ZONE_ORDER.map(renderZone)}</>
}
