import { get, ref } from 'firebase/database'
import { db } from './config'
import { writeGameState, patchGameState, clearPendingItemActions, writePrivateItems, getPrivateItems } from './gameService'
import { updateRoomStatus } from './roomService'
import type { GameState, GameSettings, Player } from '../engine/types'
import { createInitialGameState } from '../engine/setup'
import { createItemDeck, shuffle, dealItems } from '../engine/items'
import { rollZombieDice, applyZombiePlacement, applyBonusZombies } from '../engine/dice'
import { planMovesInOrder, applyMoveStep } from '../engine/movement'
import { calculateVoteResult } from '../engine/combat'
import { applyZombieAttackResult, applyItemSearchResult, applySheriffVoteResult } from '../engine/event'
import { resolveNextSheriff, updateSheriffStatus, initRoundState } from '../engine/phase'
import { checkWinCondition } from '../engine/win'

// ── 게임 시작 (호스트 전용) ───────────────────────────────────

export async function startGame(
  roomCode: string,
  players: Record<string, Player>,
  settings: GameSettings
): Promise<void> {
  const playerList = Object.values(players)
  const state = createInitialGameState(playerList, settings)

  // 아이템 배분: state.itemDeck은 배분 후 남은 덱이므로, 직접 배분해서 private 경로에 기록
  const { playerItems } = dealItems(shuffle(createItemDeck()), playerList.map(p => p.id))
  for (const player of playerList) {
    await writePrivateItems(roomCode, player.id, playerItems[player.id] ?? [])
  }

  await writeGameState(roomCode, state)
  await updateRoomStatus(roomCode, 'playing')
}

// ── 주사위 굴리기 (호스트 전용) ──────────────────────────────

export async function hostRollDice(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const roll = rollZombieDice()
  const next = { ...state, lastDiceRoll: roll, phase: 'dice_reveal' as const, sheriffRollRequest: null }

  await patchGameState(roomCode, {
    lastDiceRoll: roll,
    phase: 'dice_reveal',
    sheriffRollRequest: null,
  })

  return next
}

// ── 주사위 공개 후 이동 페이즈로 전환 (호스트 전용) ──────────
// 좀비 배치는 이동 완료 후 hostResolveMovement에서 처리

export async function hostApplyDiceRoll(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const next = { ...state, phase: 'character_select' as const }
  await patchGameState(roomCode, { phase: 'character_select' })
  return next
}

// ── 이동 계획 수립 (호스트 전용) ────────────────────────────
// 이동 결과를 미리 계산하되 보드는 변경하지 않음 → move_execute 페이즈에서 단계적 적용

export async function hostPrepareMovement(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const snap = await get(ref(db, `games/${roomCode}/game/sealedDestinations`))
  const sealedDestinations = snap.val() ?? {}

  const resolvedMoves = planMovesInOrder(state, sealedDestinations)

  const next: GameState = {
    ...state,
    resolvedMoves,
    currentMoveStep: 0,
    phase: 'move_execute',
  }

  await patchGameState(roomCode, {
    resolvedMoves,
    currentMoveStep: 0,
    phase: 'move_execute',
  })

  return next
}

// ── 이동 단계 처리 (호스트 전용) ────────────────────────────
// currentMoveStep 인덱스의 이동을 보드에 적용하고 한 칸 전진
// 모든 이동이 완료되면 좀비 배치 후 event 페이즈로 전환

export async function hostApplyNextMoveStep(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const step = state.currentMoveStep
  const totalMoves = state.resolvedMoves.length

  if (step < totalMoves) {
    // 이 step의 이동 적용
    const next = applyMoveStep(state, step)

    await patchGameState(roomCode, {
      zones: next.zones,
      characters: next.characters,
      resolvedMoves: next.resolvedMoves,
      currentMoveStep: next.currentMoveStep,
    })

    return next
  } else {
    // 모든 이동 완료 → 좀비 배치 후 event
    let next = state
    if (state.lastDiceRoll) {
      next = applyZombiePlacement(next, state.lastDiceRoll)
      next = applyBonusZombies(next)
    }
    const withPhase = { ...next, phase: 'event' as const, currentEventZoneIndex: 0 }

    await patchGameState(roomCode, {
      zones: withPhase.zones,
      characters: withPhase.characters,
      phase: 'event',
      currentEventZoneIndex: 0,
    })

    return withPhase
  }
}

