import type { GameState, GamePhase, GameSettings, ZoneName } from './types'
import { EVENT_ZONE_ORDER } from './constants'
import { isUnderAttack } from './combat'

// 현재 상태에서 다음 페이즈 계산
export function getNextPhase(state: GameState, settings: GameSettings): GamePhase {
  switch (state.phase) {
    case 'waiting':
      return 'setup_place'

    case 'setup_place':
      // 모든 캐릭터 배치 완료 → 첫 라운드 시작 (주사위만)
      return state.setupPlacementOrder.length === 0 ? 'roll_dice' : 'setup_place'

    case 'roll_dice':
      return 'character_select'

    case 'character_select':
      return 'destination_seal'

    case 'destination_seal':
      return 'destination_reveal'

    case 'destination_reveal':
      return 'move_execute'

    case 'move_execute':
      return 'event'

    case 'event':
      return 'check_win'

    case 'voting':
      // 투표 결과에 따라 event 페이즈로 돌아가거나 재투표
      return 'event'

    case 'check_win':
      return 'roll_dice'  // 다음 라운드

    case 'finished':
      return 'finished'

    default:
      return state.phase
  }
}

// 이동 페이즈: 모든 플레이어가 선언 완료했는지
export function allDeclarationsComplete(state: GameState): boolean {
  const activePlayers = getActivePlayers(state)
  return activePlayers.every(id => state.characterDeclarations[id] !== undefined)
}

// 이동 페이즈: 모든 플레이어가 목적지 봉인 완료했는지
export function allDestinationsSealed(state: GameState): boolean {
  const activePlayers = getActivePlayers(state)
  return activePlayers.every(id => state.destinationStatus[id] === true)
}

// 투표: 모든 유효 투표자가 투표 완료했는지
export function allVotesSubmitted(state: GameState): boolean {
  if (!state.currentVote) return true
  return state.currentVote.eligibleVoters.every(
    id => state.currentVote!.status[id] === true
  )
}

// 이벤트 페이즈: 현재 처리할 구역
export function getCurrentEventZone(state: GameState): ZoneName | null {
  return EVENT_ZONE_ORDER[state.currentEventZoneIndex] ?? null
}

// 이벤트 페이즈: 다음 처리할 구역으로 이동
export function advanceEventZone(state: GameState): GameState {
  return {
    ...state,
    currentEventZoneIndex: state.currentEventZoneIndex + 1,
    currentVote: null,
  }
}

// 이벤트 페이즈 완료 여부 (6개 구역 모두 처리)
export function isEventPhaseComplete(state: GameState): boolean {
  return state.currentEventZoneIndex >= EVENT_ZONE_ORDER.length
}

// 라운드 시작 시 페이즈 데이터 초기화
export function initRoundState(state: GameState): GameState {
  return {
    ...state,
    characterDeclarations: {},
    declarationOrder: [],
    sealedDestinations: {},
    destinationStatus: {},
    resolvedMoves: [],
    currentEventZoneIndex: 0,
    currentVote: null,
    lastDiceRoll: null,
    itemSearchPreview: null,
  }
}

// 보안관 플레이어 ID 반환
export function getSheriffPlayerId(state: GameState): string {
  return state.playerOrder[state.sheriffIndex]
}

// 다음 라운드 보안관 인덱스 계산
// nextSheriffPlayerId가 있으면 그 플레이어로, 없으면 유지
export function resolveNextSheriff(state: GameState): GameState {
  if (!state.nextSheriffPlayerId) return state

  const newIndex = state.playerOrder.indexOf(state.nextSheriffPlayerId)
  if (newIndex === -1) return state

  return {
    ...state,
    sheriffIndex: newIndex,
    nextSheriffPlayerId: null,
  }
}

// 현재 생존 캐릭터가 있는 플레이어 목록
function getActivePlayers(state: GameState): string[] {
  const active = new Set<string>()
  for (const char of Object.values(state.characters)) {
    if (char.isAlive) active.add(char.playerId)
  }
  // playerOrder 순서 유지
  return state.playerOrder.filter(id => active.has(id))
}
