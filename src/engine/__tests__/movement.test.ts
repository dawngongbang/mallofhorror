import { describe, it, expect } from 'vitest'
import { isValidMove, resolveMovesInOrder } from '../movement'
import { createTestState, addCharacterToZone } from './helpers'

describe('isValidMove', () => {
  it('다른 구역으로 이동은 유효', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    const result = isValidMove('p1_belle', 'bathroom', state)
    expect(result.valid).toBe(true)
  })

  it('같은 구역으로 이동은 무효', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    const result = isValidMove('p1_belle', 'clothing', state)
    expect(result.valid).toBe(false)
  })

  it('사망한 캐릭터는 이동 불가', () => {
    const state = createTestState()
    state.characters['p1_belle'] = { ...state.characters['p1_belle'], isAlive: false }
    const result = isValidMove('p1_belle', 'clothing', state)
    expect(result.valid).toBe(false)
  })
})

describe('resolveMovesInOrder', () => {
  it('선언 순서대로 이동 처리', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'bathroom')

    state.characterDeclarations = {
      p1: { playerId: 'p1', characterId: 'p1_belle', order: 0, declaredAt: 0 },
      p2: { playerId: 'p2', characterId: 'p2_belle', order: 1, declaredAt: 0 },
    }

    const newState = resolveMovesInOrder(state, {
      p1: { playerId: 'p1', targetZone: 'bathroom', submittedAt: 0 },
      p2: { playerId: 'p2', targetZone: 'clothing', submittedAt: 0 },
    })

    expect(newState.characters['p1_belle'].zone).toBe('bathroom')
    expect(newState.characters['p2_belle'].zone).toBe('clothing')
  })

  it('목적지 가득 차면 주차장으로 튕겨남', () => {
    const state = createTestState()
    // 화장실 정원 3명으로 가득 채우기
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'bathroom')
    addCharacterToZone(state, 'p3_belle', 'bathroom')
    addCharacterToZone(state, 'p1_toughguy', 'bathroom') // bathroom: 3명 (정원 꽉 참)

    state.characterDeclarations = {
      p1: { playerId: 'p1', characterId: 'p1_belle', order: 0, declaredAt: 0 },
    }

    // p1_belle이 가득 찬 bathroom으로 이동 시도
    const newState = resolveMovesInOrder(state, {
      p1: { playerId: 'p1', targetZone: 'bathroom', submittedAt: 0 },
    })

    expect(newState.characters['p1_belle'].zone).toBe('parking')
    expect(newState.resolvedMoves[0].bumpedToParking).toBe(true)
  })
})
