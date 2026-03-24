import { describe, it, expect } from 'vitest'
import { calcDefense, isUnderAttack, calculateVoteResult, getVoteWeight, applyDeath } from '../combat'
import { createTestState, addCharacterToZone } from './helpers'

describe('calcDefense', () => {
  it('터프가이는 방어력 2', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_toughguy', 'clothing')
    expect(calcDefense('clothing', state)).toBe(2)
  })

  it('슈퍼마켓 방어 한도는 4 (사람이 많아도)', () => {
    const state = createTestState()
    // 터프가이(2) + 미녀(1) + 건맨(1) + 터프가이(2) = 6이지만 한도 4
    addCharacterToZone(state, 'p1_toughguy', 'supermarket')
    addCharacterToZone(state, 'p1_belle', 'supermarket')
    addCharacterToZone(state, 'p2_toughguy', 'supermarket')
    addCharacterToZone(state, 'p2_belle', 'supermarket')
    expect(calcDefense('supermarket', state)).toBe(4)
  })

  it('주차장은 항상 방어력 0', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_toughguy', 'parking')
    addCharacterToZone(state, 'p1_belle', 'parking')
    expect(calcDefense('parking', state)).toBe(0)
  })

  it('하드웨어 보너스 적용', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing') // 방어 1
    expect(calcDefense('clothing', state, 1)).toBe(2) // 1 + 1 = 2
  })

  it('방어 한도를 초과한 하드웨어는 한도까지만', () => {
    const state = createTestState()
    // 화장실 한도 3, 미녀(1)+미녀(1)+미녀(1) = 3, 하드웨어 +1 → min(4, 3) = 3
    addCharacterToZone(state, 'p1_belle', 'bathroom')
    addCharacterToZone(state, 'p2_belle', 'bathroom')
    addCharacterToZone(state, 'p3_belle', 'bathroom')
    expect(calcDefense('bathroom', state, 1)).toBe(3)
  })
})

describe('isUnderAttack', () => {
  it('좀비 수 > 방어력이면 습격', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing') // 방어 1
    state.zones.clothing.zombies = 2
    expect(isUnderAttack('clothing', state)).toBe(true)
  })

  it('좀비 수 = 방어력이면 안전', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing') // 방어 1
    state.zones.clothing.zombies = 1
    expect(isUnderAttack('clothing', state)).toBe(false)
  })

  it('주차장은 좀비 1마리만 있어도 습격', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    state.zones.parking.zombies = 1
    expect(isUnderAttack('parking', state)).toBe(true)
  })

  it('좀비 없으면 습격 없음', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    state.zones.parking.zombies = 0
    expect(isUnderAttack('parking', state)).toBe(false)
  })
})

describe('getVoteWeight', () => {
  it('건맨은 투표권 2개', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_gunman', 'clothing')
    expect(getVoteWeight('p1', 'clothing', state)).toBe(2)
  })

  it('같은 구역에 캐릭터 여러 개면 합산', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')   // 1
    addCharacterToZone(state, 'p1_gunman', 'clothing')  // 2
    expect(getVoteWeight('p1', 'clothing', state)).toBe(3)
  })
})

describe('applyDeath', () => {
  it('캐릭터 사망 후 isAlive false', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    state.zones.clothing.zombies = 3

    const newState = applyDeath(state, 'p1_belle')
    expect(newState.characters['p1_belle'].isAlive).toBe(false)
  })

  it('사망 발생 시 해당 구역 좀비 전부 소멸', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    state.zones.clothing.zombies = 5

    const newState = applyDeath(state, 'p1_belle')
    expect(newState.zones.clothing.zombies).toBe(0)
  })

  it('사망한 캐릭터는 구역 목록에서 제거', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    state.zones.clothing.zombies = 3

    const newState = applyDeath(state, 'p1_belle')
    expect(newState.zones.clothing.characterIds).not.toContain('p1_belle')
  })
})

describe('calculateVoteResult', () => {
  it('명확한 과반수 → winner 결정', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')

    const voteState = {
      zone: 'clothing' as const,
      type: 'zombie_attack' as const,
      round: 0,
      votes: { p1: 'p2', p2: 'p2' },
      status: { p1: true, p2: true },
      eligibleVoters: ['p1', 'p2'],
      candidates: ['p1', 'p2'],
      bonusVoteWeights: {},
    }

    const result = calculateVoteResult(voteState, state)
    expect(result.winner).toBe('p2')
    expect(result.tieBreak).toBe('none')
  })

  it('동률 → revote', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')

    const voteState = {
      zone: 'clothing' as const,
      type: 'zombie_attack' as const,
      round: 0,
      votes: { p1: 'p2', p2: 'p1' },
      status: { p1: true, p2: true },
      eligibleVoters: ['p1', 'p2'],
      candidates: ['p1', 'p2'],
      bonusVoteWeights: {},
    }

    const result = calculateVoteResult(voteState, state)
    expect(result.winner).toBeNull()
    expect(result.tieBreak).toBe('revote')
  })
})

import { checkRealSheriff, resolveNextSheriff } from '../phase'

describe('checkRealSheriff', () => {
  it('보안관이 보안실에 캐릭터 보유 → 진짜 보안관', () => {
    const state = createTestState()
    // sheriffIndex=0 → p1이 보안관
    addCharacterToZone(state, 'p1_belle', 'security')

    expect(checkRealSheriff(state)).toBe(true)
  })

  it('보안관이 보안실에 캐릭터 없음 → 임시 보안관', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p2_belle', 'security')  // p2 캐릭터만 있음

    expect(checkRealSheriff(state)).toBe(false)
  })

  it('보안실 비어있으면 임시 보안관', () => {
    const state = createTestState()
    expect(checkRealSheriff(state)).toBe(false)
  })
})

describe('resolveNextSheriff', () => {
  it('새 보안관이 playerOrder 맨 앞으로 이동', () => {
    const state = createTestState()
    // playerOrder: ['p1','p2','p3'], 현재 보안관 p1
    state.nextSheriffPlayerId = 'p3'

    const result = resolveNextSheriff(state)
    expect(result.playerOrder).toEqual(['p3', 'p1', 'p2'])
    expect(result.sheriffIndex).toBe(0)
    expect(result.nextSheriffPlayerId).toBeNull()
  })

  it('nextSheriffPlayerId 없으면 변경 없음', () => {
    const state = createTestState()
    const result = resolveNextSheriff(state)
    expect(result.playerOrder).toEqual(['p1', 'p2', 'p3'])
  })

  it('이미 1번이면 순서 그대로', () => {
    const state = createTestState()
    state.nextSheriffPlayerId = 'p1'

    const result = resolveNextSheriff(state)
    expect(result.playerOrder).toEqual(['p1', 'p2', 'p3'])
    expect(result.sheriffIndex).toBe(0)
  })
})
