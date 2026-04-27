import { useEffect, useRef, useState } from 'react'
import {
  patchGameState,
} from '../firebase/gameService'
import {
  hostRollDice, hostApplyDiceRoll, hostPrepareMovement, hostApplyNextMoveStep,
  hostResolveVote, hostEndRound, hostResolveItemSearch,
} from '../firebase/hostService'
import { startZoneAttackPhase, startZoneSurvivorPhase, checkAndCloseZone } from '../engine/event'
import { calculateVoteResult } from '../engine/combat'
import { EVENT_ZONE_ORDER, ZONE_CONFIGS } from '../engine/constants'
import type { GameState, Player, ZoneName } from '../engine/types'

// isConnected만 보면 순간 끊김에도 자동 처리가 발생하므로
// lastSeen 기준 20초 이상 응답 없을 때만 "실제 오프라인"으로 판정
const OFFLINE_THRESHOLD_MS = 20_000
function isEffectivelyOffline(player: Player | undefined): boolean {
  if (!player) return true
  if (player.isConnected) return false
  return Date.now() - player.lastSeen > OFFLINE_THRESHOLD_MS
}

interface GameSettings {
  sealTime?: number
  votingTime?: number
}

export function useHostLogic(params: {
  roomCode: string
  isHost: boolean
  game: GameState | null
  gameRef: React.MutableRefObject<GameState | null>
  players: Record<string, Player>
  meta: { hostId: string; settings: GameSettings } | null
}): void {
  const { roomCode, isHost, game, gameRef, players, meta } = params

  const processingRef = useRef(false)
  const [processSignal, setProcessSignal] = useState(0)

  // ── 호스트 자동 진행 ─────────────────────────────────────────
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
          if (currentDeclarer && isEffectivelyOffline(players[currentDeclarer])) {
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
            isEffectivelyOffline(players[pid]) && !game.destinationStatus[pid]
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
          const inZonePlayers = [...new Set(
            zoneState.characterIds
              .map(id => game.characters[id])
              .filter(c => c?.isAlive)
              .map(c => c!.playerId)
          )]
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
              weaponKillChoices: null as any,
              pendingHideChoices: null as any,
              pendingSprintChoices: null as any,
              pendingHardwareChoices: null as any,
              ...(weaponAnnounce ? { lastWeaponUseAnnounce: weaponAnnounce } : {}),
              ...(hideAnnounce ? { lastHideRevealAnnounce: hideAnnounce, hiddenCharacters: newHiddenChars } : {}),
              ...(sprintAnnounce ? { lastSprintAnnounce: sprintAnnounce } : {}),
            })
            const gameWithHidden = Object.keys(newHiddenChars).length > 0
              ? { ...updatedGame, hiddenCharacters: newHiddenChars }
              : updatedGame
            const attackState = startZoneAttackPhase(zone, gameWithHidden, hardwareBonus)
            if (attackState) {
              await patchGameState(roomCode, { currentVote: attackState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
            } else {
              const survivorState = startZoneSurvivorPhase(zone, gameWithHidden)
              const revealAnnounce = hiddenEntries.length > 0
                ? { type: 'reveal' as const, entries: hiddenEntries }
                : null
              if (survivorState) {
                await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
              } else if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
                if (revealAnnounce) {
                  await patchGameState(roomCode, { hiddenCharacters: null as any, lastHideRevealAnnounce: revealAnnounce })
                  await new Promise<void>(r => setTimeout(r, 1500))
                }
                await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: null as any })
              } else {
                if (revealAnnounce) {
                  await patchGameState(roomCode, { hiddenCharacters: null as any, lastHideRevealAnnounce: revealAnnounce })
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
            // 좀비 공격 5회 동률 초과 → 랜덤 선택 표시
            const isTie = !result.winner
            const isRandomPickCase = isTie && cv.round >= 4
            const randomWinnerId = isRandomPickCase
              ? cv.candidates[Math.floor(Math.random() * cv.candidates.length)]
              : undefined
            await patchGameState(roomCode, {
              lastVoteAnnounce: {
                votes: cv.votes ?? {},
                tally: result.tally,
                bonusVoteWeights: cv.bonusVoteWeights ?? {},
                ...(isRandomPickCase ? { isRandomPick: true, randomWinnerId } : {}),
              },
            })
            didWork = true
          }
        }
      } catch (err) {
        console.error('[HOST] runHostStep error:', err)
      } finally {
        processingRef.current = false
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
        weaponKillChoices: null as any,
        pendingHideChoices: null as any,
        pendingSprintChoices: null as any,
        pendingHardwareChoices: null as any,
        ...(weaponAnnounceG ? { lastWeaponUseAnnounce: weaponAnnounceG } : {}),
        ...(hideAnnounce ? { lastHideRevealAnnounce: hideAnnounce, hiddenCharacters: newHiddenCharsG } : {}),
        ...(sprintAnnounceG ? { lastSprintAnnounce: sprintAnnounceG } : {}),
      })
      const gameWithHiddenG = Object.keys(newHiddenCharsG).length > 0
        ? { ...updatedG, hiddenCharacters: newHiddenCharsG }
        : updatedG
      const attackState = startZoneAttackPhase(zone, gameWithHiddenG, hardwareBonusG)
      if (attackState) {
        await patchGameState(roomCode, { currentVote: attackState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
        return
      }
      const revealAnnounce = hiddenEntries.length > 0 ? { type: 'reveal' as const, entries: hiddenEntries } : null
      const survivorState = startZoneSurvivorPhase(zone, gameWithHiddenG)
      if (survivorState) {
        await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
        return
      }
      if (revealAnnounce) {
        await patchGameState(roomCode, { hiddenCharacters: null as any, lastHideRevealAnnounce: revealAnnounce })
        await new Promise<void>(r => setTimeout(r, 1500))
      }
      if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
        await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: null as any })
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
      if (cv.eligibleVoters.every(id => cv.status[id])) return
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

      if (cv.type === 'zombie_attack') {
        const result = calculateVoteResult(cv, g)
        const effectiveWinner = result.winner ?? (g.lastVoteAnnounce?.isRandomPick ? g.lastVoteAnnounce.randomWinnerId : undefined)
        if (effectiveWinner) {
          const loserCharsInZone = Object.values(g.characters)
            .filter(c => c.playerId === effectiveWinner && c.isAlive && g.zones[cv.zone].characterIds.includes(c.id))
          if (loserCharsInZone.length <= 1) {
            const nextState = await hostResolveVote(roomCode, g, loserCharsInZone[0]?.id, effectiveWinner)
            if (nextState.phase === 'event' && !nextState.itemSearchPreview) {
              await patchGameState(roomCode, { phase: 'zone_announce' })
            }
          } else {
            await patchGameState(roomCode, { pendingVictimSelection: { zone: cv.zone, loserPlayerId: effectiveWinner }, lastVoteAnnounce: null })
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

  // ── 트럭 수색 완료 공지 → 5초 후 자동 해제 ────────────────────
  useEffect(() => {
    if (!isHost || !game?.lastItemSearchAnnounce) return
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g?.lastItemSearchAnnounce) return
      await patchGameState(roomCode, { lastItemSearchAnnounce: null })
    }, 5000)
    return () => clearTimeout(timer)
  }, [!!game?.lastItemSearchAnnounce, isHost, roomCode])

  // ── dice_reveal: 3초 후 자동 좀비 배치 ───────────────────────
  useEffect(() => {
    if (!isHost || !game || game.phase !== 'dice_reveal') return
    const capturedGame = game
    const timer = setTimeout(async () => {
      await hostApplyDiceRoll(roomCode, capturedGame)
    }, 5000)
    return () => clearTimeout(timer)
  }, [game?.phase, isHost, roomCode])

  // ── move_execute: 2초 간격으로 이동 단계 처리 ──────────────
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

  // ── zombie_spawn: 배치 단계 순차 처리 ────────────────────────
  useEffect(() => {
    if (!isHost || !game || game.phase !== 'zombie_spawn') return
    const batches = game.zombieSpawnBatches ?? []
    const step = game.zombieSpawnStep
    const nextStep = step + 1

    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'zombie_spawn' || g.zombieSpawnStep !== step) return

      if (nextStep >= batches.length) {
        // 이번 턴 구역별 신규 좀비 수 집계
        const lastSpawnedZones: Partial<Record<import('../engine/types').ZoneName, number>> = {}
        for (const b of batches) {
          if (b.type === 'dice') {
            for (const [z, cnt] of Object.entries(b.zones)) {
              const zone = z as import('../engine/types').ZoneName
              lastSpawnedZones[zone] = (lastSpawnedZones[zone] ?? 0) + (cnt as number)
            }
          } else {
            lastSpawnedZones[b.zone] = (lastSpawnedZones[b.zone] ?? 0) + 1
          }
        }
        await patchGameState(roomCode, {
          phase: 'event',
          currentEventZoneIndex: 0,
          zombiePlayerZoneChoices: {},
          zombieSpawnBatches: null,
          zombieSpawnStep: 0,
          lastSpawnedZones,
        })
        return
      }

      const batch = batches[nextStep]
      const zones = { ...g.zones }
      if (batch.type === 'crowded' || batch.type === 'belle') {
        zones[batch.zone] = { ...zones[batch.zone], zombies: zones[batch.zone].zombies + 1 }
      } else if (batch.type === 'zombie_player') {
        zones[batch.zone] = { ...zones[batch.zone], zombies: zones[batch.zone].zombies + 1 }
      }

      await patchGameState(roomCode, {
        zones,
        zombieSpawnStep: nextStep,
        ...(batch.type === 'zombie_player'
          ? { lastZombiePlayerAnnounce: { entries: [{ playerId: batch.playerId, zone: batch.zone }] } }
          : {}),
      })
    }, 3500)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.zombieSpawnStep, isHost, roomCode])

  // ── zone_announce: 4초 후 실제 구역 이벤트 처리 ──────────────
  const zoneAnnounceZone = game?.phase === 'zone_announce' ? EVENT_ZONE_ORDER[game.currentEventZoneIndex] : null
  const zoneAnnounceZombies = zoneAnnounceZone ? game?.zones?.[zoneAnnounceZone]?.zombies : undefined

  useEffect(() => {
    if (!isHost || !game || game.phase !== 'zone_announce') return
    const zoneIndex = game.currentEventZoneIndex
    const timer = setTimeout(async () => {
      const g = gameRef.current
      if (!g || g.phase !== 'zone_announce' || g.currentEventZoneIndex !== zoneIndex) return

      const zone = EVENT_ZONE_ORDER[zoneIndex]
      const nextZoneIndex = zoneIndex + 1

      const buildReveal = (state: typeof g) => {
        const entries = Object.keys(state.hiddenCharacters ?? {}).map(charId => ({
          playerId: state.characters[charId]?.playerId ?? '',
          charId,
          zone,
        })).filter(e => e.playerId)
        return entries.length > 0 ? { type: 'reveal' as const, entries } : null
      }

      const closedState = checkAndCloseZone(zone, g)
      if (closedState) {
        if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
          await patchGameState(roomCode, { zones: closedState.zones, currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: null as any })
        } else {
          await hostEndRound(roomCode, { ...closedState, hiddenCharacters: {} })
        }
        return
      }

      if (g.zones[zone].isClosed) {
        if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
          await patchGameState(roomCode, { currentEventZoneIndex: nextZoneIndex, phase: 'event', hiddenCharacters: null as any })
        } else {
          await hostEndRound(roomCode, { ...g, hiddenCharacters: {} })
        }
        return
      }

      const voteMs = (meta?.settings.votingTime ?? 60) * 1000
      const attackState = startZoneAttackPhase(zone, g)
      if (attackState) {
        await patchGameState(roomCode, { phase: 'weapon_use', phaseDeadline: Date.now() + 15000, weaponUseStatus: null as any, weaponKillChoices: null as any })
        return
      }
      const survivorState = startZoneSurvivorPhase(zone, g)
      if (survivorState) {
        await patchGameState(roomCode, { currentVote: survivorState.currentVote, phase: 'voting', phaseDeadline: Date.now() + voteMs, lastZombieAttackResult: null })
        return
      }
      const revealAnnounce = buildReveal(g)
      if (revealAnnounce) {
        await patchGameState(roomCode, { hiddenCharacters: null as any, lastHideRevealAnnounce: revealAnnounce, lastZombieAttackResult: null })
        await new Promise<void>(r => setTimeout(r, 1500))
      }
      if (nextZoneIndex < EVENT_ZONE_ORDER.length) {
        await patchGameState(roomCode, {
          currentEventZoneIndex: nextZoneIndex,
          phase: 'event',
          lastZombieAttackResult: null,
          hiddenCharacters: null as any,
        })
      } else {
        await hostEndRound(roomCode, { ...g, hiddenCharacters: {} })
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [game?.phase, game?.currentEventZoneIndex, zoneAnnounceZombies, isHost, roomCode])
}
