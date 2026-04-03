import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  subscribeToGame,
  subscribeToMyItems,
  useThreatItem, useCctvItem,
  declareCharacter, submitVictimChoice,
  selectDestination, confirmDestination,
} from '../firebase/gameService'
import { subscribeToPlayers, subscribeToMeta } from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { deleteRoom } from '../firebase/roomService'
import { CHARACTER_CONFIGS, ITEM_CONFIGS, EVENT_ZONE_ORDER, ZONE_CONFIGS, DICE_TO_ZONE } from '../engine/constants'
import type { GameState, Player, RoomMeta, ZoneName } from '../engine/types'
import RulesModal from '../components/RulesModal'
import { useHostLogic } from '../hooks/useHostLogic'
import ZoneBoard from './game/ZoneBoard'
import ActionPanel from './game/ActionPanel'
import PlayerSidebar, { MobilePlayerList } from './game/PlayerSidebar'
import {
  PHASE_LABEL, CHAR_ICON, ITEM_CATEGORY,
  ZONE_MAP_POSITIONS, getZoneCenter, getHandCardPos, getPlayerSpawnPos,
  MovingToken, MovingTokenState, instanceIdToItemId,
} from './game/constants'

import { normalizeGame } from './game/normalizeGame'

interface Props { roomCode: string; onLeave: () => void }

