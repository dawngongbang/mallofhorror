import type { GameState, ZoneName, ResolvedMove, SealedDestination } from './types'
import { isZoneFull } from './dice'

// 이동 유효성 검사
export function isValidMove(
  characterId: string,
  targetZone: ZoneName,
  state: GameState
): { valid: boolean; reason?: string } {
  const character = state.characters[characterId]
  if (!character) return { valid: false, reason: '캐릭터를 찾을 수 없습니다.' }
  if (!character.isAlive) return { valid: false, reason: '사망한 캐릭터입니다.' }
  if (character.zone === targetZone) return { valid: false, reason: '같은 구역으로는 이동할 수 없습니다.' }
  return { valid: true }
}

// 봉인된 이동 전부 공개 후 순서대로 처리
// 목적지가 가득 찼으면 주차장으로 튕겨남
export function resolveMovesInOrder(
  state: GameState,
  sealedDestinations: Record<string, SealedDestination>
): GameState {
  // 선언 순서대로 정렬
  const orderedDeclarations = Object.values(state.characterDeclarations).sort(
    (a, b) => a.order - b.order
  )

  let newState = { ...state, zones: deepCloneZones(state.zones), characters: { ...state.characters } }
  const resolvedMoves: ResolvedMove[] = []

  for (const declaration of orderedDeclarations) {
    const { playerId, characterId, order } = declaration
    const sealed = sealedDestinations[playerId]
    if (!sealed) continue

    const character = newState.characters[characterId]
    if (!character || !character.isAlive) continue

    const fromZone = character.zone
    let targetZone = sealed.targetZone
    let bumpedToParking = false

    // 목적지가 가득 찼으면 주차장으로
    if (targetZone !== 'parking' && isZoneFull(targetZone, newState)) {
      targetZone = 'parking'
      bumpedToParking = true
    }

    // 캐릭터 이동
    newState = moveCharacter(newState, characterId, fromZone, targetZone)

    resolvedMoves.push({
      playerId,
      characterId,
      fromZone,
      targetZone,
      order,
      executed: true,
      bumpedToParking,
    })
  }

  return { ...newState, resolvedMoves }
}

// 단일 캐릭터 이동 적용
function moveCharacter(
  state: GameState,
  characterId: string,
  fromZone: ZoneName,
  toZone: ZoneName
): GameState {
  const zones = { ...state.zones }

  // 출발 구역에서 제거
  zones[fromZone] = {
    ...zones[fromZone],
    characterIds: zones[fromZone].characterIds.filter(id => id !== characterId),
  }

  // 도착 구역에 추가
  zones[toZone] = {
    ...zones[toZone],
    characterIds: [...zones[toZone].characterIds, characterId],
  }

  // 캐릭터 zone 업데이트
  const characters = {
    ...state.characters,
    [characterId]: { ...state.characters[characterId], zone: toZone },
  }

  return { ...state, zones, characters }
}

function deepCloneZones(zones: GameState['zones']): GameState['zones'] {
  const result = {} as GameState['zones']
  for (const [k, v] of Object.entries(zones)) {
    result[k as ZoneName] = { ...v, characterIds: [...v.characterIds] }
  }
  return result
}
