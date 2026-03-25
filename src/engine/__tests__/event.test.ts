import { describe, it, expect } from 'vitest'
import {
  startZoneAttackPhase,
  applyZombieAttackResult,
  determineSurvivorEvent,
  startZoneSurvivorPhase,
  applyItemSearchResult,
  applySheriffVoteResult,
} from '../event'
import { createTestState, addCharacterToZone } from './helpers'
import { createItemDeck, shuffle } from '../items'

// ── 1단계: 좀비 공격 ─────────────────────────────────────────

describe('startZoneAttackPhase', () => {
  it('좀비 공격 중이면 zombie_attack 투표 시작', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')   // 방어 1
    state.zones.clothing.zombies = 2                     // 좀비 2 > 방어 1 → 공격

    const result = startZoneAttackPhase('clothing', state)
    expect(result).not.toBeNull()
    expect(result!.currentVote?.type).toBe('zombie_attack')
    expect(result!.phase).toBe('voting')
  })

  it('좀비가 방어력 이하면 공격 없음 → null 반환', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_toughguy', 'clothing') // 방어 2
    state.zones.clothing.zombies = 2                      // 좀비 2 = 방어 2 → 안전

    const result = startZoneAttackPhase('clothing', state)
    expect(result).toBeNull()
  })

  it('캐릭터 없는 구역은 null 반환', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 5

    const result = startZoneAttackPhase('clothing', state)
    expect(result).toBeNull()
  })

  it('주차장은 좀비 1마리만 있어도 공격 발생', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    state.zones.parking.zombies = 1

    const result = startZoneAttackPhase('parking', state)
    expect(result).not.toBeNull()
    expect(result!.currentVote?.zone).toBe('parking')
  })
})

describe('applyZombieAttackResult', () => {
  it('희생 캐릭터 사망 + 구역 좀비 전부 소멸', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    state.zones.clothing.zombies = 3

    const result = applyZombieAttackResult(state, 'clothing', 'p1_belle')

    expect(result.characters['p1_belle'].isAlive).toBe(false)
    expect(result.zones.clothing.zombies).toBe(0)
    expect(result.zones.clothing.characterIds).not.toContain('p1_belle')
  })

  it('살아남은 캐릭터는 그대로', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    state.zones.clothing.zombies = 3

    const result = applyZombieAttackResult(state, 'clothing', 'p1_belle')

    expect(result.characters['p2_belle'].isAlive).toBe(true)
    expect(result.zones.clothing.characterIds).toContain('p2_belle')
  })

  it('이미 죽은 캐릭터는 무시', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    state.characters['p1_belle'].isAlive = false
    state.zones.clothing.zombies = 3

    const result = applyZombieAttackResult(state, 'clothing', 'p1_belle')
    expect(result).toBe(state)  // 변경 없음
  })
})

// ── 2단계: 생존자 이벤트 ─────────────────────────────────────

describe('determineSurvivorEvent', () => {
  it('주차장에서 좀비 공격 해결 후 → truck_search', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    state.zones.parking.zombies = 0

    expect(determineSurvivorEvent('parking', state)).toBe('truck_search')
  })

  it('일반 구역(옷가게 등)은 truck_search 없음 → null', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    state.zones.clothing.zombies = 0

    expect(determineSurvivorEvent('clothing', state)).toBeNull()
  })

  it('좀비 공격 해결 후 보안실 → sheriff', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'security')
    state.zones.security.zombies = 0

    expect(determineSurvivorEvent('security', state)).toBe('sheriff')
  })

  it('아직 좀비 공격 중이면 null (1단계 미완료)', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    state.zones.clothing.zombies = 5  // 공격 중

    expect(determineSurvivorEvent('clothing', state)).toBeNull()
  })

  it('캐릭터 없으면 null', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 0

    expect(determineSurvivorEvent('clothing', state)).toBeNull()
  })

  it('좀비 공격으로 전멸 후 생존자 없으면 null', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    // 좀비 공격 결과로 캐릭터 사망
    state.characters['p1_belle'].isAlive = false
    state.zones.clothing.characterIds = []
    state.zones.clothing.zombies = 0

    expect(determineSurvivorEvent('clothing', state)).toBeNull()
  })
})

