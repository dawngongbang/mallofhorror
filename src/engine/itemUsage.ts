import type { GameState, ZoneName, VoteState, CardReactionWindow, ItemId } from './types'
import { ITEM_CONFIGS } from './constants'

// ── 카드 반응 창 관리 ────────────────────────────────────────

// [before_vote] 투표 시작 직전 반응 창 열기
// 후보 플레이어 전원이 동시에 sprint / hidden_card 사용 가능
export function openBeforeVoteWindow(
  state: GameState,
  zone: ZoneName,
  candidatePlayers: string[],
  reactionTimeSecs: number
): GameState {
  const window: CardReactionWindow = {
    zone,
    timing: 'before_vote',
    deadline: Date.now() + reactionTimeSecs * 1000,
    candidatePlayers,
    usedCards: {},
    sprintTargets: {},
    escaped: [],
    loserPlayerId: null,
    reactionUsed: false,
  }
  return { ...state, cardReactionWindow: window }
}

// [after_vote] 투표 결과 확정 후 반응 창 열기
// 패배자 1인만 대기
export function openAfterVoteWindow(
  state: GameState,
  zone: ZoneName,
  loserPlayerId: string,
  reactionTimeSecs: number
): GameState {
  const window: CardReactionWindow = {
    zone,
    timing: 'after_vote',
    deadline: Date.now() + reactionTimeSecs * 1000,
    candidatePlayers: [loserPlayerId],
    usedCards: {},
    sprintTargets: {},
    escaped: [],
    loserPlayerId,
    reactionUsed: false,
  }
  return { ...state, cardReactionWindow: window }
}

// 반응 창 닫기 (타임아웃 or 모든 플레이어 결정 완료 후 호스트 호출)
export function closeReactionWindow(state: GameState): GameState {
  return { ...state, cardReactionWindow: null }
}

// before_vote: 아직 결정 안 한 후보가 남아있는지
export function isReactionWindowComplete(state: GameState): boolean {
  const win = state.cardReactionWindow
  if (!win || win.timing !== 'before_vote') return true
  // 모든 후보가 카드 사용 or 패스했으면 완료
  // (패스는 별도 액션이 없으므로 타임아웃으로 처리 — 여기선 외부에서 deadline 체크)
  return win.candidatePlayers.every(
    id => id in win.usedCards || win.escaped.includes(id)
  )
}

// ── sprint ───────────────────────────────────────────────────

// [이동 페이즈] 봉인된 목적지 변경
export function useSprintInMovement(
  state: GameState,
  playerId: string,
  itemInstanceId: string,
  newTargetZone: ZoneName
): GameState {
  if (!state.sealedDestinations[playerId]) return state
  if (!isValidItem(itemInstanceId, 'sprint')) return state

  return removeItemFromPlayer(
    {
      ...state,
      sealedDestinations: {
        ...state.sealedDestinations,
        [playerId]: {
          ...state.sealedDestinations[playerId],
          targetZone: newTargetZone,
        },
      },
    },
    playerId,
    itemInstanceId
  )
}

// [before_vote] 다른 구역으로 이동 → 후보에서 제외
export function useSprintBeforeVote(
  state: GameState,
  playerId: string,
  itemInstanceId: string,
  characterId: string,
  newZone: ZoneName
): GameState {
  const win = state.cardReactionWindow
  if (!win || win.timing !== 'before_vote') return state
  if (!win.candidatePlayers.includes(playerId)) return state
  if (!isValidItem(itemInstanceId, 'sprint')) return state

  const character = state.characters[characterId]
  if (!character || !character.isAlive || character.playerId !== playerId) return state

  const fromZone = character.zone
  const zones = { ...state.zones }
  zones[fromZone] = {
    ...zones[fromZone],
    characterIds: zones[fromZone].characterIds.filter(id => id !== characterId),
  }
  zones[newZone] = {
    ...zones[newZone],
    characterIds: [...zones[newZone].characterIds, characterId],
  }

  const newWindow: CardReactionWindow = {
    ...win,
    usedCards: { ...win.usedCards, [playerId]: 'sprint' },
    escaped: [...win.escaped, playerId],
  }

  return removeItemFromPlayer(
    {
      ...state,
      characters: { ...state.characters, [characterId]: { ...character, zone: newZone } },
      zones,
      cardReactionWindow: newWindow,
    },
    playerId,
    itemInstanceId
  )
}