// ── 투표 결과 처리 (호스트 전용) ─────────────────────────────

export async function hostResolveVote(
  roomCode: string,
  state: GameState,
  // zombie_attack일 때: 패배자가 선택한 희생 캐릭터 ID
  victimCharacterId?: string
): Promise<GameState> {
  if (!state.currentVote) return state

  const voteState = state.currentVote
  const result = calculateVoteResult(voteState, state)

  // 동률 → 재투표
  if (!result.winner) {
    // 2차 동률(round >= 1)부터는 전체 생존 플레이어로 확대
    const nextEligibleVoters = voteState.round >= 1
      ? state.playerOrder.filter(pid =>
          Object.values(state.characters).some(c => c.playerId === pid && c.isAlive)
        )
      : voteState.eligibleVoters
    const nextVote = {
      ...voteState,
      round: voteState.round + 1,
      votes: {},
      eligibleVoters: nextEligibleVoters,
      status: Object.fromEntries(nextEligibleVoters.map(id => [id, false])),
      bonusVoteWeights: {},
    }
    // lastVoteAnnounce: null을 동시에 적용 — 별도 await 시 runHostStep이 구 투표를 재감지하는 버그 방지
    await patchGameState(roomCode, { currentVote: nextVote, phaseDeadline: Date.now() + 60000, lastVoteAnnounce: null })
    return { ...state, currentVote: nextVote }
  }

  let next = state

  switch (voteState.type) {
    case 'zombie_attack': {
      if (victimCharacterId) {
        next = applyZombieAttackResult(state, voteState.zone, victimCharacterId)
      } else {
        // victimId를 못 찾은 경우에도 좀비는 반드시 소멸 (무한루프 방지)
        next = {
          ...state,
          zones: {
            ...state.zones,
            [voteState.zone]: { ...state.zones[voteState.zone], zombies: 0 },
          },
        }
      }
      break
    }
    case 'truck_search': {
      // 3장 프리뷰 세팅 + 승자 기록 → 선택 UI 대기
      next = applyItemSearchResult(state, result.winner)
      next = { ...next, itemSearchWinnerId: result.winner, itemSearchChoice: null }
      break
    }
    case 'sheriff': {
      next = applySheriffVoteResult(state, result.winner)
      break
    }
  }

  if (voteState.type === 'truck_search') {
    // 승자가 아이템 선택해야 하므로 event 페이즈로 대기 (zoneIndex 유지)
    next = { ...next, currentVote: null, phase: 'event' }
    await patchGameState(roomCode, {
      currentVote: null,
      itemDeck: next.itemDeck,
      itemSearchPreview: next.itemSearchPreview,
      itemSearchWinnerId: next.itemSearchWinnerId,
      itemSearchChoice: null,
      phase: 'event',
      lastVoteAnnounce: null,
    })
  } else {
    // zombie_attack은 같은 구역 재처리, sheriff는 다음 구역으로
    const nextZoneIndex =
      voteState.type === 'zombie_attack'
        ? state.currentEventZoneIndex
        : state.currentEventZoneIndex + 1

    next = { ...next, currentVote: null, phase: 'event', currentEventZoneIndex: nextZoneIndex }
    await patchGameState(roomCode, {
      characters: next.characters,
      zones: next.zones,
      currentVote: null,
      nextSheriffPlayerId: next.nextSheriffPlayerId ?? null,
      itemDeck: next.itemDeck,
      itemSearchPreview: null,
      itemSearchWinnerId: null,
      itemSearchChoice: null,
      currentEventZoneIndex: nextZoneIndex,
      phase: 'event',
      lastZombieAttackResult: next.lastZombieAttackResult ?? null,
      lastVoteAnnounce: null,
    })
  }

  return next
}

