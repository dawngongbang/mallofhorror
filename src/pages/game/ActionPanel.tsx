import { useEffect, useRef, useState } from 'react'
import {
  declareCharacter,
  selectDestination,
  confirmDestination,
  selectVote,
  confirmVote,
  patchGameState,
  submitItemSearchChoice,
  submitSheriffRollRequest,
  submitVictimChoice,
  submitWeaponConfirm,
  submitWeaponUsePass,
  submitZombiePlayerZoneChoice,
} from '../../firebase/gameService'
import { rollAndGetPlacementOptions } from '../../engine/setup'
import { determineSurvivorEvent } from '../../engine/event'
import { calcDefense, isUnderAttack } from '../../engine/combat'
import { EVENT_ZONE_ORDER, ZONE_CONFIGS, CHARACTER_CONFIGS, ITEM_CONFIGS, DICE_TO_ZONE } from '../../engine/constants'
import { isZoneFull } from '../../engine/dice'
import type { GameState, Player, ZoneName } from '../../engine/types'
import {
  instanceIdToItemId, PHASE_LABEL, COLOR_BG, ITEM_CATEGORY,
} from './constants'

const ZONE_ORDER: ZoneName[] = ['bathroom', 'clothing', 'toy', 'parking', 'security', 'supermarket']

interface ActionPanelProps {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  roomCode: string
  actionLoading: boolean
  setActionLoading: (v: boolean) => void
  // Staged item state (also read by hand cards in GamePage)
  stagedWeapons: Set<string>
  setStagedWeapons: React.Dispatch<React.SetStateAction<Set<string>>>
  stagedHideItemId: string | null
  setStagedHideItemId: (id: string | null) => void
  stagedHideCharId: string | null
  setStagedHideCharId: (id: string | null) => void
  stagedSprintItemId: string | null
  setStagedSprintItemId: (id: string | null) => void
  stagedSprintCharId: string | null
  setStagedSprintCharId: (id: string | null) => void
  stagedSprintTargetZone: ZoneName | null
  setStagedSprintTargetZone: (z: ZoneName | null) => void
  stagedHardwareItemId: string | null
  setStagedHardwareItemId: (id: string | null) => void
  // Hover state (shared with ZoneBoard via GamePage)
  hoveredCharId: string | null
  setHoveredCharId: (id: string | null) => void
  // Additional state needed for setup_place and destination_seal panels
  selectedSetupCharId: string | null
  hoveredZone: ZoneName | null
  setHoveredZone: (z: ZoneName | null) => void
  onLeave: () => void
  myItemIds: string[]
}