// [after_vote] 다른 구역으로 이동 → 사망 취소 + 재투표
export function useSprintAfterVote(
  state: GameState,
  playerId: string,
  itemInstanceId: string,
  characterId: string,
  newZone: ZoneName
): GameState {
  const win = state.cardReactionWindow
  if (!win || win.timing !== 'after_vote') return state
  if (win.loserPlayerId !== playerId) return state
  if (!isValidItem(itemInstanceId, 'sprint')) return state

  const character = state.characters[characterId]
  if (!character || !character.isAlive || character.playerId !== playerId) return state

  const fromZone = character.zone
  const zones = { ...state.zones }
  zones[fromZone] = {
    ...zones[fromZone],
    characterIds: zones[fromZone].characterIds.filter(id => id !== characterId),
  }
  zones[newZone] = {
    ...zones[newZone],
    characterIds: [...zones[newZone].characterIds, characterId],
  }

  return removeItemFromPlayer(
    {
      ...state,
      characters: { ...state.characters, [characterId]: { ...character, zone: newZone } },
      zones,
      cardReactionWindow: { ...win, reactionUsed: true },
    },
    playerId,
    itemInstanceId
  )
}

// ── hidden_card ──────────────────────────────────────────────

// [이동 페이즈] 봉인된 목적지 취소 → 현재 위치 유지
export function useHiddenInMovement(
  state: GameState,
  playerId: string,
  itemInstanceId: string
): GameState {
  if (!isValidItem(itemInstanceId, 'hidden_card')) return state

  const declaration = state.characterDeclarations[playerId]
  if (!declaration) return state

  const character = state.characters[declaration.characterId]
  if (!character) return state

  return removeItemFromPlayer(
    {
      ...state,
      sealedDestinations: {
        ...state.sealedDestinations,
        [playerId]: {
          playerId,
          targetZone: character.zone,  // 현재 위치로 덮어씀 → 이동 안 함
          submittedAt: Date.now(),
        },
      },
    },
    playerId,
    itemInstanceId
  )
}

// [before_vote] 제자리 유지 → 후보에서 제외
export function useHiddenBeforeVote(
  state: GameState,
  playerId: string,
  itemInstanceId: string
): GameState {
  const win = state.cardReactionWindow
  if (!win || win.timing !== 'before_vote') return state
  if (!win.candidatePlayers.includes(playerId)) return state
  if (!isValidItem(itemInstanceId, 'hidden_card')) return state

  const newWindow: CardReactionWindow = {
    ...win,
    usedCards: { ...win.usedCards, [playerId]: 'hidden_card' },
    escaped: [...win.escaped, playerId],
  }

  return removeItemFromPlayer(
    { ...state, cardReactionWindow: newWindow },
    playerId,
    itemInstanceId
  )
}

// [after_vote] 제자리 유지 → 사망 취소 + 재투표
export function useHiddenAfterVote(
  state: GameState,
  playerId: string,
  itemInstanceId: string
): GameState {
  const win = state.cardReactionWindow
  if (!win || win.timing !== 'after_vote') return state
  if (win.loserPlayerId !== playerId) return state
  if (!isValidItem(itemInstanceId, 'hidden_card')) return state

  return removeItemFromPlayer(
    {
      ...state,
      cardReactionWindow: { ...win, reactionUsed: true },
    },
    playerId,
    itemInstanceId
  )
}

// ── 무기 사용 ────────────────────────────────────────────────

