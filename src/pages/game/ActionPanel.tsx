import {
  submitWeaponConfirm,
  submitWeaponUsePass,
} from '../../firebase/gameService'
import { determineSurvivorEvent } from '../../engine/event'
import { calcDefense, isUnderAttack } from '../../engine/combat'
import { EVENT_ZONE_ORDER, ZONE_CONFIGS, CHARACTER_CONFIGS, ITEM_CONFIGS } from '../../engine/constants'
import type { GameState, Player, ZoneName } from '../../engine/types'
import {
  PHASE_LABEL, COLOR_BG,
} from './constants'


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
  onLeave,
  myItemIds,
}: ActionPanelProps) {
  // Derived values
  const myDeclaredCharId = game.characterDeclarations[uid ?? '']?.characterId
  const currentDeclarerId = game?.declarationOrder.find(pid => !game.characterDeclarations[pid]) ?? null
  const mySealedZone = game.sealedDestinations[uid ?? '']?.targetZone
  const myDestConfirmed = !!(uid && game.destinationStatus[uid])
  const myMovingChar = uid ? game.characterDeclarations[uid]?.characterId : undefined
  const myMovingCharData = myMovingChar ? game.characters[myMovingChar] : undefined
  // ── Handlers ──────────────────────────────────────────────────



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
    // ── 초기 배치 (맵 위 SetupOverlay에서 처리) ────────────────
    case 'setup_place': {
      return (
        <p className="text-zinc-500 text-sm text-center animate-pulse">🎲 초기 캐릭터 배치 중...</p>
      )
    }

    // ── 주사위 결과 공개 / 주사위 굴리기 (맵 위 DiceOverlay에서 처리) ──
    case 'dice_reveal':
    case 'roll_dice': {
      return (
        <p className="text-zinc-500 text-sm text-center animate-pulse">🎲 주사위 진행 중...</p>
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
            <p className="text-yellow-400 text-sm font-bold">손패에서 이동할 캐릭터를 선택하세요</p>
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
            <p className="text-yellow-400 text-sm">맵에서 이동할 구역을 선택하세요</p>
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

    // ── 좀비 순차 배치 공지 (맵 오버레이로 표시되므로 패널은 간단히)
    case 'zombie_spawn': {
      return (
        <p className="text-zinc-500 text-sm text-center animate-pulse">🧟 좀비 배치 중...</p>
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

    // ── 이벤트 처리 / 트럭 수색 (맵 위 TruckSearchOverlay에서 처리) ──
    case 'event': {
      const preview = game!.itemSearchPreview
      const winnerId = game!.itemSearchWinnerId
      if (preview && winnerId) {
        const isWinner = uid === winnerId
        const winnerName = players[winnerId]?.nickname ?? '?'
        return (
          <p className="text-zinc-500 text-sm text-center animate-pulse">
            {isWinner ? '🚚 맵에서 아이템을 선택하세요' : `🚚 ${winnerName}님이 트럭을 수색 중...`}
          </p>
        )
      }
      return <p className="text-zinc-500 text-xs">이벤트 처리 중...</p>
    }

    // ── 투표 (맵 위 VoteOverlay에서 처리) ──────────────────────
    case 'voting': {
      return (
        <p className="text-zinc-500 text-sm text-center animate-pulse">
          🗳️ 맵에서 투표를 진행하세요
        </p>
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
