import { get, ref } from 'firebase/database'
import { db } from './config'
import { writeGameState, patchGameState, clearPendingItemActions, writePrivateItems } from './gameService'
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

  await Promise.all([
    writeGameState(roomCode, state),
    updateRoomStatus(roomCode, 'playing'),
  ])
}

// ── 주사위 굴리기 (호스트 전용) ──────────────────────────────

export async function hostRollDice(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const roll = rollZombieDice()
  let next = applyZombiePlacement(state, roll)
  next = applyBonusZombies(next)
  next = { ...next, phase: 'character_select' }

  await patchGameState(roomCode, {
    lastDiceRoll: next.lastDiceRoll,
    zones: next.zones,
    phase: next.phase,
  })

  return next
}

// ── 이동 공개 및 처리 (호스트 전용) ─────────────────────────

export async function hostResolveMovement(
  roomCode: string,
  state: GameState
): Promise<GameState> {
  const snap = await get(ref(db, `games/${roomCode}/game/sealedDestinations`))
  const sealedDestinations = snap.val() ?? {}

  const next = resolveMovesInOrder(state, sealedDestinations)
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
      if (!victimCharacterId) break
      next = applyZombieAttackResult(state, voteState.zone, victimCharacterId)
      break
    }
    case 'item_search': {
      next = applyItemSearchResult(state, result.winner)
      break
    }
    case 'sheriff': {
      next = applySheriffVoteResult(state, result.winner)
      break
    }
  }

  next = { ...next, currentVote: null, phase: 'event' }
  await patchGameState(roomCode, {
    characters: next.characters,
    zones: next.zones,
    currentVote: null,
    nextSheriffPlayerId: next.nextSheriffPlayerId,
    itemDeck: next.itemDeck,
    itemSearchPreview: next.itemSearchPreview,
    phase: next.phase,
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