export function useWeapon(
  state: GameState,
  zone: ZoneName,
  itemInstanceId: string,
  ownerId: string
): GameState {
  const itemId = inferItemId(itemInstanceId)
  if (!itemId) return state

  const config = ITEM_CONFIGS[itemId]
  if (!config.zombieKill) return state

  const newZombies = Math.max(0, state.zones[zone].zombies - config.zombieKill)

  return removeItemFromPlayer(
    {
      ...state,
      zones: { ...state.zones, [zone]: { ...state.zones[zone], zombies: newZombies } },
    },
    ownerId,
    itemInstanceId
  )
}

// ── 협박카드 ─────────────────────────────────────────────────

export function useThreatCard(
  voteState: VoteState,
  state: GameState,
  playerId: string,
  itemInstanceId: string
): { voteState: VoteState; gameState: GameState } {
  if (!isValidItem(itemInstanceId, 'threat')) return { voteState, gameState: state }

  return {
    voteState: {
      ...voteState,
      bonusVoteWeights: {
        ...voteState.bonusVoteWeights,
        [playerId]: (voteState.bonusVoteWeights[playerId] ?? 0) + 1,
      },
    },
    gameState: removeItemFromPlayer(state, playerId, itemInstanceId),
  }
}

// ── 하드웨어카드 ─────────────────────────────────────────────

export function useHardwareCard(
  state: GameState,
  playerId: string,
  itemInstanceId: string
): { gameState: GameState; bonusApplied: boolean } {
  if (!isValidItem(itemInstanceId, 'hardware')) return { gameState: state, bonusApplied: false }

  return {
    gameState: removeItemFromPlayer(state, playerId, itemInstanceId),
    bonusApplied: true,
  }
}

// ── 아이템 탐색 완료 ──────────────────────────────────────────

export function resolveItemSearchChoice(
  state: GameState,
  winnerId: string,
  keptInstanceId: string,
  givenToPlayerId: string,
  givenInstanceId: string,
  returnedInstanceId: string,
  players: Record<string, { itemIds: string[] }>
): {
  gameState: GameState
  updatedPlayers: Record<string, { itemIds: string[] }>
} {
  if (!state.itemSearchPreview) return { gameState: state, updatedPlayers: players }

  const previewSet = new Set(state.itemSearchPreview)
  if (
    !previewSet.has(keptInstanceId) ||
    !previewSet.has(givenInstanceId) ||
    !previewSet.has(returnedInstanceId)
  ) {
    return { gameState: state, updatedPlayers: players }
  }

  const returnedItemId = inferItemId(returnedInstanceId)
  const newDeck = [
    ...state.itemDeck.filter(i => !previewSet.has(i.instanceId)),
    ...(returnedItemId ? [{ instanceId: returnedInstanceId, itemId: returnedItemId }] : []),
  ]

  return {
    gameState: { ...state, itemDeck: newDeck, itemSearchPreview: null },
    updatedPlayers: {
      ...players,
      [winnerId]: {
        ...players[winnerId],
        itemIds: [...(players[winnerId]?.itemIds ?? []), keptInstanceId],
      },
      [givenToPlayerId]: {
        ...players[givenToPlayerId],
        itemIds: [...(players[givenToPlayerId]?.itemIds ?? []), givenInstanceId],
      },
    },
  }
}

// ── 유틸 ─────────────────────────────────────────────────────

function inferItemId(instanceId: string): ItemId | null {
  const itemId = instanceId.split('_').slice(0, -1).join('_') as ItemId
  return ITEM_CONFIGS[itemId] ? itemId : null
}

function isValidItem(instanceId: string, expected: ItemId): boolean {
  return inferItemId(instanceId) === expected
}

// 아이템 제거는 Firebase /private/{playerId}/items 레이어에서 처리
// 게임 엔진은 게임 상태 변화(이동, 좀비 감소 등)만 담당
export function removeItemFromPlayer(
  state: GameState,
  _playerId: string,
  _itemInstanceId: string
): GameState {
  return state
}
