import { describe, it, expect } from 'vitest'
import { calcBonusZombies, isZoneFull } from '../dice'
import { createTestState, addCharacterToZone } from './helpers'

describe('calcBonusZombies', () => {
  it('미녀 최다 구역 반환', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    addCharacterToZone(state, 'p3_belle', 'bathroom') // 1명

    const { belleZone } = calcBonusZombies(state)
    expect(belleZone).toBe('clothing')
  })

  it('미녀 동률이면 null', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'bathroom')

    const { belleZone } = calcBonusZombies(state)
    expect(belleZone).toBeNull()
  })

  it('캐릭터 최다 구역 반환', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p1_toughguy', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'bathroom')

    const { mostCrowdedZone } = calcBonusZombies(state)
    expect(mostCrowdedZone).toBe('clothing')
  })

  it('캐릭터 동률이면 null', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'bathroom')

    const { mostCrowdedZone } = calcBonusZombies(state)
    expect(mostCrowdedZone).toBeNull()
  })
})

describe('isZoneFull', () => {
  it('화장실 수용 3명, 3명이면 가득 참', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'bathroom')
    addCharacterToZone(state, 'p2_belle', 'bathroom')
    addCharacterToZone(state, 'p3_belle', 'bathroom')
    expect(isZoneFull('bathroom', state)).toBe(true)
  })

  it('화장실 2명이면 여유 있음', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'bathroom')
    addCharacterToZone(state, 'p2_belle', 'bathroom')
    expect(isZoneFull('bathroom', state)).toBe(false)
  })

  it('주차장은 항상 여유 있음 (무제한)', () => {
    const state = createTestState()
    Object.keys(state.characters).forEach(id =>
      addCharacterToZone(state, id, 'parking')
    )
    expect(isZoneFull('parking', state)).toBe(false)
  })
})