describe('startZoneSurvivorPhase', () => {
  it('주차장: truck_search 투표 시작', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    addCharacterToZone(state, 'p2_belle', 'parking')
    state.zones.parking.zombies = 0

    const result = startZoneSurvivorPhase('parking', state)
    expect(result).not.toBeNull()
    expect(result!.currentVote?.type).toBe('truck_search')
  })

  it('일반 구역: truck_search 없음 → null', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    state.zones.clothing.zombies = 0

    const result = startZoneSurvivorPhase('clothing', state)
    expect(result).toBeNull()
  })

  it('sheriff 투표 시작 (보안실)', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'security')
    state.zones.security.zombies = 0

    const result = startZoneSurvivorPhase('security', state)
    expect(result).not.toBeNull()
    expect(result!.currentVote?.type).toBe('sheriff')
  })

  it('이벤트 없으면 null', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 0

    const result = startZoneSurvivorPhase('clothing', state)
    expect(result).toBeNull()
  })
})

// ── 전체 흐름: 공격 → 생존자 이벤트 ─────────────────────────

describe('2단계 흐름', () => {
  it('주차장: 좀비 공격 없이 생존 → truck_search', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    addCharacterToZone(state, 'p2_belle', 'parking')
    state.zones.parking.zombies = 0

    expect(startZoneAttackPhase('parking', state)).toBeNull()

    const survivorResult = startZoneSurvivorPhase('parking', state)
    expect(survivorResult!.currentVote?.type).toBe('truck_search')
  })

  it('주차장: 공격 발생 → 사망 적용 → 생존자 truck_search 진행', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    addCharacterToZone(state, 'p2_belle', 'parking')
    state.zones.parking.zombies = 1  // 주차장은 1마리도 공격

    const attackState = startZoneAttackPhase('parking', state)
    expect(attackState).not.toBeNull()

    const afterDeath = applyZombieAttackResult(attackState!, 'parking', 'p1_belle')
    expect(afterDeath.zones.parking.zombies).toBe(0)

    const survivorResult = startZoneSurvivorPhase('parking', afterDeath)
    expect(survivorResult).not.toBeNull()
    expect(survivorResult!.currentVote?.type).toBe('truck_search')
    expect(survivorResult!.currentVote?.candidates).toContain('p2')
  })

  it('일반 구역: 공격 해결 후에도 truck_search 없음', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')
    state.zones.clothing.zombies = 3

    const afterDeath = applyZombieAttackResult(state, 'clothing', 'p1_belle')
    expect(startZoneSurvivorPhase('clothing', afterDeath)).toBeNull()
  })

  it('주차장: 전멸 → truck_search 없음', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'parking')
    state.zones.parking.zombies = 1

    const afterDeath = applyZombieAttackResult(state, 'parking', 'p1_belle')
    expect(startZoneSurvivorPhase('parking', afterDeath)).toBeNull()
  })
})

// ── 아이템 탐색 결과 적용 ────────────────────────────────────

describe('applyItemSearchResult', () => {
  it('덱에서 3장 뽑아 itemSearchPreview 설정', () => {
    const state = createTestState()
    state.itemDeck = shuffle(createItemDeck())

    const result = applyItemSearchResult(state, 'p1')
    expect(result.itemSearchPreview).toHaveLength(3)
  })

  it('덱이 비어있으면 변경 없음', () => {
    const state = createTestState()
    state.itemDeck = []

    const result = applyItemSearchResult(state, 'p1')
    expect(result.itemSearchPreview).toBeNull()
  })
})

// ── 보안관 투표 결과 적용 ────────────────────────────────────

describe('applySheriffVoteResult', () => {
  it('winner가 다음 라운드 보안관으로 지정', () => {
    const state = createTestState()

    const result = applySheriffVoteResult(state, 'p2')
    expect(result.nextSheriffPlayerId).toBe('p2')
  })
})