export default function ActionPanel({
  game,
  players,
  uid,
  roomCode,
  actionLoading,
  setActionLoading,
  stagedWeapons,
  stagedHideItemId,
  setStagedHideItemId,
  stagedHideCharId,
  setStagedHideCharId,
  stagedSprintItemId,
  setStagedSprintItemId,
  stagedSprintCharId,
  setStagedSprintCharId,
  stagedSprintTargetZone,
  setStagedSprintTargetZone,
  stagedHardwareItemId,
  setHoveredCharId,
  selectedSetupCharId,
  hoveredZone,
  setHoveredZone,
  onLeave,
  myItemIds,
}: ActionPanelProps) {
  // Truck search local state (owned here — not read by hand cards)
  const [truckKept, setTruckKept] = useState<string | null>(null)
  const [truckGiven, setTruckGiven] = useState<string | null>(null)
  const [truckGivenTo, setTruckGivenTo] = useState<string | null>(null)

  // 주사위 애니메이션 state
  const [diceAnim, setDiceAnim] = useState<number[] | null>(null)
  const lastDiceKey = useRef('')

  useEffect(() => {
    if (game?.phase !== 'dice_reveal' || !game.lastDiceRoll || uid !== game.playerOrder[game.sheriffIndex] || !game.isRealSheriff) return
    const key = game.lastDiceRoll.dice.join(',')
    if (lastDiceKey.current === key) return
    lastDiceKey.current = key
    const real = game.lastDiceRoll.dice
    let tick = 0
    setDiceAnim(real.map(() => Math.ceil(Math.random() * 6)))
    const timer = setInterval(() => {
      tick++
      if (tick >= 14) { clearInterval(timer); setDiceAnim(null) }
      else setDiceAnim(real.map(() => Math.ceil(Math.random() * 6)))
    }, 80)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, game?.lastDiceRoll])

  // Derived values
  const sheriffId = game.playerOrder[game.sheriffIndex]
  const currentSetupPlayerId = game.setupPlacementOrder[0] ?? null
  const isMyTurnToPlace = currentSetupPlayerId === uid

  const setupZoneOptions: ZoneName[] = (() => {
    if (!game.setupDiceRoll) return []
    const d = game.setupDiceRoll as [number, number]
    const z1 = DICE_TO_ZONE[d[0]], z2 = DICE_TO_ZONE[d[1]]
    const candidates = z1 === z2 ? [z1] : [z1, z2]
    const available = candidates.filter(z => !isZoneFull(z, game) && !game.zones[z].isClosed)
    return available.length > 0 ? available : ZONE_ORDER.filter(z => !isZoneFull(z, game) && !game.zones[z].isClosed)
  })()

  const myDeclaredCharId = game.characterDeclarations[uid ?? '']?.characterId
  const myAliveChars = uid
    ? Object.values(game.characters).filter(c => c.playerId === uid && c.isAlive)
    : []
  const currentDeclarerId = game?.declarationOrder.find(pid => !game.characterDeclarations[pid]) ?? null
  const mySealedZone = game.sealedDestinations[uid ?? '']?.targetZone
  const myDestConfirmed = !!(uid && game.destinationStatus[uid])
  const myMovingChar = uid ? game.characterDeclarations[uid]?.characterId : undefined
  const myMovingCharData = myMovingChar ? game.characters[myMovingChar] : undefined
  const myVote = uid && game.currentVote ? game.currentVote.votes[uid] : undefined
  const myVoteConfirmed = !!(uid && game.currentVote?.status[uid])

  // ── Handlers ──────────────────────────────────────────────────

  async function handleRollSetup() {
    if (!game || actionLoading) return
    setActionLoading(true)
    try {
      const { state: next } = rollAndGetPlacementOptions(game)
      await patchGameState(roomCode, { setupDiceRoll: next.setupDiceRoll })
    } finally { setActionLoading(false) }
  }

  async function handleRollDice() {
    if (!game || actionLoading) return
    setActionLoading(true)
    try { await submitSheriffRollRequest(roomCode) }
    finally { setActionLoading(false) }
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

  async function handleConfirmDestination() {
    if (!uid || !mySealedZone || myDestConfirmed || actionLoading) return
    setActionLoading(true)
    try { await confirmDestination(roomCode) }
    finally { setActionLoading(false) }
  }

  async function handleSelectVote(targetPlayerId: string) {
    if (!uid || !game?.currentVote || myVoteConfirmed || actionLoading) return
    setActionLoading(true)
    try { await selectVote(roomCode, targetPlayerId) }
    finally { setActionLoading(false) }
  }

  async function handleConfirmVote() {
    if (!uid || !myVote || myVoteConfirmed || actionLoading) return
    setActionLoading(true)
    try { await confirmVote(roomCode) }
    finally { setActionLoading(false) }
  }

  async function handleWeaponConfirm() {
    if (actionLoading) return
    setActionLoading(true)
    try {
      const staged = [...stagedWeapons]
      const hideItemId = stagedHideItemId
      const sprintItemId = stagedSprintItemId
      const hardwareItemId = stagedHardwareItemId

      let resolvedHideCharId = stagedHideCharId
      if (hideItemId && !resolvedHideCharId && game) {
        const zone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
        resolvedHideCharId = game.zones[zone]?.characterIds.find(
          id => game.characters[id]?.playerId === uid && game.characters[id]?.isAlive
        ) ?? null
      }

      const allStaged = [
        ...staged,
        ...(hideItemId ? [hideItemId] : []),
        ...(sprintItemId ? [sprintItemId] : []),
        ...(hardwareItemId ? [hardwareItemId] : []),
      ]

      const hasActions = allStaged.length > 0 || resolvedHideCharId || stagedSprintCharId
      if (!hasActions) {
        await submitWeaponUsePass(roomCode)
      } else {
        const totalKill = staged.reduce((sum, id) => {
          const iid = id.split('_').slice(0, -1).join('_')
          return sum + (ITEM_CONFIGS[iid as keyof typeof ITEM_CONFIGS]?.zombieKill ?? 0)
        }, 0)
        const sprintChoice = (stagedSprintCharId && stagedSprintTargetZone)
          ? { charId: stagedSprintCharId, targetZone: stagedSprintTargetZone }
          : null
        await submitWeaponConfirm(
          roomCode, allStaged, totalKill, myItemIds,
          resolvedHideCharId, sprintChoice, hardwareItemId ? 1 : 0
        )
      }
    } finally {
      setActionLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────

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

      const d = game!.setupDiceRoll as [number, number]
      return (
        <div className="text-center">
          <p className="text-xs text-zinc-500">
            🎲 {d[0]}, {d[1]} →{' '}
            <span className="text-yellow-400">{setupZoneOptions.map(z => ZONE_CONFIGS[z].displayName).join(' 또는 ')}</span>
          </p>
          <p className="text-zinc-500 text-xs mt-1">
            {selectedSetupCharId
              ? `${CHARACTER_CONFIGS[game!.characters[selectedSetupCharId]?.characterId]?.name} 선택됨 — 맵에서 구역을 클릭하세요`
              : '맵 하단 카드에서 캐릭터를 선택하세요'}
          </p>
        </div>
      )
    }

    // ── 주사위 결과 공개 ────────────────────────────────────
    case 'dice_reveal': {
      const isZombiePlayerDR = uid ? Object.values(game!.characters)
        .filter(c => c.playerId === uid).length > 0
        && Object.values(game!.characters)
        .filter(c => c.playerId === uid).every(c => !c.isAlive)
        : false
      const myZombieChoiceDR = uid ? (game!.zombiePlayerZoneChoices ?? {})[uid] : undefined
      const zombieSelectorDR = isZombiePlayerDR && !myZombieChoiceDR && (
        <div className="mt-3">
          <p className="text-red-400 text-xs font-bold mb-1">🧟 나타날 구역을 선택하세요!</p>
          <div className="flex flex-wrap gap-1 justify-center">
            {(Object.keys(game!.zones) as ZoneName[])
              .filter(z => !game!.zones[z].isClosed)
              .map(z => (
                <button key={z} onClick={async () => {
                  setActionLoading(true)
                  try { await submitZombiePlayerZoneChoice(roomCode, z) }
                  finally { setActionLoading(false) }
                }} disabled={actionLoading}
                  className="text-xs bg-zinc-700 hover:bg-red-800 text-zinc-300 hover:text-white px-2 py-1 rounded transition-colors">
                  {ZONE_CONFIGS[z].displayName}
                </button>
              ))}
          </div>
        </div>
      )

      if (uid !== sheriffId || !game!.isRealSheriff) {
        return (
          <div className="text-center">
            <p className="text-zinc-400 text-sm">보안관이 주사위 결과를 확인 중...</p>
            <p className="text-zinc-600 text-xs mt-1">잠시 후 이동 페이즈가 시작됩니다</p>
            {zombieSelectorDR}
          </div>
        )
      }
      const roll = game!.lastDiceRoll
      if (!roll) return <p className="text-zinc-400 text-sm">주사위 결과 로딩 중...</p>
      return (
        <div className="text-center">
          <p className="text-sm font-bold text-white mb-3">🎲 주사위 결과 (보안관만 확인 가능)</p>
          <div className="flex justify-center gap-2 mb-3">
            {(diceAnim ?? roll.dice).map((d, i) => (
              <div key={`${i}-${d}`} className="dice-roll w-10 h-10 bg-zinc-700 rounded-xl flex items-center justify-center text-xl font-bold text-white">
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
          <p className="text-zinc-500 text-xs">보너스 좀비(사람/미녀 최다)는 이동 완료 후 결정됩니다</p>
          <p className="text-zinc-600 text-xs mt-3">잠시 후 이동 페이즈가 시작됩니다...</p>
          {zombieSelectorDR}
        </div>
      )
    }

    // ── 주사위 (2라운드~) ────────────────────────────────────
    case 'roll_dice': {
      const isSheriff = uid === sheriffId
      const isZombiePlayer = uid ? Object.values(game!.characters)
        .filter(c => c.playerId === uid).length > 0
        && Object.values(game!.characters)
        .filter(c => c.playerId === uid).every(c => !c.isAlive)
        : false
      const myZombieChoice = uid ? (game!.zombiePlayerZoneChoices ?? {})[uid] : undefined

      const zombieZoneSelector = isZombiePlayer && (
        <div className="mt-3">
          <p className="text-red-400 text-xs font-bold mb-1">🧟 좀비가 된 당신! 나타날 구역을 선택하세요.</p>
          {myZombieChoice ? (
            <p className="text-green-400 text-xs">✓ {ZONE_CONFIGS[myZombieChoice]?.displayName} 선택 완료</p>
          ) : (
            <div className="flex flex-wrap gap-1 justify-center">
              {(Object.keys(game!.zones) as ZoneName[])
                .filter(z => !game!.zones[z].isClosed)
                .map(z => (
                  <button key={z} onClick={async () => {
                    setActionLoading(true)
                    try { await submitZombiePlayerZoneChoice(roomCode, z) }
                    finally { setActionLoading(false) }
                  }} disabled={actionLoading}
                    className="text-xs bg-zinc-700 hover:bg-red-800 text-zinc-300 hover:text-white px-2 py-1 rounded transition-colors">
                    {ZONE_CONFIGS[z].displayName}
                  </button>
                ))}
            </div>
          )}
        </div>
      )

      if (!isSheriff) {
        return (
          <div className="text-center">
            <p className="text-zinc-400 text-sm">
              보안관 <span className="text-white font-bold">{players[sheriffId]?.nickname}</span>이 주사위를 굴리는 중...
            </p>
            {zombieZoneSelector}
          </div>
        )
      }
      return (
        <div className="text-center">
          <button onClick={handleRollDice} disabled={actionLoading}
            className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-bold px-8 py-3 rounded-xl text-sm transition-colors">
            {actionLoading ? '처리 중...' : '🎲 좀비 주사위 굴리기'}
          </button>
          {zombieZoneSelector}
        </div>
      )
    }

    // ── 캐릭터 선언 ─────────────────────────────────────────
    case 'character_select': {
      const declaredCount = Object.keys(game!.characterDeclarations).length
      const total = game!.declarationOrder.length

      return (
        <div>
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

          {myDeclaredCharId && currentDeclarerId && (
            <p className="text-zinc-400 text-sm">
              <span className="text-white font-bold">{players[currentDeclarerId]?.nickname}</span>님이 선택 중...
            </p>
          )}

          {!myDeclaredCharId && currentDeclarerId === uid && (
            <div>
              <p className="text-white text-sm font-bold mb-2">내 차례 — 이동할 캐릭터 선택</p>
              <div className="flex gap-2 flex-wrap">
                {myAliveChars.map(char => {
                  const charConfig = CHARACTER_CONFIGS[char.characterId]
                  return (
                    <button key={char.id}
                      onClick={() => handleDeclareCharacter(char.id)}
                      onMouseEnter={() => setHoveredCharId(char.id)}
                      onMouseLeave={() => setHoveredCharId(null)}
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
      const confirmedCount = Object.values(game!.destinationStatus).filter(Boolean).length
      const total = game!.playerOrder.length

      return (
        <div>
          <div className="mb-2">
            <p className="text-white text-sm font-bold">목적지 선택</p>
          </div>
          {myMovingCharData && (
            <p className="text-zinc-400 text-xs mb-2">
              이동 캐릭터: <span className="text-yellow-400">{CHARACTER_CONFIGS[myMovingCharData.characterId]?.name}</span>
              {' '}({ZONE_CONFIGS[myMovingCharData.zone].displayName} → ?)
            </p>
          )}
          {myDestConfirmed ? (
            <p className="text-green-400 text-sm font-bold">✓ 확정 완료 — {mySealedZone ? ZONE_CONFIGS[mySealedZone].displayName : '이동 없음'}</p>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap mb-3">
                {ZONE_ORDER.filter(z => z !== myMovingCharData?.zone && !game!.zones[z].isClosed).map(zone => (
                  <button key={zone}
                    onClick={() => handleSelectDestination(zone)}
                    onMouseEnter={() => setHoveredZone(zone)}
                    onMouseLeave={() => setHoveredZone(null)}
                    disabled={actionLoading}
                    className={`text-white text-sm px-3 py-1.5 rounded-lg transition-colors ${
                      mySealedZone === zone
                        ? 'bg-blue-600 ring-2 ring-blue-400'
                        : hoveredZone === zone
                        ? 'bg-blue-700'
                        : 'bg-zinc-700 hover:bg-blue-700'
                    }`}>
                    {ZONE_CONFIGS[zone].displayName}
                  </button>
                ))}
              </div>
              {mySealedZone ? (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-xs">선택: <span className="text-yellow-300 font-medium">{ZONE_CONFIGS[mySealedZone].displayName}</span></span>
                  <button onClick={handleConfirmDestination} disabled={actionLoading}
                    className="bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
                    확정
                  </button>
                </div>
              ) : (
                <p className="text-zinc-600 text-xs">구역을 선택하세요</p>
              )}
            </>
          )}
          <p className="text-zinc-600 text-xs mt-2">{confirmedCount} / {total}명 확정</p>
        </div>
      )
    }

    // ── 이동 단계별 공지 ─────────────────────────────────────
    case 'destination_reveal':
    case 'move_execute': {
      const moves = game!.resolvedMoves
      const step = game!.currentMoveStep
      const doneMoves = moves.slice(0, step)
      const currentMove = moves[step] ?? null

      return (
        <div>
          <p className="text-zinc-500 text-xs mb-2">이동 공개 ({step}/{moves.length})</p>
          {doneMoves.map((m, i) => {
            const charConf = CHARACTER_CONFIGS[game!.characters[m.characterId]?.characterId]
            const pName = players[m.playerId]?.nickname ?? m.playerId
            const toName = ZONE_CONFIGS[m.targetZone]?.displayName ?? m.targetZone
            const fromName = ZONE_CONFIGS[m.fromZone]?.displayName ?? m.fromZone
            return (
              <div key={i} className="text-xs text-zinc-500 mb-1">
                <span className="text-zinc-400">{pName}의 {charConf?.name}</span>
                {m.bumpedToParking
                  ? <> {fromName}→<span className="text-red-400">{toName}(주차장)</span> ✗</>
                  : <> {fromName}→<span className="text-green-400">{toName}</span> ✓</>
                }
              </div>
            )
          })}
          {currentMove && (() => {
            const charConf = CHARACTER_CONFIGS[game!.characters[currentMove.characterId]?.characterId]
            const pName = players[currentMove.playerId]?.nickname ?? currentMove.playerId
            const intendedName = ZONE_CONFIGS[currentMove.intendedZone]?.displayName ?? currentMove.intendedZone
            const fromName = ZONE_CONFIGS[currentMove.fromZone]?.displayName ?? currentMove.fromZone
            return (
              <div className="bg-zinc-800 rounded-lg p-2 mt-1">
                <p className="text-white text-sm font-bold">
                  {pName}의 <span className="text-yellow-400">{charConf?.name}</span>
                </p>
                <p className="text-zinc-300 text-xs mt-0.5">
                  {fromName} → {intendedName} 이동 중...
                </p>
              </div>
            )
          })()}
          {!currentMove && moves.length > 0 && (
            <p className="text-zinc-400 text-xs mt-1">이동 완료. 좀비 배치 중...</p>
          )}
          {moves.length === 0 && (
            <p className="text-zinc-500 text-xs">이동할 캐릭터가 없습니다.</p>
          )}
        </div>
      )
    }

    // ── 좀비 순차 배치 공지 ──────────────────────────────────
    case 'zombie_spawn': {
      const batches = game!.zombieSpawnBatches ?? []
      const step = game!.zombieSpawnStep
      const currentBatch = batches[step] ?? null
      return (
        <div>
          <p className="text-zinc-500 text-xs mb-2">🧟 좀비 배치 중... ({step + 1}/{batches.length})</p>
          {currentBatch && (() => {
            if (currentBatch.type === 'dice') {
              const lines = Object.entries(currentBatch.zones).map(([zone, cnt]) =>
                `${ZONE_CONFIGS[zone as ZoneName]?.displayName} +${cnt}마리`
              )
              return (
                <div className="bg-zinc-800 rounded-lg p-2">
                  <p className="text-white text-sm font-bold mb-1">🎲 주사위 결과</p>
                  {lines.map((l, i) => <p key={i} className="text-zinc-300 text-xs">{l}</p>)}
                </div>
              )
            }
            if (currentBatch.type === 'crowded') {
              return (
                <div className="bg-zinc-800 rounded-lg p-2">
                  <p className="text-white text-sm font-bold">👥 사람이 제일 많은 구역</p>
                  <p className="text-red-300 text-xs mt-0.5">{ZONE_CONFIGS[currentBatch.zone].displayName}에 좀비가 나타났습니다!</p>
                </div>
              )
            }
            if (currentBatch.type === 'belle') {
              return (
                <div className="bg-zinc-800 rounded-lg p-2">
                  <p className="text-white text-sm font-bold">💄 미녀가 제일 많은 구역</p>
                  <p className="text-red-300 text-xs mt-0.5">{ZONE_CONFIGS[currentBatch.zone].displayName}에 좀비가 나타났습니다!</p>
                </div>
              )
            }
            if (currentBatch.type === 'zombie_player') {
              const pName = players[currentBatch.playerId]?.nickname ?? currentBatch.playerId
              return (
                <div className="bg-zinc-800 rounded-lg p-2">
                  <p className="text-red-400 text-sm font-bold">🧟 좀비가 된 {pName}님</p>
                  <p className="text-zinc-300 text-xs mt-0.5">{ZONE_CONFIGS[currentBatch.zone].displayName}에 나타났습니다!</p>
                </div>
              )
            }
            return null
          })()}
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
      const deathResult = game!.lastZombieAttackResult?.zone === zone ? game!.lastZombieAttackResult : null

      return (
        <div className="text-center">
          <p className="text-xs text-zinc-500 mb-1">이벤트 ({zoneIdx + 1}/6)</p>
          <p className="text-lg font-bold text-white mb-3">
            #{config.zoneNumber} {config.displayName}
            {zoneState.isClosed && <span className="ml-2 text-sm text-red-500">🔒 폐쇄</span>}
          </p>

          {deathResult && (() => {
            const deadChar = game!.characters[deathResult.deadCharacterId]
            const deadCharConf = deadChar ? CHARACTER_CONFIGS[deadChar.characterId] : null
            const deadPlayerName = players[deathResult.deadPlayerId]?.nickname ?? deathResult.deadPlayerId
            return (
              <div className="bg-red-950 border border-red-700 rounded-lg px-3 py-2 mb-3 text-center">
                <p className="text-red-300 font-bold text-sm">
                  💀 {deadPlayerName}의 {deadCharConf?.name ?? '캐릭터'}가 사망하였습니다.
                </p>
                <p className="text-zinc-400 text-xs mt-0.5">좀비들이 새로운 목표를 찾아 떠납니다.</p>
              </div>
            )
          })()}

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

    // ── 아이템 사용 ───────────────────────────────────────────
    case 'weapon_use': {
      const zone = EVENT_ZONE_ORDER[game!.currentEventZoneIndex]
      const config = ZONE_CONFIGS[zone]
      const zoneState = game!.zones[zone]
      const defense = calcDefense(zone, game!)

      const myCharsInZone = zoneState.characterIds.filter(
        id => game!.characters[id]?.playerId === uid && game!.characters[id]?.isAlive
      )
      const amInZone = myCharsInZone.length > 0

      return (
        <div className="text-center">
          <p className="text-xs text-zinc-500 mb-1">아이템 사용 기회</p>
          <p className="text-lg font-bold text-white mb-1">
            #{config.zoneNumber} {config.displayName}
          </p>
          <div className="flex justify-center gap-4 mb-3 text-sm text-zinc-300">
            <span>🧟 좀비 <strong className="text-red-400">{zoneState.zombies}</strong></span>
            <span>🛡 방어 <strong className="text-white">{defense}</strong></span>
          </div>
          <p className="text-red-400 font-bold mb-3">⚠️ 좀비가 습격합니다!</p>
          {amInZone ? (
            game!.weaponUseStatus[uid ?? ''] ? (
              <p className="text-green-400 text-sm font-bold">✓ 완료 — 다른 플레이어 대기 중...</p>
            ) : (
              <div>
                <p className="text-yellow-300 text-sm mb-2">손패에서 무기·아이템을 선택하세요.</p>
                {stagedWeapons.size > 0 && (
                  <p className="text-green-400 text-xs mb-1">무기 {stagedWeapons.size}장 선택됨</p>
                )}
                {stagedSprintItemId && (() => {
                  const myCharsInZoneSprint = game!.zones[zone]?.characterIds
                    .filter(id => game!.characters[id]?.playerId === uid && game!.characters[id]?.isAlive
                      && !game!.hiddenCharacters?.[id]) ?? []
                  const availableZones = (Object.keys(ZONE_CONFIGS) as ZoneName[]).filter(z => {
                    if (z === zone) return false
                    const cfg = ZONE_CONFIGS[z]
                    if (cfg.maxCapacity === Infinity) return true
                    return game!.zones[z].characterIds.filter(id => game!.characters[id]?.isAlive).length < cfg.maxCapacity
                  })
                  return (
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-cyan-300 text-xs font-bold">👟 스프린트 — 이동할 캐릭터:</p>
                        <button onClick={() => { setStagedSprintItemId(null); setStagedSprintCharId(null); setStagedSprintTargetZone(null) }}
                          className="text-xs text-zinc-500 hover:text-red-400 transition-colors">취소</button>
                      </div>
                      <div className="flex gap-1 flex-wrap justify-center mb-1">
                        {myCharsInZoneSprint.map(charId => {
                          const char = game!.characters[charId]
                          const cfg = CHARACTER_CONFIGS[char?.characterId]
                          return (
                            <button key={charId} onClick={() => setStagedSprintCharId(charId)}
                              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                stagedSprintCharId === charId
                                  ? 'bg-cyan-700 border-cyan-400 text-white font-bold'
                                  : 'bg-zinc-700 border-zinc-500 text-zinc-300 hover:border-cyan-400'
                              }`}>
                              {cfg?.name ?? charId}
                            </button>
                          )
                        })}
                      </div>
                      {stagedSprintCharId && (
                        <div className="flex gap-1 flex-wrap justify-center">
                          {availableZones.map(z => (
                            <button key={z} onClick={() => setStagedSprintTargetZone(z)}
                              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                stagedSprintTargetZone === z
                                  ? 'bg-cyan-700 border-cyan-400 text-white font-bold'
                                  : 'bg-zinc-700 border-zinc-500 text-zinc-300 hover:border-cyan-400'
                              }`}>
                              {ZONE_CONFIGS[z].displayName}
                            </button>
                          ))}
                        </div>
                      )}
                      {stagedSprintCharId && stagedSprintTargetZone && (
                        <p className="text-cyan-400 text-xs mt-1">
                          {CHARACTER_CONFIGS[game!.characters[stagedSprintCharId]?.characterId]?.name} → {ZONE_CONFIGS[stagedSprintTargetZone].displayName} ✓
                        </p>
                      )}
                    </div>
                  )
                })()}
                {stagedHideItemId && (() => {
                  const myCharsInZoneHide = game!.zones[zone]?.characterIds
                    .filter(id => game!.characters[id]?.playerId === uid && game!.characters[id]?.isAlive) ?? []
                  return (
                    <div className="mb-2">
                      {myCharsInZoneHide.length <= 1 ? (
                        <p className="text-purple-300 text-xs">
                          🫥 <strong>{CHARACTER_CONFIGS[game!.characters[myCharsInZoneHide[0]]?.characterId]?.name ?? '?'}</strong> 숨김 예정
                        </p>
                      ) : (
                        <div>
                          <p className="text-purple-300 text-xs mb-1">🫥 숨길 캐릭터 선택:</p>
                          <div className="flex gap-2 flex-wrap justify-center">
                            {myCharsInZoneHide.map(charId => {
                              const char = game!.characters[charId]
                              const cfg = CHARACTER_CONFIGS[char?.characterId]
                              return (
                                <button key={charId}
                                  onClick={() => setStagedHideCharId(charId)}
                                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                    stagedHideCharId === charId
                                      ? 'bg-purple-700 border-purple-400 text-white font-bold'
                                      : 'bg-zinc-700 border-zinc-500 text-zinc-300 hover:border-purple-400'
                                  }`}>
                                  {cfg?.name ?? charId}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <button onClick={() => { setStagedHideItemId(null); setStagedHideCharId(null) }}
                        className="text-xs text-zinc-500 hover:text-red-400 mt-1 transition-colors">
                        숨기 취소
                      </button>
                    </div>
                  )
                })()}
                <button
                  onClick={handleWeaponConfirm}
                  disabled={actionLoading || (!!stagedHideItemId && !stagedHideCharId && (() => {
                    const myCharsInZoneCheck = game!.zones[zone]?.characterIds
                      .filter(id => game!.characters[id]?.playerId === uid && game!.characters[id]?.isAlive) ?? []
                    return myCharsInZoneCheck.length > 1
                  })())}
                  className="text-sm bg-zinc-600 hover:bg-zinc-500 text-white font-bold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  완료
                </button>
              </div>
            )
          ) : (
            <p className="text-zinc-500 text-sm">해당 구역 플레이어들이 아이템 사용 중...</p>
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

      const drawCount = preview.length
      const allOtherPlayers = game!.playerOrder.filter(id => id !== uid)
      const truckReturned = drawCount === 3
        ? preview.find(id => id !== truckKept && id !== truckGiven) ?? null
        : null
      const canSubmit = drawCount === 1
        ? true
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
      const pvs = game!.pendingVictimSelection
      if (pvs && !pvs.chosenCharacterId) {
        const isLoser = uid === pvs.loserPlayerId
        if (isLoser) {
          const myCharsInZone = Object.values(game!.characters).filter(
            c => c.playerId === uid && c.isAlive
              && game!.zones[pvs.zone].characterIds.includes(c.id)
              && !game!.hiddenCharacters?.[c.id]
          )
          return (
            <div>
              <p className="text-red-400 font-bold text-sm mb-2">
                💀 {ZONE_CONFIGS[pvs.zone].displayName} — 희생할 캐릭터를 선택하세요
              </p>
              <div className="flex gap-2 flex-wrap">
                {myCharsInZone.map(c => (
                  <button key={c.id} onClick={async () => {
                    setActionLoading(true)
                    try {
                      console.log('[VICTIM] submitting choice:', c.id)
                      await submitVictimChoice(roomCode, c.id)
                      console.log('[VICTIM] submitted OK')
                    } catch (err) {
                      console.error('[VICTIM] submit error:', err)
                    } finally {
                      setActionLoading(false)
                    }
                  }} disabled={actionLoading}
                    className="bg-zinc-700 hover:bg-red-800 text-white px-3 py-2 rounded-xl text-sm transition-colors">
                    {CHARACTER_CONFIGS[c.characterId]?.name ?? c.characterId}
                  </button>
                ))}
              </div>
            </div>
          )
        }
        return (
          <p className="text-zinc-400 text-sm">
            <span className="text-white font-bold">{players[pvs.loserPlayerId]?.nickname}</span>이 희생할 캐릭터를 선택 중...
          </p>
        )
      }

      if (!game!.currentVote) return <p className="text-zinc-400 text-sm">투표 준비 중...</p>
      const vote = game!.currentVote
      const voteZone = ZONE_CONFIGS[vote.zone]
      const voteTypeLabel = vote.type === 'zombie_attack' ? '좀비 공격' :
        vote.type === 'truck_search' ? '트럭 수색' : '보안관 선출'

      const candidates = (vote.candidates ?? []).map(id => ({
        id,
        nickname: players[id]?.nickname ?? '?',
        color: players[id]?.color ?? 'red',
      }))

      const eligibleVoters = vote.eligibleVoters ?? []
      const confirmedCount = eligibleVoters.filter(id => vote.status[id]).length
      const canVote = eligibleVoters.includes(uid ?? '')

      const announce = game!.lastVoteAnnounce
      if (announce) {
        const sortedTally = Object.entries(announce.tally)
          .sort(([, a], [, b]) => b - a)
        const maxVotes = sortedTally[0]?.[1] ?? 0

        return (
          <div>
            <p className="text-sm text-zinc-400 mb-3">
              <span className="text-yellow-400 font-bold">{voteZone.displayName}</span> — {voteTypeLabel} 결과
            </p>

            <div className="space-y-1 mb-3">
              {eligibleVoters.map(voterId => {
                const targetId = announce.votes[voterId]
                const voterName = players[voterId]?.nickname ?? '?'
                const targetName = targetId ? (players[targetId]?.nickname ?? '?') : '기권'
                const bonus = announce.bonusVoteWeights?.[voterId] ?? 0
                return (
                  <div key={voterId} className="flex items-center gap-2 text-sm">
                    <span className={`font-medium ${voterId === uid ? 'text-blue-300' : 'text-zinc-300'}`}>
                      {voterName}
                    </span>
                    {bonus > 0 && (
                      <span className="text-xs text-orange-400 font-bold">😤 협박(+{bonus})</span>
                    )}
                    <span className="text-zinc-600">→</span>
                    <span className={targetId ? 'text-red-300 font-medium' : 'text-zinc-500'}>{targetName}</span>
                  </div>
                )
              })}
            </div>

            {Object.entries(announce.bonusVoteWeights ?? {}).some(([, v]) => v > 0) && (
              <div className="mb-3 space-y-1">
                {Object.entries(announce.bonusVoteWeights ?? {})
                  .filter(([, v]) => v > 0)
                  .map(([pid, bonus]) => (
                    <p key={pid} className="text-xs text-orange-400">
                      😤 <span className="font-bold">{players[pid]?.nickname ?? '?'}님</span>이 협박 아이템으로 투표권 +{bonus}을 행사하였습니다.
                    </p>
                  ))}
              </div>
            )}

            {(() => {
              const winnerIcon = vote.type === 'zombie_attack' ? ' 💀' : vote.type === 'truck_search' ? ' 🚚' : ' 👮'
              return (
                <div className="border-t border-zinc-800 pt-2 space-y-1">
                  {sortedTally.map(([candidateId, votes]) => (
                    <div key={candidateId} className={`flex items-center justify-between text-sm ${votes === maxVotes ? 'text-white font-bold' : 'text-zinc-400'}`}>
                      <span>{players[candidateId]?.nickname ?? '?'}</span>
                      <span className={votes === maxVotes ? 'text-red-400' : ''}>{votes}표{votes === maxVotes ? winnerIcon : ''}</span>
                    </div>
                  ))}
                </div>
              )
            })()}

            <p className="text-zinc-600 text-xs mt-3">잠시 후 다음 단계로 진행됩니다...</p>
          </div>
        )
      }

      return (
        <div>
          <div className="mb-2">
            <p className="text-sm text-zinc-400">
              <span className="text-yellow-400 font-bold">{voteZone.displayName}</span> — {voteTypeLabel}
              {vote.round > 0 && <span className="text-zinc-500 text-xs"> (재투표 {vote.round}회차)</span>}
            </p>
          </div>

          {canVote ? (
            <>
              <div className="flex gap-2 flex-wrap mb-3">
                {candidates.map(c => (
                  <button key={c.id}
                    onClick={() => handleSelectVote(c.id)}
                    disabled={myVoteConfirmed || actionLoading}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                      myVote === c.id
                        ? 'bg-red-700 ring-2 ring-red-400 text-white'
                        : 'bg-zinc-700 hover:bg-red-800 text-white disabled:opacity-50'
                    }`}>
                    <div className={`w-3 h-3 rounded-full shrink-0 ${COLOR_BG[c.color]}`} />
                    {c.nickname}
                  </button>
                ))}
              </div>

              {myVoteConfirmed ? (
                <p className="text-green-400 text-sm">✓ <span className="text-white">{players[myVote ?? '']?.nickname}</span>에게 투표 확정</p>
              ) : myVote ? (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 text-xs">선택: <span className="text-red-300 font-medium">{players[myVote]?.nickname}</span></span>
                  <button onClick={handleConfirmVote} disabled={actionLoading}
                    className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
                    확정
                  </button>
                </div>
              ) : (
                <p className="text-zinc-600 text-xs">투표할 대상을 선택하세요</p>
              )}
            </>
          ) : (
            <p className="text-zinc-500 text-sm">이번 투표에 참여하지 않습니다.</p>
          )}

          <p className="text-zinc-600 text-xs mt-2">{confirmedCount} / {eligibleVoters.length}명 확정</p>
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
