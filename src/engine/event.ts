import type { GameState, ZoneName, VoteType } from './types'
import { isUnderAttack, createVoteState } from './combat'
import { drawItemsForSearch } from './items'
import { ZONE_CONFIGS } from './constants'

// ── 구역 이벤트 — 2단계 처리 ─────────────────────────────────
//
// 각 구역은 순서대로 두 단계를 거친다:
//
// [1단계] 좀비 공격 (zombie_attack)
//   - 좀비 수 > 방어력이면 투표 발생
//   - 패배자의 캐릭터 1개 사망 + 해당 구역 좀비 전부 소멸
//
// [2단계] 생존자 이벤트 (truck_search / sheriff)
//   - 1단계 이후에도 살아남은 캐릭터가 있을 때만 진행
//   - 보안실: sheriff 투표 (다음 라운드 보안관 결정)
//   - 그 외: truck_search 투표 (탐색자가 아이템 3장 중 1장 획득)
//
// → startZoneAttackPhase()  : 1단계 시작 (좀비 공격 여부 체크)
// → startZoneSurvivorPhase(): 2단계 시작 (생존자 이벤트 여부 체크)
// 호스트는 1단계 완료 후 반드시 2단계를 별도로 트리거해야 한다.

// ── 1단계: 좀비 공격 ─────────────────────────────────────────

// 폐쇄 조건 체크 및 적용: 좀비 8개 이상 + 사람 없음 + canClose
// zone_announce 시점에 호출. 폐쇄되면 true 반환
export function checkAndCloseZone(zone: ZoneName, state: GameState): GameState | null {
  const zoneState = state.zones[zone]
  if (zoneState.isClosed) return null  // 이미 폐쇄됨
  if (!ZONE_CONFIGS[zone].canClose) return null
  const aliveCount = zoneState.characterIds.filter(id => state.characters[id]?.isAlive).length
  if (zoneState.zombies >= 8 && aliveCount === 0) {
    return {
      ...state,
      zones: { ...state.zones, [zone]: { ...zoneState, isClosed: true } },
    }
  }
  return null
}

// 좀비 공격 투표 시작 (공격 중이 아니면 null 반환)
export function startZoneAttackPhase(
  zone: ZoneName,
  state: GameState
): GameState | null {
  if (state.zones[zone].isClosed) return null  // 폐쇄 구역은 이벤트 없음
  if (!hasAliveCharacters(zone, state)) return null
  if (!isUnderAttack(zone, state)) return null

  const voteState = createVoteState(zone, 'zombie_attack', state)
  return { ...state, currentVote: voteState, phase: 'voting' }
}

// 좀비 공격 투표 결과 적용
// winner가 희생할 캐릭터를 선택 → 해당 캐릭터 사망, 구역 좀비 전부 소멸
export function applyZombieAttackResult(
  state: GameState,
  zone: ZoneName,
  victimCharacterId: string
): GameState {
  const character = state.characters[victimCharacterId]
  if (!character || !character.isAlive) return state

  return {
    ...state,
    characters: {
      ...state.characters,
      [victimCharacterId]: { ...character, isAlive: false },
    },
    zones: {
      ...state.zones,
      [zone]: {
        ...state.zones[zone],
        zombies: 0,
        characterIds: state.zones[zone].characterIds.filter(id => id !== victimCharacterId),
      },
    },
    lastZombieAttackResult: {
      zone,
      deadCharacterId: victimCharacterId,
      deadPlayerId: character.playerId,
    },
  }
}

// ── 2단계: 생존자 이벤트 ─────────────────────────────────────

// 생존자 이벤트 타입 결정
// 반드시 좀비 공격(1단계) 처리가 끝난 상태에서 호출해야 한다.
export function determineSurvivorEvent(
  zone: ZoneName,
  state: GameState
): VoteType | null {
  if (state.zones[zone].isClosed) return null
  if (!hasAliveCharacters(zone, state)) return null
  // 이 시점에서 좀비 공격이 남아 있으면 안 됨 (1단계 미완료 버그)
  if (isUnderAttack(zone, state)) return null

  if (zone === 'security') return 'sheriff'
  if (zone === 'parking' && state.itemDeck.length > 0) return 'truck_search'
  return null  // 그 외 구역 또는 덱 소진 시 생존자 이벤트 없음
}

// 생존자 이벤트 투표 시작 (이벤트 없으면 null 반환)
export function startZoneSurvivorPhase(
  zone: ZoneName,
  state: GameState
): GameState | null {
  const type = determineSurvivorEvent(zone, state)
  if (!type) return null

  const voteState = createVoteState(zone, type, state)
  return { ...state, currentVote: voteState, phase: 'voting' }
}

// 트럭 수색 투표 결과 적용
// winner가 탐색자 → 덱에서 min(3, 남은 수)장 뽑아 itemSearchPreview에 저장
export function applyItemSearchResult(
  state: GameState,
  _winnerId: string
): GameState {
  if (state.itemDeck.length === 0) return state

  const drawCount = Math.min(3, state.itemDeck.length)
  const { preview, remainingDeck } = drawItemsForSearch(state.itemDeck, drawCount)
  // preview만 빼고 나머지 유지 (반환 카드는 나중에 다시 넣음)
  const previewIds = new Set(preview.map(i => i.instanceId))
  return {
    ...state,
    itemDeck: remainingDeck.filter(i => !previewIds.has(i.instanceId)),
    itemSearchPreview: preview.map(item => item.instanceId),
  }
}

// 보안관 투표 결과 적용
// winner가 다음 라운드 보안관
export function applySheriffVoteResult(
  state: GameState,
  winnerId: string
): GameState {
  return { ...state, nextSheriffPlayerId: winnerId }
}

// ── 유틸 ────────────────────────────────────────────────────

function hasAliveCharacters(zone: ZoneName, state: GameState): boolean {
  return state.zones[zone].characterIds.some(
    id => state.characters[id]?.isAlive
  )
}
