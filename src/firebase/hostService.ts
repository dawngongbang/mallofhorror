import { get, ref } from 'firebase/database'
import { db } from './config'
import { writeGameState, patchGameState, clearPendingItemActions, writePrivateItems, getPrivateItems } from './gameService'
import { updateRoomStatus } from './roomService'
import type { GameState, GameSettings, Player } from '../engine/types'
import { createInitialGameState } from '../engine/setup'
import { createItemDeck, shuffle, dealItems } from '../engine/items'
import { rollZombieDice, applyZombiePlacement, applyBonusZombies } from '../engine/dice'
import { resolveMovesInOrder } from '../engine/movement'
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

// ── 이동 공개 및 처리 (호스트 전용) ─────────────────────────

export async function hostResolveMovement(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const snap = await get(ref(db, `games/${roomCode}/game/sealedDestinations`))
  const sealedDestinations = snap.val() ?? {}

  let next = resolveMovesInOrder(state, sealedDestinations)

  // 이동 완료 후 좀비 배치 (주사위는 이미 lastDiceRoll에 저장됨)
  if (state.lastDiceRoll) {
    next = applyZombiePlacement(next, state.lastDiceRoll)
    next = applyBonusZombies(next)
  }

  const withPhase = { ...next, phase: 'event' as const, currentEventZoneIndex: 0 }

  await patchGameState(roomCode, {
    zones: withPhase.zones,
    characters: withPhase.characters,
    resolvedMoves: withPhase.resolvedMoves,
    phase: withPhase.phase,
    currentEventZoneIndex: 0,
  })

  return withPhase
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
    const nextVote = {
      ...voteState,
      round: voteState.round + 1,
      votes: {},
      status: Object.fromEntries(voteState.eligibleVoters.map(id => [id, false])),
      bonusVoteWeights: {},
    }
    await patchGameState(roomCode, { currentVote: nextVote })
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
