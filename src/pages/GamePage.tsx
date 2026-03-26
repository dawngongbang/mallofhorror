import { useEffect, useRef, useState } from 'react'
import {
  subscribeToGame, declareCharacter,
  selectDestination, confirmDestination,
  selectVote, confirmVote,
  patchGameState, subscribeToMyItems, submitItemSearchChoice,
  submitSheriffRollRequest, submitVictimChoice,
  useThreatItem, useCctvItem, submitWeaponConfirm, submitWeaponUsePass,
  submitZombiePlayerZoneChoice,
} from '../firebase/gameService'
import { subscribeToPlayers, subscribeToMeta } from '../firebase/roomService'
import { getCurrentUid } from '../firebase/auth'
import { hostRollDice, hostApplyDiceRoll, hostPrepareMovement, hostApplyNextMoveStep, hostResolveVote, hostEndRound, hostResolveItemSearch } from '../firebase/hostService'
import { deleteRoom } from '../firebase/roomService'
import { rollAndGetPlacementOptions, placeCharacter, startFirstRound } from '../engine/setup'
import { startZoneAttackPhase, startZoneSurvivorPhase, determineSurvivorEvent, checkAndCloseZone } from '../engine/event'
import { calculateVoteResult, calcDefense, isUnderAttack } from '../engine/combat'
import { EVENT_ZONE_ORDER, ZONE_CONFIGS, CHARACTER_CONFIGS, ITEM_CONFIGS, DICE_TO_ZONE } from '../engine/constants'
import { isZoneFull } from '../engine/dice'
import type { GameState, Player, RoomMeta, ZoneName } from '../engine/types'
import RulesModal from '../components/RulesModal'

const ZONE_ORDER: ZoneName[] = ['bathroom', 'clothing', 'toy', 'parking', 'security', 'supermarket']

// 맵 이미지 위 구역 오버레이 위치 (컨테이너 기준 %)
const ZONE_MAP_POSITIONS: Record<ZoneName, { left: string; top: string; width?: string }> = {
  toy:         { left:  '1%', top:  '3%' },   // 좌상단
  security:    { left: '34%', top:  '1%' },   // 상단 중앙
  supermarket: { left: '67%', top:  '3%' },   // 우상단
  parking:     { left: '21%', top: '30%', width: '54%' }, // 중앙
  clothing:    { left:  '1%', top: '67%' },   // 좌하단
  bathroom:    { left: '67%', top: '67%' },   // 우하단
}

// instanceId 예: "hidden_card_0", "sprint_2", "axe_0" → itemId 추출
function instanceIdToItemId(instanceId: string): string {
  const parts = instanceId.split('_')
  parts.pop()
  return parts.join('_')
}

const ITEM_CATEGORY: Record<string, string> = {
  axe: '🪓', pistol: '🔫', shotgun: '🔫', bat: '🏏', grenade: '💣', chainsaw: '⚙️',
  sprint: '👟', hidden_card: '🫥', threat: '😤', hardware: '🔧', cctv: '📷',
}

const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

