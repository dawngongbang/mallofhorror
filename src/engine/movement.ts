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

// 이동 계획 수립 (보드 변경 없이 이동 결과만 계산)
// 목적지가 가득 찼으면 주차장으로 튕겨남 (순서대로 시뮬레이션)
export function planMovesInOrder(
  state: GameState,
  sealedDestinations: Record<string, SealedDestination>
): ResolvedMove[] {
  // 선언 순서대로 정렬
  const orderedDeclarations = Object.values(state.characterDeclarations).sort(
    (a, b) => a.order - b.order
  )

  // 이동 시뮬레이션용 임시 상태 (실제 state는 변경하지 않음)
  let simState = { ...state, zones: deepCloneZones(state.zones), characters: { ...state.characters } }
  const resolvedMoves: ResolvedMove[] = []

  for (const declaration of orderedDeclarations) {
    const { playerId, characterId, order } = declaration
    const sealed = sealedDestinations[playerId]
    if (!sealed) continue

    const character = simState.characters[characterId]
    if (!character || !character.isAlive) continue

    const fromZone = character.zone
    const intendedZone = sealed.targetZone
    let targetZone = intendedZone
    let bumpedToParking = false

    // 목적지가 가득 찼으면 주차장으로
    if (targetZone !== 'parking' && isZoneFull(targetZone, simState)) {
      targetZone = 'parking'
      bumpedToParking = true
    }

    // 시뮬레이션 상태만 갱신 (실제 board 반영은 move_execute 단계에서 단계적으로)
    simState = applyMoveToState(simState, characterId, fromZone, targetZone)

    resolvedMoves.push({
      playerId,
      characterId,
      fromZone,
      intendedZone,
      targetZone,
      order,
      executed: false,
      bumpedToParking,
    })
  }

  return resolvedMoves
}

// 전체 이동 한 번에 처리 (테스트 및 레거시 호환용)
export function resolveMovesInOrder(
  state: GameState,
  sealedDestinations: Record<string, SealedDestination>
): GameState {
  const moves = planMovesInOrder(state, sealedDestinations)
  let next = { ...state, resolvedMoves: moves, currentMoveStep: 0 }
  for (let i = 0; i < moves.length; i++) {
    next = applyMoveStep(next, i)
  }
  return next
}

// 단일 이동 적용 (move_execute 단계에서 한 칸씩 호출)
export function applyMoveStep(
  state: GameState,
  moveIndex: number
): GameState {
  const move = state.resolvedMoves[moveIndex]
  if (!move) return state

  const newState = applyMoveToState(state, move.characterId, move.fromZone, move.targetZone)
  const updatedMoves = state.resolvedMoves.map((m, i) =>
    i === moveIndex ? { ...m, executed: true } : m
  )
  return { ...newState, resolvedMoves: updatedMoves, currentMoveStep: moveIndex + 1 }
}

// 단일 캐릭터 이동 적용 (내부용)
function applyMoveToState(
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