export default function GamePage({ roomCode, onLeave }: Props) {
  const [game, setGame] = useState<GameState | null>(null)
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [meta, setMeta] = useState<RoomMeta | null>(null)
  const [selectedSetupCharId, setSelectedSetupCharId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [myItemIds, setMyItemIds] = useState<string[]>([])
  // weapon_use 페이즈: 로컬에서 선택한 무기 instanceId 목록
  const [stagedWeapons, setStagedWeapons] = useState<Set<string>>(new Set())
  const [stagedHideItemId, setStagedHideItemId] = useState<string | null>(null)
  const [stagedHideCharId, setStagedHideCharId] = useState<string | null>(null)
  const [stagedSprintItemId, setStagedSprintItemId] = useState<string | null>(null)
  const [stagedSprintCharId, setStagedSprintCharId] = useState<string | null>(null)
  const [stagedSprintTargetZone, setStagedSprintTargetZone] = useState<ZoneName | null>(null)
  const [stagedHardwareItemId, setStagedHardwareItemId] = useState<string | null>(null)
  const gameRef = useRef<GameState | null>(null)
  gameRef.current = game
  const pendingSetupFromPos = useRef<{ charId: string; pos: { x: number; y: number } } | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [movingTokens, setMovingTokens] = useState<MovingTokenState[]>([])
  const [transitCharIds, setTransitCharIds] = useState<Set<string>>(new Set())
  const prevCharZones = useRef<Record<string, string>>({})
  const [confirmingItems, setConfirmingItems] = useState<Set<string>>(new Set())
  const [handTab, setHandTab] = useState<'chars' | 'items'>('chars')
  const [clickGuarded, setClickGuarded] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [hoveredCharId, setHoveredCharId] = useState<string | null>(null)
  const [hoveredZone, setHoveredZone] = useState<ZoneName | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'char'; charId: string }
    | { type: 'dest'; zone: ZoneName }
    | null
  >(null)
  // 초기 배치 주사위 애니메이션 완료 여부 (상단 바 구역 힌트 노출 제어)
  const [setupDiceTopReady, setSetupDiceTopReady] = useState(false)
  const lastSetupDiceTopKey = useRef('')
  const uid = getCurrentUid()

  const isHost = meta?.hostId === uid

  // ── subscriptions ─────────────────────────────────────────────
  useEffect(() => {
    const unsubGame = subscribeToGame(roomCode, g => setGame(g ? normalizeGame(g) : null))
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubMeta = subscribeToMeta(roomCode, setMeta)
    const unsubItems = uid ? subscribeToMyItems(roomCode, uid, setMyItemIds) : () => {}
    return () => { unsubGame(); unsubPlayers(); unsubMeta(); unsubItems() }
  }, [roomCode, uid])

  // ── Host logic ────────────────────────────────────────────────
  useHostLogic({ roomCode, isHost, game, gameRef, players, meta })

  // ── 캐릭터 이동 애니메이션 ────────────────────────────────────
  useLayoutEffect(() => {
    if (!game) return
    const chars = game.characters
    const prev = prevCharZones.current
    const initialized = Object.keys(prev).length > 0
    const newTokens: MovingTokenState[] = []
    const newTransitIds: string[] = []

    for (const [charId, char] of Object.entries(chars)) {
      const prevZoneStr = prev[charId]
      const toZone = char.zone as ZoneName
      const isUnplaced = char.zone === 'parking' && !game.zones.parking.characterIds.includes(charId)
      const effectiveZone = isUnplaced ? '__hand__' : char.zone
      if (initialized && char.isAlive && prevZoneStr !== effectiveZone) {
        const charConfig = CHARACTER_CONFIGS[char.characterId]
        const label = CHAR_ICON[char.characterId] ?? charConfig?.name?.charAt(0) ?? '?'
        const playerIndex = game.playerOrder.indexOf(char.playerId)

        let fromPos: { x: number; y: number }
        if (pendingSetupFromPos.current?.charId === charId) {
          fromPos = pendingSetupFromPos.current.pos
          pendingSetupFromPos.current = null
        } else if (prevZoneStr && ZONE_MAP_POSITIONS[prevZoneStr as ZoneName]) {
          fromPos = getZoneCenter(prevZoneStr as ZoneName)
        } else {
          fromPos = getPlayerSpawnPos(playerIndex, game.playerOrder.length)
        }

        let bounceZone: ZoneName | undefined
        if (toZone === 'parking' && prevZoneStr && prevZoneStr !== 'parking') {
          const sprintChoice = Object.values(game.pendingSprintChoices ?? {}).find(
            (c: { charId: string; targetZone: ZoneName }) => c.charId === charId && c.targetZone !== 'parking'
          ) as { charId: string; targetZone: ZoneName } | undefined
          if (sprintChoice) bounceZone = sprintChoice.targetZone
        }

        newTokens.push({
          uid: `${charId}_${Date.now()}`,
          playerId: char.playerId,
          fromPos,
          toZone,
          bounceZone,
          label,
        })
        newTransitIds.push(charId)
      }
      prev[charId] = effectiveZone
    }

    if (newTokens.length > 0) {
      setTransitCharIds(p => new Set([...p, ...newTransitIds]))
      setMovingTokens(p => [...p, ...newTokens])
      const totalDuration = newTokens.some(t => t.bounceZone) ? 1750 : 950
      setTimeout(() => {
        setTransitCharIds(p => { const n = new Set(p); newTransitIds.forEach(id => n.delete(id)); return n })
      }, totalDuration)
      setTimeout(() => {
        setMovingTokens(p => p.filter(t => !newTokens.find(n => n.uid === t.uid)))
      }, totalDuration + 200)
    }
  }, [game?.characters])

  // ── 초기 배치 차례 변경 시 캐릭터 선택 초기화 ───────────────────
  useEffect(() => {
    setSelectedSetupCharId(null)
  }, [game?.setupPlacementOrder?.[0]])

  // ── 초기 배치 주사위 상단 바 구역 힌트 — 애니메이션 완료 후 표시 ──
  useEffect(() => {
    if (!game?.setupDiceRoll) { setSetupDiceTopReady(false); return }
    const key = (game.setupDiceRoll as [number, number]).join(',')
    if (lastSetupDiceTopKey.current === key) return
    lastSetupDiceTopKey.current = key
    setSetupDiceTopReady(false)
    const timer = setTimeout(() => setSetupDiceTopReady(true), 1100) // 애니메이션 ~12틱×80ms=960ms
    return () => clearTimeout(timer)
  }, [game?.setupDiceRoll])

  // ── weapon_use 페이즈 이탈 시 staged 초기화 ───────────────────
  useEffect(() => {
    if (game?.phase !== 'weapon_use') {
      setStagedWeapons(new Set())
      setStagedHideItemId(null)
      setStagedHideCharId(null)
      setStagedSprintItemId(null)
      setStagedSprintCharId(null)
      setStagedSprintTargetZone(null)
      setStagedHardwareItemId(null)
    }
  }, [game?.phase])

  // ── 카운트다운 타이머 ─────────────────────────────────────────
  useEffect(() => {
    if (!game?.phaseDeadline) { setCountdown(null); return }
    const tick = () => setCountdown(Math.max(0, Math.ceil((game.phaseDeadline - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [game?.phaseDeadline])

  // ── 캐릭터 선택이 필요한 순간 자동으로 캐릭터 탭 전환 ──────────
  useEffect(() => {
    if (!game || !uid) return
    const pvs = game.pendingVictimSelection
    const isMyVictimTurn = pvs && !pvs.chosenCharacterId && pvs.loserPlayerId === uid
    if (game.phase === 'character_select' || isMyVictimTurn || stagedHideItemId) {
      setHandTab('chars')
      setClickGuarded(true)
      const t = setTimeout(() => setClickGuarded(false), 400)
      return () => clearTimeout(t)
    }
  }, [game?.phase, game?.pendingVictimSelection?.loserPlayerId, game?.pendingVictimSelection?.chosenCharacterId, stagedHideItemId, uid])

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400 text-sm">게임 로딩 중...</p>
      </div>
    )
  }

  const sheriffId = game.playerOrder[game.sheriffIndex]
  const myAliveChars = uid
    ? Object.values(game.characters).filter(c => c.playerId === uid && c.isAlive)
    : []
  const myDeclaredCharId = game.characterDeclarations[uid ?? '']?.characterId
  const currentDeclarerId = game?.declarationOrder.find(pid => !game.characterDeclarations[pid]) ?? null
  const myUnplacedChars = uid
    ? Object.values(game.characters).filter(c =>
        c.playerId === uid &&
        c.isAlive &&
        c.zone === 'parking' &&
        !game.zones.parking.characterIds.includes(c.id)
      )
    : []

  // ── 아이템 사용 핸들러 (손패 패널용) ──────────────────────────
  async function handleUseItem(instanceId: string, itemId: string) {
    if (actionLoading) return
    if (itemId === 'cctv') {
      setActionLoading(true)
      try { await useCctvItem(roomCode, instanceId, myItemIds) }
      finally {
        setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
        setActionLoading(false)
      }
    } else if (itemId === 'threat') {
      setActionLoading(true)
      try { await useThreatItem(roomCode, instanceId, myItemIds) }
      finally {
        setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
        setActionLoading(false)
      }
    } else if (itemId === 'hidden_card') {
      setStagedHideItemId(instanceId)
      setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
    } else if (itemId === 'sprint') {
      setStagedSprintItemId(instanceId)
      setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
    } else if (itemId === 'hardware') {
      setStagedHardwareItemId(instanceId)
      setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
    } else {
      setStagedWeapons(prev => new Set([...prev, instanceId]))
      setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────
  return (
    <>
    <div className="min-h-screen flex flex-col bg-zinc-950 text-white">
      {/* 헤더 */}
      {(() => {
        const phaseMaxSec: Partial<Record<string, number>> = {
          destination_seal: meta?.settings.sealTime ?? 60,
          voting: meta?.settings.votingTime ?? 60,
          weapon_use: 15,
        }
        const maxSec = phaseMaxSec[game.phase] ?? null
        const timerPct = (maxSec && countdown !== null) ? Math.max(0, (countdown / maxSec) * 100) : null
        const timerColor = timerPct === null ? '' : timerPct > 50 ? 'bg-blue-500' : timerPct > 25 ? 'bg-yellow-400' : 'bg-red-500'
        return (
          <>
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-red-400 font-bold text-sm shrink-0">MOH</span>
                <span className="hidden sm:inline text-zinc-600 shrink-0">|</span>
                <span className="hidden sm:inline text-zinc-400 text-xs shrink-0">라운드 {game.round}</span>
                <span className="bg-zinc-800 text-yellow-400 text-xs px-2 py-0.5 rounded-full shrink-0">
                  {PHASE_LABEL[game.phase] ?? game.phase}
                </span>
                {countdown !== null && (
                  <span className={`text-xs font-mono font-bold tabular-nums shrink-0 ${countdown <= 10 ? 'text-red-400' : 'text-zinc-400'}`}>
                    {countdown}s
                  </span>
                )}
                <span className="text-xs text-zinc-500 truncate min-w-0">
                  👮 <span className="text-white">{players[sheriffId]?.nickname ?? '?'}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:inline text-xs text-zinc-600">#{roomCode}</span>
                <button onClick={() => setShowRules(true)} className="text-zinc-500 hover:text-white text-xs transition-colors">📖</button>
                <button onClick={async () => {
                  if (isHost) { try { await deleteRoom(roomCode) } catch {} }
                  onLeave()
                }} className="text-zinc-500 hover:text-white text-xs transition-colors px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700">나가기</button>
              </div>
            </div>
            {/* 타이머 progress bar */}
            <div className="h-0.5 bg-zinc-800 shrink-0">
              {timerPct !== null && (
                <div
                  className={`h-full ${timerColor} transition-all duration-500`}
                  style={{ width: `${timerPct}%` }}
                />
              )}
            </div>
          </>
        )
      })()}

      {/* 숨기/등장 공지 + weapon_use 결과 + 좀비 플레이어 공지 + 트럭 수색 완료 — fixed 오버레이 */}
      {(game.lastHideRevealAnnounce || game.lastWeaponUseAnnounce || game.lastZombiePlayerAnnounce || game.lastItemSearchAnnounce) && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none" style={{maxWidth: '90vw'}}>
          {game.lastHideRevealAnnounce && (() => {
            const ann = game.lastHideRevealAnnounce!
            const isHide = ann.type === 'hide'
            return (
              <div className={`px-4 py-2 text-sm text-center font-bold rounded-xl shadow-lg ${isHide ? 'bg-purple-950/95 text-purple-200' : 'bg-zinc-800/95 text-zinc-200'}`}>
                {ann.entries.map((e, i) => {
                  const playerName = players[e.playerId]?.nickname ?? e.playerId
                  const charName = CHARACTER_CONFIGS[game.characters[e.charId]?.characterId]?.name ?? e.charId
                  const zoneName = ZONE_CONFIGS[e.zone]?.displayName ?? e.zone
                  return (
                    <span key={i} className="block">
                      {isHide
                        ? `🫥 ${playerName}님의 ${charName}가 ${zoneName}에서 흔적도 없이 사라졌습니다.`
                        : `👁️ 사라졌던 ${playerName}님의 ${charName}가 ${zoneName}에서 모습을 드러냈습니다.`}
                    </span>
                  )
                })}
              </div>
            )
          })()}
          {game.lastWeaponUseAnnounce && (() => {
            const ann = game.lastWeaponUseAnnounce!
            const zoneName = ZONE_CONFIGS[ann.zone]?.displayName ?? ann.zone
            const killLines = Object.entries(ann.killsByPlayer).map(([pid, k]) => {
              const name = players[pid]?.nickname ?? pid
              return `${name}님이 ${k}마리 처치`
            })
            return (
              <div className="px-4 py-2 text-sm text-center font-bold rounded-xl shadow-lg bg-orange-950/95 text-orange-200">
                <span className="block">🔫 {zoneName} — 아이템 사용 결과</span>
                {killLines.length > 0
                  ? killLines.map((line, i) => <span key={i} className="block">{line}</span>)
                  : <span className="block text-orange-400">사용된 무기 없음</span>}
                <span className="block mt-0.5">
                  {ann.totalKill > 0
                    ? `총 ${ann.totalKill}마리 처치 → 남은 좀비 ${ann.remainingZombies}마리`
                    : `남은 좀비 ${ann.remainingZombies}마리`}
                </span>
              </div>
            )
          })()}
          {game.lastZombiePlayerAnnounce && (
            <div className="px-4 py-2 text-sm text-center font-bold rounded-xl shadow-lg bg-red-950/95 text-red-200">
              {game.lastZombiePlayerAnnounce.entries.map((e, i) => {
                const name = players[e.playerId]?.nickname ?? e.playerId
                const zoneName = ZONE_CONFIGS[e.zone]?.displayName ?? e.zone
                return <span key={i} className="block">🧟 좀비가 된 {name}님이 {zoneName}에 나타났습니다!</span>
              })}
            </div>
          )}
          {game.lastItemSearchAnnounce && (() => {
            const ann = game.lastItemSearchAnnounce!
            const winnerName = players[ann.winnerId]?.nickname ?? ann.winnerId
            const givenToName = ann.givenToPlayerId ? (players[ann.givenToPlayerId]?.nickname ?? ann.givenToPlayerId) : null
            return (
              <div className="px-4 py-2 text-sm text-center font-bold rounded-xl shadow-lg bg-zinc-800/95 text-zinc-200">
                <span className="block">🚚 {winnerName}님이 트럭 수색을 마쳤습니다.</span>
                {givenToName && (
                  <span className="block text-blue-300">{winnerName}님이 {givenToName}님에게 아이템을 건냈습니다.</span>
                )}
              </div>
            )
          })()}
        </div>
      )}

      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        {/* 존 보드 */}
        <div className="flex-1 p-3 overflow-y-auto">
          {/* 이번 라운드 좀비 배너 */}
          <div className="w-full max-w-2xl mx-auto mb-2 h-12 flex items-center">
            {(() => {
              if (game.phase === 'zombie_spawn') {
                const batches = game.zombieSpawnBatches ?? []
                const step = game.zombieSpawnStep
                const batch = batches[step] ?? null
                if (!batch) return null
                if (batch.type === 'dice') {
                  const lines = Object.entries(batch.zones).map(([zone, cnt]) =>
                    `${ZONE_CONFIGS[zone as ZoneName]?.displayName} +${cnt}`
                  ).join('  ')
                  return (
                    <div className="w-full bg-zinc-800 rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap">
                      <span className="text-yellow-400 text-xs font-bold shrink-0">🎲 좀비 배치 ({step + 1}/{batches.length})</span>
                      <span className="text-zinc-300 text-xs">{lines}</span>
                    </div>
                  )
                }
                if (batch.type === 'crowded') return (
                  <div className="w-full bg-zinc-800 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="text-yellow-400 text-xs font-bold shrink-0">👥 좀비 배치 ({step + 1}/{batches.length})</span>
                    <span className="text-red-300 text-xs">{ZONE_CONFIGS[batch.zone].displayName}에 좀비 출현!</span>
                  </div>
                )
                if (batch.type === 'belle') return (
                  <div className="w-full bg-zinc-800 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="text-yellow-400 text-xs font-bold shrink-0">💄 좀비 배치 ({step + 1}/{batches.length})</span>
                    <span className="text-red-300 text-xs">{ZONE_CONFIGS[batch.zone].displayName}에 좀비 출현!</span>
                  </div>
                )
                if (batch.type === 'zombie_player') {
                  const pName = players[batch.playerId]?.nickname ?? batch.playerId
                  return (
                    <div className="w-full bg-red-950 rounded-xl px-3 py-2 flex items-center gap-2">
                      <span className="text-yellow-400 text-xs font-bold shrink-0">🧟 좀비 배치 ({step + 1}/{batches.length})</span>
                      <span className="text-red-300 text-xs">{pName}님이 {ZONE_CONFIGS[batch.zone].displayName}에 출현!</span>
                    </div>
                  )
                }
                return null
              }

              if (game.phase === 'setup_place') {
                const d = game.setupDiceRoll as [number, number] | null
                if (!d) return null
                const currentSetupPlayerId = game.setupPlacementOrder[0] ?? null
                const currentOwner = players[currentSetupPlayerId ?? '']
                const z1 = DICE_TO_ZONE[d[0]], z2 = DICE_TO_ZONE[d[1]]
                const candidates = z1 === z2 ? [z1] : [z1, z2]
                const available = candidates.filter(z => {
                  if (game.zones[z]?.isClosed) return false
                  const cfg = ZONE_CONFIGS[z]
                  if (cfg.maxCapacity === Infinity) return true
                  return game.zones[z].characterIds.filter(id => game.characters[id]?.isAlive).length < cfg.maxCapacity
                })
                const zoneOptions = available.length > 0 ? available : (Object.keys(game.zones) as ZoneName[]).filter(z => !game.zones[z].isClosed)
                return (
                  <div className="w-full bg-zinc-800 border border-blue-900 rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap">
                    <span className="text-blue-400 text-xs font-bold shrink-0">🎲 초기 배치</span>
                    {setupDiceTopReady ? (
                      <>
                        <div className="flex gap-1">
                          {d.map((v, i) => (
                            <span key={i} className="w-6 h-6 bg-zinc-700 rounded text-sm font-bold text-white flex items-center justify-center">{v}</span>
                          ))}
                        </div>
                        <span className="text-yellow-400 text-xs font-semibold">
                          → {zoneOptions.map(z => ZONE_CONFIGS[z]?.displayName).join(' 또는 ')}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-500 text-xs animate-pulse">굴리는 중...</span>
                    )}
                    {currentOwner && (
                      <span className="text-zinc-500 text-xs">({currentOwner.nickname}님 배치 중)</span>
                    )}
                  </div>
                )
              }

              if (!game.lastDiceRoll || ['roll_dice', 'dice_reveal'].includes(game.phase)) return null
              const isMovementPhase = ['character_select', 'destination_seal', 'destination_reveal', 'move_execute'].includes(game.phase)
              const iAmRealSheriff = uid === sheriffId && game.isRealSheriff
              const iUsedCctv = uid ? game.cctvViewers.includes(uid) : false
              const canSeeZones = iAmRealSheriff || iUsedCctv
              if (isMovementPhase && !canSeeZones) {
                if (game.isRealSheriff) return null
                return (
                  <div className="w-full bg-zinc-800 rounded-xl px-3 py-2 flex items-center gap-2">
                    <span className="text-yellow-600 text-xs font-bold shrink-0">🧟 이번 라운드 좀비</span>
                    <span className="text-zinc-500 text-xs">정식보안관 없어 CCTV 미확인</span>
                  </div>
                )
              }
              return (
                <div className="w-full bg-zinc-800 border border-yellow-900 rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap">
                  <span className="text-yellow-500 text-xs font-bold shrink-0">🧟 이번 라운드 좀비</span>
                  {iAmRealSheriff && (
                    <div className="flex gap-1">
                      {game.lastDiceRoll.dice.map((d, i) => (
                        <span key={i} className="w-5 h-5 bg-zinc-700 rounded text-[10px] font-bold text-white flex items-center justify-center">{d}</span>
                      ))}
                    </div>
                  )}
                  {iUsedCctv && !iAmRealSheriff && <span className="text-purple-400 text-xs">📷</span>}
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {Object.entries(game.lastDiceRoll.zombiesByZone).map(([z, count]) => (
                      <span key={z} className="text-zinc-400 text-xs">{ZONE_CONFIGS[z as ZoneName]?.displayName} +{count}🧟</span>
                    ))}
                  </div>
                  {!game.isRealSheriff && <span className="text-zinc-600 text-xs">· 정식보안관 없음</span>}
                </div>
              )
            })()}
          </div>

          {/* 맵 보드 */}
          <div className="relative w-full max-w-2xl mx-auto aspect-square overflow-visible mb-10">
            <img
              src={`${import.meta.env.BASE_URL}map.jpg`}
              alt="몰오브호러 맵"
              className="w-full h-full object-cover rounded-xl"
            />
            <ZoneBoard
              game={game}
              players={players}
              uid={uid}
              roomCode={roomCode}
              transitCharIds={transitCharIds}
              hoveredZone={hoveredZone}
              setHoveredZone={setHoveredZone}
              hoveredCharId={hoveredCharId}
              setHoveredCharId={setHoveredCharId}
              selectedSetupCharId={selectedSetupCharId}
              setupDiceTopReady={setupDiceTopReady}
              actionLoading={actionLoading}
              setActionLoading={setActionLoading}
              pendingSetupFromPos={pendingSetupFromPos}
              getHandCardPos={getHandCardPos}
              onDestinationPreSelect={(zone) => setPendingConfirm({ type: 'dest', zone })}
            />
            {/* 이동 애니메이션 토큰 */}
            {movingTokens.map(t => {
              const owner = players[t.playerId]
              return (
                <MovingToken
                  key={t.uid}
                  fromPos={t.fromPos}
                  toZone={t.toZone}
                  bounceZone={t.bounceZone}
                  color={owner?.color ?? 'zinc'}
                  label={t.label}
                />
              )
            })}

            {/* ── 손패 카드 ── */}
            {(() => {
              const isSetupCharMode = handTab === 'chars'
                && game.phase === 'setup_place' && game.setupPlacementOrder[0] === uid && !!game.setupDiceRoll
              const charCards = isSetupCharMode ? myUnplacedChars : []
              const isGameCharMode = handTab === 'chars' && game.phase !== 'setup_place'
              const itemCards = handTab === 'items' ? myItemIds : []

              if (isGameCharMode) {
                if (myAliveChars.length === 0) return null

                const isCharSelectPhase = game.phase === 'character_select'
                const canDeclare = isCharSelectPhase && !myDeclaredCharId && currentDeclarerId === uid && !actionLoading && !clickGuarded

                const pvs = game.pendingVictimSelection
                const isVictimMode = game.phase === 'voting' && !!pvs && !pvs.chosenCharacterId && pvs.loserPlayerId === uid

                const weaponZone = game.phase === 'weapon_use' ? EVENT_ZONE_ORDER[game.currentEventZoneIndex] : null
                const isHideMode = !!stagedHideItemId && !!weaponZone

                let displayChars = myAliveChars
                if (isVictimMode && pvs) {
                  displayChars = myAliveChars.filter(c =>
                    game.zones[pvs.zone]?.characterIds.includes(c.id) && !game.hiddenCharacters?.[c.id]
                  )
                } else if (isHideMode && weaponZone) {
                  displayChars = myAliveChars.filter(c => game.zones[weaponZone]?.characterIds.includes(c.id))
                }
                if (displayChars.length === 0) return null

                return displayChars.map((char, i) => {
                  const cfg = CHARACTER_CONFIGS[char.characterId]
                  const zoneCfg = ZONE_CONFIGS[char.zone]
                  const pos = getHandCardPos(i, displayChars.length)

                  const isDeclared = isCharSelectPhase && myDeclaredCharId === char.id
                  const isSelectedHide = isHideMode && stagedHideCharId === char.id
                  const isHighlighted = isDeclared || isSelectedHide

                  let isClickable = false
                  let onClick: (() => void) | undefined
                  if (canDeclare) {
                    isClickable = true
                    onClick = () => setPendingConfirm({ type: 'char', charId: char.id })
                  } else if (isVictimMode && !actionLoading) {
                    isClickable = true
                    onClick = async () => {
                      setActionLoading(true)
                      try { await submitVictimChoice(roomCode, char.id) }
                      finally { setActionLoading(false) }
                    }
                  } else if (isHideMode) {
                    isClickable = true
                    onClick = () => setStagedHideCharId(char.id)
                  }

                  const isHovered = hoveredCharId === char.id
                  return (
                    <div key={char.id}
                      onClick={onClick}
                      onMouseEnter={() => setHoveredCharId(char.id)}
                      onMouseLeave={() => setHoveredCharId(null)}
                      style={{
                        position: 'absolute', left: `${pos.x}%`, top: '100%',
                        transform: `translate(-50%, -50%)${isHighlighted || isHovered ? ' translateY(-10px) scale(1.1)' : ''}`,
                        transition: 'transform 0.18s ease',
                        zIndex: 40,
                      }}
                      className={`rounded-2xl shadow-2xl flex flex-col items-center justify-center w-14 h-16 select-none
                        ${isHighlighted
                          ? (isVictimMode ? 'bg-red-700 ring-2 ring-red-400' : isHideMode ? 'bg-purple-700 ring-2 ring-purple-400' : 'bg-yellow-600 ring-2 ring-yellow-300')
                          : isClickable
                          ? 'bg-zinc-800/90 border border-zinc-400 hover:border-white hover:bg-zinc-700/90 cursor-pointer'
                          : 'bg-zinc-800/90 border border-zinc-600'}`}
                    >
                      <span className="text-2xl leading-none">{CHAR_ICON[char.characterId] ?? '?'}</span>
                      <span className="text-xs mt-0.5 font-medium text-white leading-tight">{cfg?.name}</span>
                      <span className="text-[10px] text-zinc-400 leading-tight mt-0.5 px-1 text-center">{zoneCfg?.name ?? char.zone}</span>
                    </div>
                  )
                })
              }

              const cards = charCards.length > 0 ? charCards : itemCards
              if (cards.length === 0) return null

              return (cards as (typeof charCards[number] | string)[]).map((card, i) => {
                const isCharCard = handTab === 'chars' && charCards.length > 0
                const pos = getHandCardPos(i, cards.length)

                if (isCharCard) {
                  const char = card as typeof charCards[number]
                  const cfg = CHARACTER_CONFIGS[char.characterId]
                  const isSelected = selectedSetupCharId === char.id
                  const isPlacing = transitCharIds.has(char.id)
                  // 구역 선택 단계(setupDiceTopReady + 캐릭터 선택됨)에서는
                  // 모든 카드를 잠가 캐릭터 선택 변경 불가
                  const isZoneSelectActive = setupDiceTopReady && !!selectedSetupCharId
                  return (
                    <div key={char.id}
                      onClick={() => { if (!isPlacing && !actionLoading && !isZoneSelectActive) setSelectedSetupCharId(isSelected ? null : char.id) }}
                      style={{
                        position: 'absolute', left: `${pos.x}%`, top: '100%',
                        transform: `translate(-50%, -50%)${isSelected ? ' translateY(-12px) scale(1.12)' : ''}`,
                        transition: 'transform 0.18s ease, opacity 0.15s ease',
                        opacity: isPlacing ? 0 : (!isSelected && isZoneSelectActive) ? 0.35 : 1,
                        zIndex: isZoneSelectActive ? 5 : 40,
                        pointerEvents: isZoneSelectActive ? 'none' : 'auto',
                      }}
                      className={`rounded-2xl shadow-2xl flex flex-col items-center justify-center w-14 h-16 select-none
                        ${isSelected ? 'bg-yellow-600 ring-2 ring-yellow-300' : 'bg-zinc-800/90 border border-zinc-500 hover:border-zinc-300 hover:bg-zinc-700/90'}
                        ${(!isZoneSelectActive && !actionLoading) ? 'cursor-pointer' : ''}`}
                    >
                      <span className="text-2xl leading-none">{CHAR_ICON[char.characterId] ?? '?'}</span>
                      <span className="text-xs mt-0.5 font-medium text-white leading-tight">{cfg?.name}</span>
                    </div>
                  )
                } else {
                  const instanceId = card as string
                  const itemId = instanceIdToItemId(instanceId)
                  const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
                  const kills = cfg?.zombieKill ?? 0
                  const isConfirming = confirmingItems.has(instanceId)
                  const isStaged = stagedWeapons.has(instanceId) || stagedHideItemId === instanceId
                    || stagedSprintItemId === instanceId || stagedHardwareItemId === instanceId
                  const weaponItemIds = ['axe', 'pistol', 'shotgun', 'bat', 'grenade', 'chainsaw']
                  const amInWeaponZone = game.phase === 'weapon_use' && (() => {
                    const zone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
                    return game.zones[zone]?.characterIds.some(id => game.characters[id]?.playerId === uid && game.characters[id]?.isAlive) ?? false
                  })()
                  const notConfirmed = !game.weaponUseStatus[uid ?? '']
                  const canUseCctv = itemId === 'cctv' && !!game.lastDiceRoll && !game.cctvViewers.includes(uid ?? '')
                  const canUseThreat = itemId === 'threat' && game.phase === 'voting' && !!game.currentVote && !!uid && game.currentVote.eligibleVoters.includes(uid)
                  const canUseWeapon = weaponItemIds.includes(itemId) && amInWeaponZone && notConfirmed && !isStaged
                  const canUseHide = itemId === 'hidden_card' && amInWeaponZone && notConfirmed && !stagedHideItemId
                  const canUseSprint = itemId === 'sprint' && amInWeaponZone && notConfirmed && !stagedSprintItemId
                  const canUseHardware = itemId === 'hardware' && amInWeaponZone && notConfirmed && !stagedHardwareItemId
                  const isUsable = canUseCctv || canUseThreat || canUseWeapon || canUseHide || canUseSprint || canUseHardware

                  const handleCancelStaged = () => {
                    if (stagedWeapons.has(instanceId)) {
                      setStagedWeapons(prev => { const next = new Set(prev); next.delete(instanceId); return next })
                    } else if (stagedHideItemId === instanceId) {
                      setStagedHideItemId(null); setStagedHideCharId(null)
                    } else if (stagedSprintItemId === instanceId) {
                      setStagedSprintItemId(null); setStagedSprintCharId(null); setStagedSprintTargetZone(null)
                    } else if (stagedHardwareItemId === instanceId) {
                      setStagedHardwareItemId(null)
                    }
                  }

                  if (isConfirming) {
                    return (
                      <div key={instanceId}
                        style={{ position: 'absolute', left: `${pos.x}%`, top: '100%', transform: 'translate(-50%, -50%)', zIndex: 50 }}
                        className="rounded-2xl shadow-2xl flex flex-col items-center justify-center gap-1 bg-yellow-800 border-2 border-yellow-400 p-2 select-none"
                      >
                        <span className="text-xl leading-none">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                        <span className="text-[10px] text-yellow-200 font-bold leading-tight text-center px-1">{cfg?.name ?? itemId}</span>
                        <div className="flex gap-1">
                          <button onClick={() => handleUseItem(instanceId, itemId)} disabled={actionLoading}
                            className="text-[10px] bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-bold px-2 py-0.5 rounded-lg transition-colors">
                            사용
                          </button>
                          <button onClick={() => setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })}
                            className="text-[10px] bg-zinc-600 hover:bg-zinc-500 text-white px-1.5 py-0.5 rounded-lg transition-colors">
                            취소
                          </button>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={instanceId}
                      onClick={() => {
                        if (isStaged) { handleCancelStaged(); return }
                        if (isUsable) setConfirmingItems(prev => new Set(prev).add(instanceId))
                      }}
                      style={{
                        position: 'absolute', left: `${pos.x}%`, top: '100%',
                        transform: 'translate(-50%, -50%)',
                        transition: 'transform 0.18s ease', zIndex: 40,
                      }}
                      className={`rounded-2xl shadow-2xl flex flex-col items-center justify-center w-14 h-16 select-none
                        ${isStaged ? 'bg-green-800 ring-2 ring-green-500 cursor-pointer' :
                          isUsable ? 'bg-zinc-700 border border-zinc-400 cursor-pointer hover:border-white hover:scale-105' :
                          'bg-zinc-800/80 border border-zinc-700 cursor-default opacity-60'}`}
                    >
                      <span className="text-2xl leading-none">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                      <span className="text-xs mt-0.5 font-medium text-white leading-tight text-center px-0.5">{cfg?.name ?? itemId}</span>
                      {kills > 0 && (
                        <span className="text-xs leading-none mt-0.5">{'💀'.repeat(kills)}</span>
                      )}
                    </div>
                  )
                }
              })
            })()}
          </div>
          {/* 손패 탭 토글 */}
          <div className="flex justify-center gap-1 mt-9 mb-1">
            <button onClick={() => setHandTab('chars')}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${handTab === 'chars' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-white'}`}>
              캐릭터
            </button>
            <button onClick={() => setHandTab('items')}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${handTab === 'items' ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-white'}`}>
              아이템{myItemIds.length > 0 ? ` (${myItemIds.length})` : ''}
            </button>
          </div>

          {/* 임시 보안관 공지 */}
          {game.phase === 'setup_place' && (
            <div className="mt-3 bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-3 py-2 text-center">
              <p className="text-yellow-300 text-sm">
                ⭐ <span className="font-bold">{players[sheriffId]?.nickname ?? '?'}</span>님이 임시 보안관으로 선택되었습니다
              </p>
            </div>
          )}

          {/* 액션 패널 */}
          <div className="mt-3 bg-zinc-900 rounded-2xl p-3">
            <ActionPanel
              game={game}
              players={players}
              uid={uid}
              roomCode={roomCode}
              actionLoading={actionLoading}
              setActionLoading={setActionLoading}
              stagedWeapons={stagedWeapons}
              setStagedWeapons={setStagedWeapons}
              stagedHideItemId={stagedHideItemId}
              setStagedHideItemId={setStagedHideItemId}
              stagedHideCharId={stagedHideCharId}
              setStagedHideCharId={setStagedHideCharId}
              stagedSprintItemId={stagedSprintItemId}
              setStagedSprintItemId={setStagedSprintItemId}
              stagedSprintCharId={stagedSprintCharId}
              setStagedSprintCharId={setStagedSprintCharId}
              stagedSprintTargetZone={stagedSprintTargetZone}
              setStagedSprintTargetZone={setStagedSprintTargetZone}
              stagedHardwareItemId={stagedHardwareItemId}
              setStagedHardwareItemId={setStagedHardwareItemId}
              hoveredCharId={hoveredCharId}
              selectedSetupCharId={selectedSetupCharId}
              setupDiceTopReady={setupDiceTopReady}
              onLeave={onLeave}
              myItemIds={myItemIds}
            />
          </div>


          <MobilePlayerList game={game} players={players} uid={uid} sheriffId={sheriffId} />
        </div>

        <PlayerSidebar game={game} players={players} uid={uid} sheriffId={sheriffId} />
      </div>
    </div>
    {showRules && <RulesModal onClose={() => setShowRules(false)} />}

    {/* ── 이동 확정 팝업 ── */}
    {pendingConfirm && game && (() => {
      let message = ''
      if (pendingConfirm.type === 'char') {
        const char = game.characters[pendingConfirm.charId]
        const cfg = CHARACTER_CONFIGS[char?.characterId ?? '']
        const name = cfg?.name ?? '?'
        const zoneName = char ? ZONE_CONFIGS[char.zone].displayName : '?'
        message = `${name}을(를) 이동 캐릭터로 선택하시겠습니까?`
        void zoneName
      } else {
        const myMovingCharId = game.characterDeclarations[uid ?? '']?.characterId
        const myMovingChar = myMovingCharId ? game.characters[myMovingCharId] : null
        const cfg = myMovingChar ? CHARACTER_CONFIGS[myMovingChar.characterId] : null
        const name = cfg?.name ?? '?'
        const destName = ZONE_CONFIGS[pendingConfirm.zone].displayName
        message = `${name}을(를) ${destName}(으)로 이동하시겠습니까?`
      }

      async function confirm() {
        if (actionLoading) return
        setActionLoading(true)
        try {
          if (pendingConfirm!.type === 'char') {
            await declareCharacter(roomCode, {
              playerId: uid!,
              characterId: pendingConfirm!.charId,
              order: game!.declarationOrder.indexOf(uid!),
              declaredAt: Date.now(),
            })
          } else {
            await selectDestination(roomCode, pendingConfirm!.zone)
            await confirmDestination(roomCode)
          }
        } finally {
          setActionLoading(false)
          setPendingConfirm(null)
        }
      }

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPendingConfirm(null)}>
          <div className="bg-zinc-900 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl border border-zinc-700" onClick={e => e.stopPropagation()}>
            <p className="text-white text-sm font-semibold text-center leading-relaxed">{message}</p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setPendingConfirm(null)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
                취소
              </button>
              <button onClick={confirm} disabled={actionLoading} className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold transition-colors">
                확정
              </button>
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}
