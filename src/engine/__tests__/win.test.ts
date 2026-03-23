import { describe, it, expect } from 'vitest'
import { checkWinCondition, calcFinalScores } from '../win'
import { createTestState, addCharacterToZone } from './helpers'

describe('checkWinCondition', () => {
  it('생존 캐릭터 5개 이상이면 게임 미종료', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p1_toughguy', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    addCharacterToZone(state, 'p2_toughguy', 'clothing')
    addCharacterToZone(state, 'p3_belle', 'clothing')
    // 5명 모두 한 구역 — 그래도 5 > 4이므로 미종료
    const result = checkWinCondition(state)
    expect(result.gameOver).toBe(false)
  })

  it('캐릭터 4개 이하 + 한 구역 집결 → 종료', () => {
    const state = createTestState()
    // 8명 사망 처리
    Object.values(state.characters).forEach(c => {
      if (c.id !== 'p1_belle' && c.id !== 'p2_belle' &&
          c.id !== 'p3_belle' && c.id !== 'p1_toughguy') {
        state.characters[c.id] = { ...c, isAlive: false }
      }
    })
    // 4명 clothing에 집결
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    addCharacterToZone(state, 'p3_belle', 'clothing')
    addCharacterToZone(state, 'p1_toughguy', 'clothing')

    const result = checkWinCondition(state)
    expect(result.gameOver).toBe(true)
  })

  it('주차장에 집결하면 종료 안 됨', () => {
    const state = createTestState()
    Object.values(state.characters).forEach(c => {
      if (c.id !== 'p1_belle' && c.id !== 'p2_belle' &&
          c.id !== 'p3_belle' && c.id !== 'p1_toughguy') {
        state.characters[c.id] = { ...c, isAlive: false }
      }
    })
    // 주차장에 집결
    addCharacterToZone(state, 'p1_belle', 'parking')
    addCharacterToZone(state, 'p2_belle', 'parking')
    addCharacterToZone(state, 'p3_belle', 'parking')
    addCharacterToZone(state, 'p1_toughguy', 'parking')

    const result = checkWinCondition(state)
    expect(result.gameOver).toBe(false)
  })

  it('4개 이하지만 여러 구역에 분산 → 미종료', () => {
    const state = createTestState()
    Object.values(state.characters).forEach(c => {
      if (c.id !== 'p1_belle' && c.id !== 'p2_belle') {
        state.characters[c.id] = { ...c, isAlive: false }
      }
    })
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'bathroom') // 다른 구역

    const result = checkWinCondition(state)
    expect(result.gameOver).toBe(false)
  })
})

describe('calcFinalScores', () => {
  it('생존 캐릭터 점수 합산', () => {
    const state = createTestState()
    // p1: belle(7) + toughguy(5) = 12, p2: belle(7)만 생존
    state.characters['p1_gunman'] = { ...state.characters['p1_gunman'], isAlive: false }
    state.characters['p2_toughguy'] = { ...state.characters['p2_toughguy'], isAlive: false }
    state.characters['p2_gunman'] = { ...state.characters['p2_gunman'], isAlive: false }
    state.characters['p3_belle'] = { ...state.characters['p3_belle'], isAlive: false }
    state.characters['p3_toughguy'] = { ...state.characters['p3_toughguy'], isAlive: false }
    state.characters['p3_gunman'] = { ...state.characters['p3_gunman'], isAlive: false }

    const scores = calcFinalScores(state)
    expect(scores['p1']).toBe(12) // belle(7) + toughguy(5)
    expect(scores['p2']).toBe(7)  // belle(7)만
    expect(scores['p3']).toBeUndefined() // 전멸
  })
})