// ── 트럭 수색 아이템 선택 처리 (호스트 전용) ─────────────────

export async function hostResolveItemSearch(
  roomCode: string,
  state: GameState,
  winnerId: string,
  keptInstanceId: string,
  givenToPlayerId?: string,
  givenInstanceId?: string,
  returnedInstanceId?: string
): Promise<GameState> {
  // 승자 아이템 추가
  const winnerItems = await getPrivateItems(roomCode, winnerId)
  await writePrivateItems(roomCode, winnerId, [...winnerItems, keptInstanceId])

  // 증정 (2장 이상일 때)
  if (givenToPlayerId && givenInstanceId) {
    const recipientItems = await getPrivateItems(roomCode, givenToPlayerId)
    await writePrivateItems(roomCode, givenToPlayerId, [...recipientItems, givenInstanceId])
  }

  // 반환 (3장일 때)
  let newDeck = [...state.itemDeck]
  if (returnedInstanceId) {
    const returnedItemId = returnedInstanceId.split('_').slice(0, -1).join('_') as import('../engine/types').ItemId
    newDeck = [...newDeck, { instanceId: returnedInstanceId, itemId: returnedItemId }]
  }

  const newCounts = { ...state.playerItemCounts, [winnerId]: (state.playerItemCounts[winnerId] ?? 0) + 1 }
  if (givenToPlayerId) {
    newCounts[givenToPlayerId] = (state.playerItemCounts[givenToPlayerId] ?? 0) + 1
  }

  const nextZoneIndex = state.currentEventZoneIndex + 1
  const next: GameState = {
    ...state,
    itemDeck: newDeck,
    itemSearchPreview: null,
    itemSearchWinnerId: null,
    itemSearchChoice: null,
    playerItemCounts: newCounts,
    currentEventZoneIndex: nextZoneIndex,
    phase: 'event',
  }

  await patchGameState(roomCode, {
    itemDeck: newDeck,
    itemSearchPreview: null,
    itemSearchWinnerId: null,
    itemSearchChoice: null,
    playerItemCounts: newCounts,
    currentEventZoneIndex: nextZoneIndex,
    phase: 'event',
  })

  return next
}

// ── 라운드 종료 처리 (호스트 전용) ───────────────────────────

export async function hostEndRound(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const winResult = checkWinCondition(state)

  if (winResult.gameOver) {
    const finished = {
      ...state,
      phase: 'finished' as const,
      winners: winResult.winners,
      finalScores: winResult.finalScores,
    }
    await writeGameState(roomCode, finished)
    await updateRoomStatus(roomCode, 'finished')
    return finished
  }

  // 보안관 교체 + 상태 갱신
  let next = resolveNextSheriff(state)
  next = updateSheriffStatus(next)
  next = initRoundState(next)
  next = { ...next, round: next.round + 1, phase: 'roll_dice' }

  await clearPendingItemActions(roomCode)
  await writeGameState(roomCode, next)

  return next
}

// ── 타임아웃 감지 루프 (호스트 전용) ────────────────────────
// 호스트가 주기적으로 phaseDeadline을 체크해 자동 전환

export function startPhaseWatcher(
  _roomCode: string,
  getState: () => GameState | null,
  onTimeout: (state: GameState) => void,
  intervalMs = 1000
): () => void {
  const id = setInterval(() => {
    const state = getState()
    if (!state) return
    if (state.phaseDeadline > 0 && Date.now() >= state.phaseDeadline) {
      onTimeout(state)
    }
  }, intervalMs)

  return () => clearInterval(id)
}
