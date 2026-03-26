import type { GameState, GamePhase, GameSettings, ZoneName } from './types'
import { EVENT_ZONE_ORDER } from './constants'

// 현재 상태에서 다음 페이즈 계산
export function getNextPhase(state: GameState, _settings: GameSettings): GamePhase {
  switch (state.phase) {
    case 'waiting':
      return 'setup_place'

    case 'setup_place':
      // 모든 캐릭터 배치 완료 → 첫 라운드 시작 (주사위만)
      return state.setupPlacementOrder.length === 0 ? 'roll_dice' : 'setup_place'

    case 'roll_dice':
      return 'dice_reveal'

    case 'dice_reveal':
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
  // 보안관부터 시작하는 선언 순서 — 살아있는 캐릭터가 있는 플레이어만 포함
  const sheriffFirst = [
    ...state.playerOrder.slice(state.sheriffIndex),
    ...state.playerOrder.slice(0, state.sheriffIndex),
  ].filter(pid =>
    Object.values(state.characters).some(c => c.playerId === pid && c.isAlive)
  )
  return {
    ...state,
    characterDeclarations: {},
    declarationOrder: sheriffFirst,
    sealedDestinations: {},
    destinationStatus: {},
    resolvedMoves: [],
    currentMoveStep: 0,
    currentEventZoneIndex: 0,
    currentVote: null,
    lastDiceRoll: null,
    itemSearchPreview: null,
    lastZombieAttackResult: null,
    cctvViewers: [],
    weaponUseStatus: {},
    weaponKillChoices: {},
    hiddenCharacters: {},
    lastHideRevealAnnounce: null,
    zombiePlayerZoneChoices: {},
    lastZombiePlayerAnnounce: null,
    lastWeaponUseAnnounce: null,
  }
}

// 보안관 플레이어 ID 반환
export function getSheriffPlayerId(state: GameState): string {
  return state.playerOrder[state.sheriffIndex]
}

// 보안관이 현재 보안실에 캐릭터를 보유 중인지 확인
// → true면 진짜 보안관 (주사위 비공개 가능)
// → false면 임시 보안관 (주사위 항상 공개)
export function checkRealSheriff(state: GameState): boolean {
  const sheriffId = getSheriffPlayerId(state)
  return state.zones.security.characterIds.some(charId => {
    const char = state.characters[charId]
    return char?.isAlive && char.playerId === sheriffId
  })
}

// 라운드 시작 시 진짜/임시 보안관 여부 갱신
export function updateSheriffStatus(state: GameState): GameState {
  return { ...state, isRealSheriff: checkRealSheriff(state) }
}

// 다음 라운드 보안관 교체
// nextSheriffPlayerId가 있으면 그 플레이어로 교체하고 playerOrder 재편
// 기획서: "새 보안관이 1번이 되도록 순서 재편, 기존 상대 순서 유지"
export function resolveNextSheriff(state: GameState): GameState {
  if (!state.nextSheriffPlayerId) return state

  const newSheriffId = state.nextSheriffPlayerId
  const oldOrder = state.playerOrder
  const newIndex = oldOrder.indexOf(newSheriffId)
  if (newIndex === -1) return state

  // 새 보안관을 맨 앞으로, 나머지는 기존 상대 순서 유지
  const newOrder = [
    ...oldOrder.slice(newIndex),
    ...oldOrder.slice(0, newIndex),
  ]

  return {
    ...state,
    playerOrder: newOrder,
    sheriffIndex: 0,
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