const PHASE_LABEL: Record<string, string> = {
  setup_place: '초기 배치', roll_dice: '주사위', dice_reveal: '주사위 공개',
  character_select: '캐릭터 선언', destination_seal: '목적지 선택',
  destination_reveal: '공개', move_execute: '이동',
  event: '이벤트', zone_announce: '구역 공지', weapon_use: '아이템 사용', voting: '투표',
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
    resolvedMoves:          Array.isArray(g.resolvedMoves)
                              ? g.resolvedMoves
                              : g.resolvedMoves && typeof g.resolvedMoves === 'object'
                                ? Object.values(g.resolvedMoves) as import('../engine/types').ResolvedMove[]
                                : [],
    currentMoveStep:        g.currentMoveStep        ?? 0,
    winners:                g.winners                ?? [],
    characterDeclarations:  g.characterDeclarations  ?? {},
    destinationStatus:      g.destinationStatus      ?? {},
    sealedDestinations:     g.sealedDestinations     ?? {},
    characters:             g.characters             ?? {},
    zones:                  normalizedZones,
    finalScores:            g.finalScores            ?? {},
    playerItemCounts:       g.playerItemCounts       ?? {},
    currentVote:            normalizedVote,
    itemSearchPreview:      g.itemSearchPreview ? toArray(g.itemSearchPreview) : null,
    pendingVictimSelection: g.pendingVictimSelection ?? null,
    lastVoteAnnounce:       g.lastVoteAnnounce
                              ? { ...g.lastVoteAnnounce, votes: g.lastVoteAnnounce.votes ?? {}, bonusVoteWeights: g.lastVoteAnnounce.bonusVoteWeights ?? {} }
                              : null,
    lastZombieAttackResult: g.lastZombieAttackResult ?? null,
    cctvViewers:            Array.isArray(g.cctvViewers) ? g.cctvViewers : [],
    weaponUseStatus:        (g.weaponUseStatus && typeof g.weaponUseStatus === 'object') ? g.weaponUseStatus : {},
    weaponKillChoices:      (g.weaponKillChoices && typeof g.weaponKillChoices === 'object') ? g.weaponKillChoices : {},
    pendingHideChoices:     (g.pendingHideChoices && typeof g.pendingHideChoices === 'object') ? g.pendingHideChoices : {},
    pendingSprintChoices:   (g.pendingSprintChoices && typeof g.pendingSprintChoices === 'object') ? g.pendingSprintChoices : {},
    pendingHardwareChoices: (g.pendingHardwareChoices && typeof g.pendingHardwareChoices === 'object') ? g.pendingHardwareChoices : {},
    hiddenCharacters:       (g.hiddenCharacters && typeof g.hiddenCharacters === 'object') ? g.hiddenCharacters : {},
    lastSprintAnnounce:     g.lastSprintAnnounce ?? null,
    lastHideRevealAnnounce: g.lastHideRevealAnnounce ?? null,
    lastWeaponUseAnnounce:  g.lastWeaponUseAnnounce
                              ? { ...g.lastWeaponUseAnnounce, killsByPlayer: g.lastWeaponUseAnnounce.killsByPlayer ?? {} }
                              : null,
    zombiePlayerZoneChoices: (g.zombiePlayerZoneChoices && typeof g.zombiePlayerZoneChoices === 'object') ? g.zombiePlayerZoneChoices : {},
    lastZombiePlayerAnnounce: g.lastZombiePlayerAnnounce
                              ? { entries: Array.isArray(g.lastZombiePlayerAnnounce.entries) ? g.lastZombiePlayerAnnounce.entries : Object.values(g.lastZombiePlayerAnnounce.entries ?? {}) }
                              : null,
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
  // weapon_use 페이즈: 로컬에서 선택한 무기 instanceId 목록 (확정 전까지 Firebase 미기록)
  const [stagedWeapons, setStagedWeapons] = useState<Set<string>>(new Set())
  // weapon_use 페이즈: 숨기 아이템 선택 상태 (instanceId, 숨길 charId)
  const [stagedHideItemId, setStagedHideItemId] = useState<string | null>(null)
  const [stagedHideCharId, setStagedHideCharId] = useState<string | null>(null)
  // weapon_use 페이즈: 스프린트 아이템 선택 상태 (instanceId, 이동할 charId, 목적지 zone)
  const [stagedSprintItemId, setStagedSprintItemId] = useState<string | null>(null)
  const [stagedSprintCharId, setStagedSprintCharId] = useState<string | null>(null)
  const [stagedSprintTargetZone, setStagedSprintTargetZone] = useState<ZoneName | null>(null)
  // weapon_use 페이즈: 하드웨어 아이템 선택 상태 (instanceId)
  const [stagedHardwareItemId, setStagedHardwareItemId] = useState<string | null>(null)
  const gameRef = useRef<GameState | null>(null)
  gameRef.current = game  // 항상 최신 game 참조 (stale closure 방지)
  // 트럭 수색 아이템 선택 상태
  const [truckKept, setTruckKept] = useState<string | null>(null)
  const [truckGiven, setTruckGiven] = useState<string | null>(null)
  const [truckGivenTo, setTruckGivenTo] = useState<string | null>(null)
  const processingRef = useRef(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [confirmingItems, setConfirmingItems] = useState<Set<string>>(new Set())
  const [showRules, setShowRules] = useState(false)
  const uid = getCurrentUid()

  useEffect(() => {
    const unsubGame = subscribeToGame(roomCode, g => setGame(g ? normalizeGame(g) : null))
    const unsubPlayers = subscribeToPlayers(roomCode, setPlayers)
    const unsubMeta = subscribeToMeta(roomCode, setMeta)
    const unsubItems = uid ? subscribeToMyItems(roomCode, uid, setMyItemIds) : () => {}
    return () => { unsubGame(); unsubPlayers(); unsubMeta(); unsubItems() }
  }, [roomCode, uid])

  // weapon_use 페이즈 이탈 시 staged 초기화
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

  // ── 호스트 자동 진행 ─────────────────────────────────────────
  const isHost = meta?.hostId === uid
  useEffect(() => {
    if (!isHost || !game || processingRef.current) return

    async function runHostStep() {
      if (!game || processingRef.current) return
      console.log('[HOST] runHostStep phase:', game?.phase, 'pvs:', game?.pendingVictimSelection, 'processing:', processingRef.current)
      processingRef.current = true
      let didWork = false
      try {
        // roll_dice: 보안관이 요청하면 주사위 굴리기
        if (game.phase === 'roll_dice' && game.sheriffRollRequest) {
          await hostRollDice(roomCode, game)
          didWork = true
        }

        // character_select: 연결 끊긴 플레이어 자동 선언
        else if (game.phase === 'character_select') {
          const currentDeclarer = game.declarationOrder.find(pid => !game.characterDeclarations[pid])
          if (currentDeclarer && players[currentDeclarer]?.isConnected === false) {
            const firstChar = Object.values(game.characters).find(c => c.playerId === currentDeclarer && c.isAlive)
            if (firstChar) {
              const autoOrder = Object.keys(game.characterDeclarations).length
              await patchGameState(roomCode, {
                characterDeclarations: {
                  ...game.characterDeclarations,
                  [currentDeclarer]: { playerId: currentDeclarer, characterId: firstChar.id, order: autoOrder, declaredAt: Date.now() },
                },
              })
              didWork = true
            }
          }
          // 전원 선언 완료 → destination_seal (전멸 플레이어 제외)
          else {
            const alivePlayers = game.playerOrder.filter(pid =>
              Object.values(game.characters).some(c => c.playerId === pid && c.isAlive)
            )
            const declared = Object.keys(game.characterDeclarations)
            if (declared.length >= alivePlayers.length) {
              const sealMs = (meta?.settings.sealTime ?? 60) * 1000
              await patchGameState(roomCode, { phase: 'destination_seal', phaseDeadline: Date.now() + sealMs })
              didWork = true
            }
          }
        }

        // destination_seal: 연결 끊긴 플레이어 즉시 자동 확정
        else if (game.phase === 'destination_seal') {
          const alivePlayers = game.playerOrder.filter(pid =>
            Object.values(game.characters).some(c => c.playerId === pid && c.isAlive)
          )
          const disconnectedUnsettled = alivePlayers.filter(pid =>
            players[pid]?.isConnected === false && !game.destinationStatus[pid]
          )
          if (disconnectedUnsettled.length > 0) {
            const statusPatch: Record<string, boolean> = {}
            const sealedPatch: Record<string, unknown> = {}
            for (const pid of disconnectedUnsettled) {
              statusPatch[pid] = true
              if (!game.sealedDestinations[pid]) {
                const charId = game.characterDeclarations[pid]?.characterId
                const char = charId ? game.characters[charId] : null
                if (char) sealedPatch[pid] = { playerId: pid, targetZone: char.zone, submittedAt: Date.now() }
              }
            }
            await patchGameState(roomCode, {
              destinationStatus: { ...game.destinationStatus, ...statusPatch },
              ...(Object.keys(sealedPatch).length > 0 ? { sealedDestinations: { ...game.sealedDestinations, ...sealedPatch } as typeof game.sealedDestinations } : {}),
            })
            didWork = true
          }
          // 전원 봉인 완료 → 이동 계획 수립
          else {
            const sealed = Object.values(game.destinationStatus).filter(Boolean).length
            if (sealed >= alivePlayers.length) {
              await hostPrepareMovement(roomCode, game)
              didWork = true
            }
          }
        }

        // weapon_use: 해당 구역 생존 플레이어 전원 확정 시 조기 종료
        else if (game.phase === 'weapon_use') {
          const zone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
          const zoneState = game.zones[zone]
          // 숨긴 캐릭터도 포함 (alive 기준) — 단, 해당 플레이어가 weaponUseStatus를 명시적으로 세팅해야 확정으로 인정
          const inZonePlayers = [...new Set(
            zoneState.characterIds
              .map(id => game.characters[id])
              .filter(c => c?.isAlive)
              .map(c => c!.playerId)
          )]
          // weaponUseStatus에 최소 1명 이상 기록돼야 조기종료 판단 (Firebase 중간 상태 방어)
          const hasAnyStatus = Object.keys(game.weaponUseStatus ?? {}).length > 0
          const allConfirmed = inZonePlayers.length === 0 ||
            (hasAnyStatus && inZonePlayers.every(pid => game.weaponUseStatus[pid]))
          if (allConfirmed) {
            const nextZoneIndex = game.currentEventZoneIndex + 1
            const voteMs = (meta?.settings.votingTime ?? 60) * 1000

            // ── 스프린트: 캐릭터 이동 먼저 처리 ──
            const pendingSprints = game.pendingSprintChoices ?? {}
            type SprintEntry = { playerId: string; charId: string; fromZone: ZoneName; toZone: ZoneName }
            const sprintEntries: SprintEntry[] = []
            let sprintZones = { ...game.zones }
            let sprintChars = { ...game.characters }
            for (const [pid, choice] of Object.entries(pendingSprints)) {
              const { charId, targetZone } = choice as { charId: string; targetZone: ZoneName }
              const char = sprintChars[charId]
              if (!char || !char.isAlive) continue
              const fromZone = char.zone as ZoneName
              const tgtState = sprintZones[targetZone]
              const tgtConfig = ZONE_CONFIGS[targetZone]
              const actualTarget: ZoneName = tgtState.characterIds.length < tgtConfig.maxCapacity ? targetZone : 'parking'
              sprintZones = {
                ...sprintZones,
                [fromZone]: { ...sprintZones[fromZone], characterIds: sprintZones[fromZone].characterIds.filter(id => id !== charId) },
                [actualTarget]: { ...sprintZones[actualTarget], characterIds: [...sprintZones[actualTarget].characterIds, charId] },
              }
              sprintChars = { ...sprintChars, [charId]: { ...char, zone: actualTarget } }
              sprintEntries.push({ playerId: pid, charId, fromZone, toZone: actualTarget })
            }
            const sprintAnnounce = sprintEntries.length > 0 ? { entries: sprintEntries } : null

            // ── 하드웨어: 방어 보너스 합산 ──
            const hardwareBonus = Object.values(game.pendingHardwareChoices ?? {}).reduce((a, b) => a + b, 0)

            // ── 무기 kill 합산 ──
            const killChoices = game.weaponKillChoices ?? {}
            const totalKill = Object.values(killChoices).reduce((a, b) => a + b, 0)
            const prevZombies = sprintZones[zone].zombies
            const newZombies = Math.max(0, prevZombies - totalKill)
            const updatedGame = {
              ...game,
              zones: { ...sprintZones, [zone]: { ...sprintZones[zone], zombies: newZombies } },
              characters: sprintChars,
              weaponKillChoices: {},
            }

            // ── 공지 준비 ──
            const killsByPlayer: Record<string, number> = {}
            for (const [pid, k] of Object.entries(killChoices)) {
              if (k > 0) killsByPlayer[pid] = k
            }
            const weaponAnnounce = totalKill > 0
              ? { zone, killsByPlayer, totalKill, remainingZombies: newZombies }
              : null
            const pendingHides = game.pendingHideChoices ?? {}
            const hiddenEntries = Object.entries(pendingHides).map(([pid, charId]) => ({
              playerId: pid, charId, zone,
            })).filter(e => game.characters[e.charId])
            const newHiddenChars = Object.fromEntries(Object.values(pendingHides).map(charId => [charId, true]))
            const hideAnnounce = hiddenEntries.length > 0 ? { type: 'hide' as const, entries: hiddenEntries } : null

            await patchGameState(roomCode, {
              zones: updatedGame.zones,
              characters: updatedGame.characters,
              weaponKillChoices: {},
              pendingHideChoices: {},
              pendingSprintChoices: {},
              pendingHardwareChoices: {},
              ...(weaponAnnounce ? { lastWeaponUseAnnounce: weaponAnnounce } : {}),
              ...(hideAnnounce ? { lastHideRevealAnnounce: hideAnnounce, hiddenCharacters: newHiddenChars } : {}),
              ...(sprintAnnounce ? { lastSprintAnnounce: sprintAnnounce } : {}),
            })
            const attackState = startZoneAttackPhase(zone, updatedGame, hardwareBonus)
            if (attackState) {
              await patchGameState(roomCode, { currentVote: attackState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
            } else {
              const survivorState = startZoneSurvivorPhase(zone, updatedGame)
              const revealAnnounce = hiddenEntries.length > 0
                ? { type: 'reveal' as const, entries: hiddenEntries }
                : null
              if (survivorState) {
                await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
              } else if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
                if (revealAnnounce) {
                  await patchGameState(roomCode, { hiddenCharacters: {}, lastHideRevealAnnounce: revealAnnounce })
                  await new Promise<void>(r => setTimeout(r, 1500))
                }
                await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: {} })
              } else {
                if (revealAnnounce) {
                  await patchGameState(roomCode, { hiddenCharacters: {}, lastHideRevealAnnounce: revealAnnounce })
                  await new Promise<void>(r => setTimeout(r, 1500))
                }
                await hostEndRound(roomCode, { ...updatedGame, hiddenCharacters: {} })
              }
            }
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

        // voting: 패배자가 희생 캐릭터 선택 완료 → 처리
        else if (game.phase === 'voting' && game.pendingVictimSelection?.chosenCharacterId) {
          const pvs = game.pendingVictimSelection
          console.log('[HOST] victim chosen:', pvs.chosenCharacterId, 'zone:', pvs.zone)
          const nextState = await hostResolveVote(roomCode, game, pvs.chosenCharacterId)
          console.log('[HOST] hostResolveVote done after victim selection, phase:', nextState.phase)
          await patchGameState(roomCode, { pendingVictimSelection: null })
          if (nextState.phase === 'event' && !nextState.itemSearchPreview) {
            await patchGameState(roomCode, { phase: 'zone_announce' })
          }
          didWork = true
        }

        // voting: 전원 확정 → 투표 결과 공지 세팅 (실제 처리는 별도 useEffect에서)
        else if (game.phase === 'voting' && game.currentVote && !game.pendingVictimSelection && !game.lastVoteAnnounce) {
          const cv = game.currentVote
          const allVoted = cv.eligibleVoters.length > 0 &&
            cv.eligibleVoters.every(id => cv.status[id])
          if (allVoted) {
            const result = calculateVoteResult(cv, game)
            await patchGameState(roomCode, {
              lastVoteAnnounce: { votes: cv.votes ?? {}, tally: result.tally, bonusVoteWeights: cv.bonusVoteWeights ?? {} },
            })
            didWork = true
          }
        }
      } catch (err) {
        console.error('[HOST] runHostStep error:', err)
      } finally {
        processingRef.current = false
        // 실제로 작업을 수행한 경우에만 재실행 신호 (무한루프 방지)
        if (didWork) setProcessSignal(s => s + 1)
      }
    }

    runHostStep()
  }, [game, isHost, roomCode, processSignal])

  // ── destination_seal 타임아웃: 미확정자 자동 처리 ───────────
  useEffect(() => {
    if (!isHost || game?.phase !== 'destination_seal' || !game.phaseDeadline) return
    const remaining = game.phaseDeadline - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'destination_seal') return
      const statusPatch: Record<string, boolean> = {}
      const sealedPatch: Record<string, unknown> = {}
      let needsPatch = false
      const alivePlayers = g.playerOrder.filter(pid =>
        Object.values(g.characters).some(c => c.playerId === pid && c.isAlive)
      )
      for (const playerId of alivePlayers) {
        if (!g.destinationStatus[playerId]) {
          statusPatch[playerId] = true
          needsPatch = true
          // 임시 선택도 없으면 현재 위치 유지 (이동 안 함)
          if (!g.sealedDestinations[playerId]) {
            const charId = g.characterDeclarations[playerId]?.characterId
            const char = charId ? g.characters[charId] : null
            if (char) sealedPatch[playerId] = { playerId, targetZone: char.zone, submittedAt: Date.now() }
          }
        }
      }
      if (needsPatch) {
        await patchGameState(roomCode, {
          destinationStatus: { ...g.destinationStatus, ...statusPatch },
          ...(Object.keys(sealedPatch).length > 0 ? { sealedDestinations: { ...g.sealedDestinations, ...sealedPatch } as typeof g.sealedDestinations } : {}),
        })
      }
    }, remaining)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.phaseDeadline, isHost, roomCode])

  // ── weapon_use 타임아웃: 좀비 재계산 후 투표 or 통과 ─────────
  useEffect(() => {
    if (!isHost || game?.phase !== 'weapon_use' || !game.phaseDeadline) return
    const remaining = game.phaseDeadline - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'weapon_use') return
      const zone = EVENT_ZONE_ORDER[g.currentEventZoneIndex]
      const nextZoneIndex = g.currentEventZoneIndex + 1
      const voteMs = (meta?.settings.votingTime ?? 60) * 1000
      // ── 스프린트 처리 ──
      const pendingSprintsG = g.pendingSprintChoices ?? {}
      type SprintEntryG = { playerId: string; charId: string; fromZone: ZoneName; toZone: ZoneName }
      const sprintEntriesG: SprintEntryG[] = []
      let sprintZonesG = { ...g.zones }
      let sprintCharsG = { ...g.characters }
      for (const [pid, choice] of Object.entries(pendingSprintsG)) {
        const { charId, targetZone } = choice as { charId: string; targetZone: ZoneName }
        const char = sprintCharsG[charId]
        if (!char || !char.isAlive) continue
        const fromZone = char.zone as ZoneName
        const tgtState = sprintZonesG[targetZone]
        const tgtConfig = ZONE_CONFIGS[targetZone]
        const actualTarget: ZoneName = tgtState.characterIds.length < tgtConfig.maxCapacity ? targetZone : 'parking'
        sprintZonesG = {
          ...sprintZonesG,
          [fromZone]: { ...sprintZonesG[fromZone], characterIds: sprintZonesG[fromZone].characterIds.filter(id => id !== charId) },
          [actualTarget]: { ...sprintZonesG[actualTarget], characterIds: [...sprintZonesG[actualTarget].characterIds, charId] },
        }
        sprintCharsG = { ...sprintCharsG, [charId]: { ...char, zone: actualTarget } }
        sprintEntriesG.push({ playerId: pid, charId, fromZone, toZone: actualTarget })
      }
      const sprintAnnounceG = sprintEntriesG.length > 0 ? { entries: sprintEntriesG } : null
      // ── 하드웨어 보너스 ──
      const hardwareBonusG = Object.values(g.pendingHardwareChoices ?? {}).reduce((a, b) => a + b, 0)
      // ── 무기 kill 합산 ──
      const killChoicesG = g.weaponKillChoices ?? {}
      const totalKill = Object.values(killChoicesG).reduce((a, b) => a + b, 0)
      const newZombies = Math.max(0, sprintZonesG[zone].zombies - totalKill)
      const updatedG = {
        ...g,
        zones: { ...sprintZonesG, [zone]: { ...sprintZonesG[zone], zombies: newZombies } },
        characters: sprintCharsG,
        weaponKillChoices: {},
      }
      const killsByPlayerG: Record<string, number> = {}
      for (const [pid, k] of Object.entries(killChoicesG)) {
        if (k > 0) killsByPlayerG[pid] = k
      }
      const weaponAnnounceG = totalKill > 0
        ? { zone, killsByPlayer: killsByPlayerG, totalKill, remainingZombies: newZombies }
        : null
      const pendingHidesG = g.pendingHideChoices ?? {}
      const hiddenEntries = Object.entries(pendingHidesG).map(([pid, charId]) => ({
        playerId: pid, charId, zone,
      })).filter(e => g.characters[e.charId])
      const newHiddenCharsG = Object.fromEntries(Object.values(pendingHidesG).map(charId => [charId, true]))
      const hideAnnounce = hiddenEntries.length > 0 ? { type: 'hide' as const, entries: hiddenEntries } : null
      await patchGameState(roomCode, {
        zones: updatedG.zones,
        characters: updatedG.characters,
        weaponKillChoices: {},
        pendingHideChoices: {},
        pendingSprintChoices: {},
        pendingHardwareChoices: {},
        ...(weaponAnnounceG ? { lastWeaponUseAnnounce: weaponAnnounceG } : {}),
        ...(hideAnnounce ? { lastHideRevealAnnounce: hideAnnounce, hiddenCharacters: newHiddenCharsG } : {}),
        ...(sprintAnnounceG ? { lastSprintAnnounce: sprintAnnounceG } : {}),
      })
      // 좀비 감소 후 습격 여부 재판정
      const attackState = startZoneAttackPhase(zone, updatedG, hardwareBonusG)
      if (attackState) {
        await patchGameState(roomCode, { currentVote: attackState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
        return
      }
      const revealAnnounce = hiddenEntries.length > 0 ? { type: 'reveal' as const, entries: hiddenEntries } : null
      // 습격 면함 → survivor 이벤트 체크
      const survivorState = startZoneSurvivorPhase(zone, updatedG)
      if (survivorState) {
        await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
        return
      }
      if (revealAnnounce) {
        await patchGameState(roomCode, { hiddenCharacters: {}, lastHideRevealAnnounce: revealAnnounce })
        await new Promise<void>(r => setTimeout(r, 1500))
      }
      if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
        await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: {} })
      } else {
        await hostEndRound(roomCode, { ...updatedG, hiddenCharacters: {} })
      }
    }, remaining)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.phaseDeadline, isHost, roomCode])

  // ── voting 타임아웃: 미확정자 자동 처리 ──────────────────────
  useEffect(() => {
    if (!isHost || game?.phase !== 'voting' || !game.phaseDeadline || !game.currentVote) return
    const remaining = game.phaseDeadline - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'voting' || !g.currentVote) return
      const cv = g.currentVote
      if (cv.eligibleVoters.every(id => cv.status[id])) return  // 이미 전원 확정
      const newStatus = { ...cv.status }
      for (const id of cv.eligibleVoters) {
        if (!cv.status[id]) newStatus[id] = true
      }
      await patchGameState(roomCode, { currentVote: { ...cv, status: newStatus } })
    }, remaining)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.phaseDeadline, isHost, roomCode])

  // ── 투표 결과 공지 → 4초 후 실제 처리 ───────────────────────
  useEffect(() => {
    if (!isHost || game?.phase !== 'voting' || !game.lastVoteAnnounce || game.pendingVictimSelection) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'voting' || !g.currentVote || !g.lastVoteAnnounce) return
      const cv = g.currentVote
      // ※ lastVoteAnnounce: null은 반드시 투표 처리 patchGameState와 동시에 적용해야 함
      //   별도 await로 먼저 null 처리하면 runHostStep이 구 투표(status 모두 true)를 감지해 재설정하는 버그 발생

      if (cv.type === 'zombie_attack') {
        const result = calculateVoteResult(cv, g)
        if (result.winner) {
          const loserCharsInZone = Object.values(g.characters)
            .filter(c => c.playerId === result.winner && c.isAlive && g.zones[cv.zone].characterIds.includes(c.id))
          if (loserCharsInZone.length <= 1) {
            const nextState = await hostResolveVote(roomCode, g, loserCharsInZone[0]?.id)
            if (nextState.phase === 'event' && !nextState.itemSearchPreview) {
              await patchGameState(roomCode, { phase: 'zone_announce' })
            }
          } else {
            // pendingVictimSelection 설정과 동시에 announce 해제
            await patchGameState(roomCode, { pendingVictimSelection: { zone: cv.zone, loserPlayerId: result.winner }, lastVoteAnnounce: null })
          }
        } else {
          await hostResolveVote(roomCode, g, undefined)
        }
      } else {
        const nextState = await hostResolveVote(roomCode, g, undefined)
        if (nextState.phase === 'event' && !nextState.itemSearchPreview) {
          await patchGameState(roomCode, { phase: 'zone_announce' })
        }
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [game?.phase, !!game?.lastVoteAnnounce, isHost, roomCode])

  // ── 숨기/등장 공지 → 5초 후 자동 해제 ───────────────────────
  useEffect(() => {
    if (!isHost || !game?.lastHideRevealAnnounce) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g?.lastHideRevealAnnounce) return
      await patchGameState(roomCode, { lastHideRevealAnnounce: null })
    }, 5000)
    return () => clearTimeout(timer)
  }, [!!game?.lastHideRevealAnnounce, game?.lastHideRevealAnnounce?.type, isHost, roomCode])

  // ── weapon_use 공지 → 5초 후 자동 해제 ───────────────────────
  useEffect(() => {
    if (!isHost || !game?.lastWeaponUseAnnounce) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g?.lastWeaponUseAnnounce) return
      await patchGameState(roomCode, { lastWeaponUseAnnounce: null })
    }, 5000)
    return () => clearTimeout(timer)
  }, [!!game?.lastWeaponUseAnnounce, isHost, roomCode])

  // ── 좀비 플레이어 공지 → 5초 후 자동 해제 ───────────────────────
  useEffect(() => {
    if (!isHost || !game?.lastZombiePlayerAnnounce) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g?.lastZombiePlayerAnnounce) return
      await patchGameState(roomCode, { lastZombiePlayerAnnounce: null })
    }, 5000)
    return () => clearTimeout(timer)
  }, [!!game?.lastZombiePlayerAnnounce, isHost, roomCode])

  // ── 스프린트 공지 → 5초 후 자동 해제 ─────────────────────────
  useEffect(() => {
    if (!isHost || !game?.lastSprintAnnounce) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g?.lastSprintAnnounce) return
      await patchGameState(roomCode, { lastSprintAnnounce: null })
    }, 5000)
    return () => clearTimeout(timer)
  }, [!!game?.lastSprintAnnounce, isHost, roomCode])

  // ── dice_reveal: 3초 후 자동 좀비 배치 ───────────────────────
  useEffect(() => {
    if (!isHost || !game || game.phase !== 'dice_reveal') return
    const capturedGame = game
    const timer = setTimeout(async () => {
      await hostApplyDiceRoll(roomCode, capturedGame)
    }, 3000)
    return () => clearTimeout(timer)
  }, [game?.phase, isHost, roomCode])

  // ── move_execute: 1.5초 간격으로 이동 단계 처리 ──────────────
  useEffect(() => {
    if (!isHost || !game || game.phase !== 'move_execute') return
    const step = game.currentMoveStep
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'move_execute' || g.currentMoveStep !== step) return
      await hostApplyNextMoveStep(roomCode, g)
    }, 2000)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.currentMoveStep, isHost, roomCode])

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

      // 숨은 캐릭터 reveal 공지 헬퍼
      const buildReveal = (state: typeof g) => {
        const entries = Object.keys(state.hiddenCharacters ?? {}).map(charId => ({
          playerId: state.characters[charId]?.playerId ?? '',
          charId,
          zone,
        })).filter(e => e.playerId)
        return entries.length > 0 ? { type: 'reveal' as const, entries } : null
      }

      // 폐쇄 조건 체크 (좀비 8개 이상 + 사람 없음 → 폐쇄)
      const closedState = checkAndCloseZone(zone, g)
      if (closedState) {
        if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
          await patchGameState(roomCode, { zones: closedState.zones, currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: {} })
        } else {
          await hostEndRound(roomCode, { ...closedState, hiddenCharacters: {} })
        }
        return
      }

      // 이미 폐쇄된 구역이면 스킵
      if (g.zones[zone].isClosed) {
        if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
          await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: {} })
        } else {
          await hostEndRound(roomCode, { ...g, hiddenCharacters: {} })
        }
        return
      }

      const voteMs = (meta?.settings.votingTime ?? 60) * 1000
      const attackState = startZoneAttackPhase(zone, g)
      if (attackState) {
        // 습격 발생 → 무기 사용 기회 먼저 (15초)
        await patchGameState(roomCode, { phase: 'weapon_use', phaseDeadline: Date.now() + 15000, weaponUseStatus: {}, weaponKillChoices: {} })
        return
      }
      const survivorState = startZoneSurvivorPhase(zone, g)
      if (survivorState) {
        await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
        return
      }
      const revealAnnounce = buildReveal(g)
      if (revealAnnounce) {
        await patchGameState(roomCode, { hiddenCharacters: {}, lastHideRevealAnnounce: revealAnnounce, lastZombieAttackResult: null })
        await new Promise<void>(r => setTimeout(r, 1500))
      }
      if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
        await patchGameState(roomCode, {
          currentEventZoneIndex: nextZoneIndex,
          phase: 'event',
          lastZombieAttackResult: null,
          hiddenCharacters: {},
        })
      } else {
        await hostEndRound(roomCode, { ...g, hiddenCharacters: {} })
      }
    }, 4000)
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
    await submitSheriffRollRequest(roomCode)
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
  const mySealedZone = game.sealedDestinations[uid ?? '']?.targetZone   // 임시 선택
  const myDestConfirmed = !!(uid && game.destinationStatus[uid])          // 확정 여부
  const myMovingChar = uid ? game.characterDeclarations[uid]?.characterId : undefined
  const myMovingCharData = myMovingChar ? game.characters[myMovingChar] : undefined

  async function handleSelectDestination(zone: ZoneName) {
    if (!uid || myDestConfirmed || actionLoading) return
    setActionLoading(true)
    await selectDestination(roomCode, zone)
    setActionLoading(false)
  }

  async function handleConfirmDestination() {
    if (!uid || !mySealedZone || myDestConfirmed || actionLoading) return
    setActionLoading(true)
    await confirmDestination(roomCode)
    setActionLoading(false)
  }

  // ── voting ───────────────────────────────────────────────────
  const myVote = uid && game.currentVote ? game.currentVote.votes[uid] : undefined
  const myVoteConfirmed = !!(uid && game.currentVote?.status[uid])

  async function handleSelectVote(targetPlayerId: string) {
    if (!uid || !game?.currentVote || myVoteConfirmed || actionLoading) return
    setActionLoading(true)
    await selectVote(roomCode, targetPlayerId)
    setActionLoading(false)
  }

  async function handleConfirmVote() {
    if (!uid || !myVote || myVoteConfirmed || actionLoading) return
    setActionLoading(true)
    await confirmVote(roomCode)
    setActionLoading(false)
  }

  // ── 아이템 사용 핸들러 ────────────────────────────────────────
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
      // 숨기 아이템: stage하고 캐릭터 선택 대기
      setStagedHideItemId(instanceId)
      setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
    } else {
      // 무기 아이템: stage에 추가 (즉시 Firebase 기록 안 함)
      setStagedWeapons(prev => new Set([...prev, instanceId]))
      setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })
    }
  }

  // weapon_use 최종 확정: staged 무기 + 숨기 일괄 제출
  async function handleWeaponConfirm() {
    if (actionLoading) return
    setActionLoading(true)
    try {
      const staged = [...stagedWeapons]
      const hideItemId = stagedHideItemId
      const sprintItemId = stagedSprintItemId
      const hardwareItemId = stagedHardwareItemId

      // 숨기: charId 없으면 구역 내 내 첫 캐릭터 자동 선택
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

  // ── 존 보드 ──────────────────────────────────────────────────
  function renderZone(zoneName: ZoneName) {
    const zoneState = game!.zones[zoneName]
    const config = ZONE_CONFIGS[zoneName]
    const chars = zoneState.characterIds.map(id => game!.characters[id]).filter(Boolean)
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

    return (
      <div
        key={zoneName}
        style={{ left: pos.left, top: pos.top, width: pos.width ?? '29%' }}
        className={`absolute rounded-lg p-1.5 flex flex-col gap-1 text-xs backdrop-blur-sm transition-all z-10
          ${zoneState.isClosed
            ? 'bg-zinc-950/85 opacity-70 ring-1 ring-zinc-700'
            : isVotingZone   ? 'bg-red-950/90 ring-2 ring-red-500 z-20'
            : isWeaponZone   ? 'bg-orange-950/90 ring-2 ring-orange-400 z-20'
            : isAnnounceZone ? 'bg-yellow-950/90 ring-2 ring-yellow-400 z-20'
            : isEventZone    ? 'bg-zinc-900/90 ring-2 ring-yellow-600 z-20'
            : 'bg-zinc-950/80 ring-1 ring-zinc-700/60'}`}
      >
        {/* 구역명 + 상태 배지 */}
        <div className="flex items-center justify-between gap-0.5">
          <span className={`font-bold leading-tight truncate ${zoneState.isClosed ? 'text-zinc-500 line-through' : 'text-white'}`}>
            <span className="text-zinc-400 mr-0.5">{config.zoneNumber}</span>{config.displayName}
            {zoneState.isClosed && <span className="ml-1 text-red-600 no-underline not-italic">🔒</span>}
          </span>
          {phaseBadge && (
            <span className={`px-1 py-0.5 rounded text-[10px] font-bold shrink-0 ${phaseBadge.cls}`}>{phaseBadge.label}</span>
          )}
        </div>

        {/* 좀비 아이콘 */}
        <div className="flex flex-wrap gap-0 min-h-[18px] leading-none">
          {Array.from({ length: Math.min(zoneState.zombies, 9) }).map((_, i) => (
            <span key={i} className={`text-base leading-none ${isUnderAttackNow ? 'text-red-300' : ''}`}>🧟</span>
          ))}
          {zoneState.zombies > 9 && (
            <span className="text-red-400 font-bold text-xs self-center ml-0.5">+{zoneState.zombies - 9}</span>
          )}
          {zoneState.zombies === 0 && (
            <span className="text-zinc-600 text-[10px]">좀비 없음</span>
          )}
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
            const isMoving = game!.characterDeclarations[char.playerId]?.characterId === char.id
            const isHidden = !!(game!.hiddenCharacters?.[char.id])
            return (
              <div
                key={char.id}
                title={`${owner?.nickname ?? '?'} — ${charConfig?.name}${isHidden ? ' (숨음)' : ''}`}
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold
                  ${owner ? (COLOR_BG[owner.color] ?? 'bg-zinc-600') : 'bg-zinc-600'}
                  ${!char.isAlive ? 'opacity-20 text-white' : isHidden ? 'opacity-30 text-white border-dashed' : 'text-white'}
                  ${isMoving ? 'border-yellow-400' : isHidden ? 'border-purple-500' : 'border-zinc-600'}`}
              >
                {isHidden ? '🫥' : (charConfig?.name?.charAt(0) ?? '?')}
              </div>
            )
          })}
          {chars.filter(c => c.isAlive).length > 0 && (
            <span className="text-zinc-500 text-[10px] self-center ml-0.5">
              {chars.filter(c => c.isAlive).length}/{config.maxCapacity === Infinity ? '∞' : config.maxCapacity}
            </span>
          )}
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
        // 좀비 플레이어 구역 선택 (dice_reveal 중에도 가능)
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
              {(Object.keys(game!.zones) as import('../engine/types').ZoneName[])
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

        // 실제 보안관만 확인 가능 (CCTV 아이템 미구현으로 추후 추가 예정)
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
            <p className="text-zinc-500 text-xs">보너스 좀비(사람/미녀 최다)는 이동 완료 후 결정됩니다</p>
            <p className="text-zinc-600 text-xs mt-3">잠시 후 이동 페이즈가 시작됩니다...</p>
            {zombieSelectorDR}
          </div>
        )
      }

      // ── 주사위 (2라운드~) ────────────────────────────────────
      case 'roll_dice': {
        const isSheriff = uid === sheriffId
        // 좀비 플레이어: 모든 캐릭터가 죽은 플레이어
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
                {(Object.keys(game!.zones) as import('../engine/types').ZoneName[])
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

      // ── 캐릭터 선언 (보안관부터 순서대로) ────────────────────
      case 'character_select': {
        const declaredCount = Object.keys(game!.characterDeclarations).length
        const total = game!.declarationOrder.length  // 전멸 플레이어 제외된 수

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
        const confirmedCount = Object.values(game!.destinationStatus).filter(Boolean).length
        const total = game!.playerOrder.length

        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white text-sm font-bold">목적지 선택</p>
              {countdown !== null && (
                <span className={`text-xs font-mono tabular-nums ${countdown <= 10 ? 'text-red-400 font-bold' : 'text-zinc-400'}`}>
                  ⏰ {countdown}초
                </span>
              )}
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
                    <button key={zone} onClick={() => handleSelectDestination(zone)} disabled={actionLoading}
                      className={`text-white text-sm px-3 py-1.5 rounded-lg transition-colors ${
                        mySealedZone === zone
                          ? 'bg-yellow-600 ring-2 ring-yellow-400'
                          : 'bg-zinc-700 hover:bg-blue-600'
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
        const step = game!.currentMoveStep  // 지금까지 적용된 이동 수
        const doneMoves = moves.slice(0, step)   // 이미 처리된 이동들
        const currentMove = moves[step] ?? null  // 지금 공지 중인 이동 (아직 미적용)

        return (
          <div>
            <p className="text-zinc-500 text-xs mb-2">이동 공개 ({step}/{moves.length})</p>
            {/* 이미 처리된 이동 목록 */}
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
            {/* 현재 공지 중인 이동 */}
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
            {/* 모든 이동 완료 */}
            {!currentMove && moves.length > 0 && (
              <p className="text-zinc-400 text-xs mt-1">이동 완료. 좀비 배치 중...</p>
            )}
            {moves.length === 0 && (
              <p className="text-zinc-500 text-xs">이동할 캐릭터가 없습니다.</p>
            )}
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

            {/* 사망 공지 */}
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

      // ── 아이템 사용 (습격 직전) ───────────────────────────────
      case 'weapon_use': {
        const zone = EVENT_ZONE_ORDER[game!.currentEventZoneIndex]
        const config = ZONE_CONFIGS[zone]
        const zoneState = game!.zones[zone]
        const defense = calcDefense(zone, game!)

        // 해당 구역에 내 캐릭터가 있는지
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
                  <p className="text-yellow-300 text-sm mb-2">아이템 패널에서 무기·숨기를 선택하세요.</p>
                  {stagedWeapons.size > 0 && (
                    <p className="text-green-400 text-xs mb-1">무기 {stagedWeapons.size}장 선택됨</p>
                  )}
                  {/* 숨기 캐릭터 선택 UI */}
                  {stagedHideItemId && (() => {
                    const myCharsInZone = game!.zones[zone]?.characterIds
                      .filter(id => game!.characters[id]?.playerId === uid && game!.characters[id]?.isAlive) ?? []
                    return (
                      <div className="mb-2">
                        {myCharsInZone.length <= 1 ? (
                          <p className="text-purple-300 text-xs">
                            🫥 <strong>{CHARACTER_CONFIGS[game!.characters[myCharsInZone[0]]?.characterId]?.name ?? '?'}</strong> 숨김 예정
                          </p>
                        ) : (
                          <div>
                            <p className="text-purple-300 text-xs mb-1">🫥 숨길 캐릭터 선택:</p>
                            <div className="flex gap-2 flex-wrap justify-center">
                              {myCharsInZone.map(charId => {
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
                      const myCharsInZone = game!.zones[zone]?.characterIds
                        .filter(id => game!.characters[id]?.playerId === uid && game!.characters[id]?.isAlive) ?? []
                      return myCharsInZone.length > 1  // 캐릭터 여러 명인데 아직 선택 안 함
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
            {countdown !== null && (
              <p className={`text-lg font-mono font-bold mt-3 ${countdown <= 5 ? 'text-red-400' : 'text-zinc-400'}`}>
                ⏰ {countdown}초
              </p>
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
        // 패배자 희생 캐릭터 선택 대기 중
        const pvs = game!.pendingVictimSelection
        if (pvs && !pvs.chosenCharacterId) {
          const isLoser = uid === pvs.loserPlayerId
          if (isLoser) {
            const myCharsInZone = Object.values(game!.characters).filter(
              c => c.playerId === uid && c.isAlive && game!.zones[pvs.zone].characterIds.includes(c.id)
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

        const candidates = vote.candidates.map(id => ({
          id,
          nickname: players[id]?.nickname ?? '?',
          color: players[id]?.color ?? 'red',
        }))

        const confirmedCount = vote.eligibleVoters.filter(id => vote.status[id]).length
        const canVote = vote.eligibleVoters.includes(uid ?? '')

        // ── 투표 결과 공지 화면 ──────────────────────────────
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

              {/* 누가 누굴 뽑았는지 */}
              <div className="space-y-1 mb-3">
                {vote.eligibleVoters.map(voterId => {
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

              {/* 협박 아이템 사용 공지 */}
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

              {/* 최종 집계 */}
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

        // ── 투표 진행 화면 ────────────────────────────────────
        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-zinc-400">
                <span className="text-yellow-400 font-bold">{voteZone.displayName}</span> — {voteTypeLabel}
                {vote.round > 0 && <span className="text-zinc-500 text-xs"> (재투표 {vote.round}회차)</span>}
              </p>
              {countdown !== null && (
                <span className={`text-xs font-mono tabular-nums ${countdown <= 10 ? 'text-red-400 font-bold' : 'text-zinc-400'}`}>
                  ⏰ {countdown}초
                </span>
              )}
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

            <p className="text-zinc-600 text-xs mt-2">{confirmedCount} / {vote.eligibleVoters.length}명 확정</p>
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
    <>
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
          <button onClick={() => setShowRules(true)} className="text-zinc-600 hover:text-white text-xs transition-colors">📖 설명서</button>
          <button onClick={async () => {
            if (isHost) await deleteRoom(roomCode)
            onLeave()
          }} className="text-zinc-600 hover:text-white text-xs transition-colors">나가기</button>
        </div>
      </div>

      {/* 숨기/등장 공지 + weapon_use 결과 + 좀비 플레이어 공지 — fixed 오버레이 */}
      {(game.lastHideRevealAnnounce || game.lastWeaponUseAnnounce || game.lastZombiePlayerAnnounce) && (
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
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 존 보드 */}
        <div className="flex-1 p-4 overflow-y-auto">
          {/* 맵 보드 */}
          <div className="relative w-full max-w-xl mx-auto aspect-square">
            <img
              src={`${import.meta.env.BASE_URL}map.jpg`}
              alt="몰오브호러 맵"
              className="w-full h-full object-cover rounded-xl"
            />
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

          {/* 주사위 배너: 이동 페이즈 중에는 정식보안관/CCTV 사용자만, 이동 완료 후 전체 공개 */}
          {game.lastDiceRoll && !['roll_dice', 'dice_reveal', 'setup_place'].includes(game.phase) && (() => {
            const isMovementPhase = ['character_select', 'destination_seal', 'destination_reveal', 'move_execute'].includes(game.phase)
            const iAmRealSheriff = uid === sheriffId && game.isRealSheriff
            const iUsedCctv = uid ? game.cctvViewers.includes(uid) : false
            const canSeeZones = iAmRealSheriff || iUsedCctv

            // 이동 페이즈 중 정보 접근 불가한 경우
            if (isMovementPhase && !canSeeZones) {
              if (game.isRealSheriff) return null  // 정식보안관 있음 — 다른 플레이어는 숨김
              return (
                <div className="max-w-2xl mx-auto mt-3 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2 flex items-center gap-3">
                  <span className="text-yellow-600 text-xs font-bold">🎲 이번 라운드 주사위</span>
                  <span className="text-zinc-600 text-xs">정식보안관이 없어 아무도 cctv를 확인하지 못했습니다</span>
                </div>
              )
            }
            return (
              <div className="max-w-2xl mx-auto mt-3 bg-zinc-900 border border-yellow-800 rounded-xl px-4 py-2 flex items-center gap-3 flex-wrap">
                <span className="text-yellow-600 text-xs font-bold">🧟 이번 라운드 좀비</span>
                {iAmRealSheriff && (
                  <div className="flex gap-1">
                    {game.lastDiceRoll.dice.map((d, i) => (
                      <span key={i} className="w-7 h-7 bg-zinc-700 rounded-lg flex items-center justify-center text-sm font-bold text-white">{d}</span>
                    ))}
                  </div>
                )}
                {iUsedCctv && !iAmRealSheriff && (
                  <span className="text-purple-400 text-xs font-bold">📷 CCTV</span>
                )}
                <div className="flex flex-wrap gap-1 text-xs text-zinc-400">
                  {Object.entries(game.lastDiceRoll.zombiesByZone).map(([z, count]) => (
                    <span key={z}>{ZONE_CONFIGS[z as ZoneName]?.displayName} +{count}🧟</span>
                  ))}
                </div>
                {!game.isRealSheriff && (
                  <span className="text-zinc-600 text-xs">· 정식보안관 없음</span>
                )}
              </div>
            )
          })()}

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

                  // 사용 가능한 아이템 여부
                  const canUseCctv = itemId === 'cctv' && !!game.lastDiceRoll && !game.cctvViewers.includes(uid ?? '')
                  const canUseThreat = itemId === 'threat' && game.phase === 'voting' && !!game.currentVote
                    && !!uid && game.currentVote.eligibleVoters.includes(uid)
                  const weaponItemIds = ['axe', 'pistol', 'shotgun', 'bat', 'grenade', 'chainsaw']
                  const amInWeaponZone = game.phase === 'weapon_use' && (() => {
                    const zone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
                    return game.zones[zone]?.characterIds.some(
                      id => game.characters[id]?.playerId === uid && game.characters[id]?.isAlive
                    ) ?? false
                  })()
                  const isStaged = stagedWeapons.has(instanceId)
                  const isHideStaged = stagedHideItemId === instanceId
                  const canUseWeapon = weaponItemIds.includes(itemId) && amInWeaponZone && !game.weaponUseStatus[uid ?? ''] && !isStaged
                  const canUseHide = itemId === 'hidden_card' && amInWeaponZone && !game.weaponUseStatus[uid ?? ''] && !stagedHideItemId
                  const isUsable = canUseCctv || canUseThreat || canUseWeapon || canUseHide

                  const isConfirming = confirmingItems.has(instanceId)

                  // staged 숨기: "숨기 예정" 표시 + 해제 버튼
                  if (isHideStaged) {
                    return (
                      <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-800 border border-purple-600 rounded-lg px-2.5 py-1.5">
                        <span className="text-sm">🫥</span>
                        <span className="text-xs text-purple-300 font-bold">숨기 ✓</span>
                        <button onClick={() => { setStagedHideItemId(null); setStagedHideCharId(null) }}
                          className="text-xs text-zinc-400 hover:text-red-400 px-1 transition-colors">
                          해제
                        </button>
                      </div>
                    )
                  }

                  // staged 무기: "사용 예정" 표시 + 해제 버튼
                  if (isStaged) {
                    return (
                      <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-800 border border-green-600 rounded-lg px-2.5 py-1.5">
                        <span className="text-sm">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                        <span className="text-xs text-green-400 font-bold">{cfg.name} ✓</span>
                        <button onClick={() => setStagedWeapons(prev => { const next = new Set(prev); next.delete(instanceId); return next })}
                          className="text-xs text-zinc-400 hover:text-red-400 px-1 transition-colors">
                          해제
                        </button>
                      </div>
                    )
                  }

                  if (isConfirming) {
                    return (
                      <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-700 border border-yellow-600 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs text-yellow-300">{cfg.name} 사용?</span>
                        <button onClick={() => handleUseItem(instanceId, itemId)} disabled={actionLoading}
                          className="text-xs bg-yellow-600 hover:bg-yellow-500 text-black font-bold px-2 py-0.5 rounded transition-colors">
                          확인
                        </button>
                        <button onClick={() => setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })}
                          className="text-xs text-zinc-400 hover:text-white px-1 transition-colors">
                          취소
                        </button>
                      </div>
                    )
                  }

                  return (
                    <button key={instanceId}
                      title={cfg.description}
                      onClick={() => isUsable && setConfirmingItems(prev => new Set(prev).add(instanceId))}
                      disabled={!isUsable}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                        isUsable
                          ? 'bg-zinc-700 hover:bg-zinc-600 text-white cursor-pointer ring-1 ring-zinc-500'
                          : 'bg-zinc-800 text-zinc-500 cursor-default'
                      }`}>
                      <span className="text-sm">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                      <span className="text-xs font-medium">{cfg.name}</span>
                    </button>
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
              const isDestConfirmed = !!game.destinationStatus[playerId]
              const hasTempDest = !!game.sealedDestinations[playerId]
              const hasVoteConfirmed = !!game.currentVote?.status[playerId]
              const hasTempVote = !!game.currentVote?.votes[playerId]

              let statusDot = ''
              if (game.phase === 'character_select') statusDot = isDeclared ? '✓' : '...'
              else if (game.phase === 'destination_seal') statusDot = isDestConfirmed ? '✓' : hasTempDest ? '●' : '...'
              else if (game.phase === 'voting') statusDot = hasVoteConfirmed ? '✓' : hasTempVote ? '●' : '...'

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
                        <span className={`text-xs ${statusDot === '✓' ? 'text-green-400' : statusDot === '●' ? 'text-yellow-400' : 'text-zinc-600'}`}>
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
    {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </>
  )
}
