import { describe, it, expect } from 'vitest'
import {
  openBeforeVoteWindow,
  openAfterVoteWindow,
  closeReactionWindow,
  isReactionWindowComplete,
  useSprintInMovement,
  useSprintBeforeVote,
  useSprintAfterVote,
  useHiddenInMovement,
  useHiddenBeforeVote,
  useHiddenAfterVote,
  useWeapon,
  useThreatCard,
} from '../itemUsage'
import { createTestState, addCharacterToZone } from './helpers'

// ── 반응 창 관리 ─────────────────────────────────────────────

describe('openBeforeVoteWindow', () => {
  it('before_vote 창 열림', () => {
    const state = createTestState()
    const result = openBeforeVoteWindow(state, 'clothing', ['p1', 'p2'], 10)

    expect(result.cardReactionWindow).not.toBeNull()
    expect(result.cardReactionWindow!.timing).toBe('before_vote')
    expect(result.cardReactionWindow!.candidatePlayers).toEqual(['p1', 'p2'])
    expect(result.cardReactionWindow!.escaped).toEqual([])
  })
})

describe('openAfterVoteWindow', () => {
  it('after_vote 창 열림', () => {
    const state = createTestState()
    const result = openAfterVoteWindow(state, 'clothing', 'p1', 15)

    expect(result.cardReactionWindow!.timing).toBe('after_vote')
    expect(result.cardReactionWindow!.loserPlayerId).toBe('p1')
    expect(result.cardReactionWindow!.reactionUsed).toBe(false)
  })
})

describe('closeReactionWindow', () => {
  it('창 닫힘', () => {
    const state = openBeforeVoteWindow(createTestState(), 'clothing', ['p1'], 10)
    expect(closeReactionWindow(state).cardReactionWindow).toBeNull()
  })
})

describe('isReactionWindowComplete', () => {
  it('모든 후보가 카드를 쓰면 완료', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')

    let s = openBeforeVoteWindow(state, 'clothing', ['p1', 'p2'], 10)
    s = useHiddenBeforeVote(s, 'p1', 'hidden_card_0')
    s = useHiddenBeforeVote(s, 'p2', 'hidden_card_1')

    expect(isReactionWindowComplete(s)).toBe(true)
  })

  it('아직 결정 안 한 후보가 있으면 미완료', () => {
    const state = createTestState()
    const s = openBeforeVoteWindow(state, 'clothing', ['p1', 'p2'], 10)

    expect(isReactionWindowComplete(s)).toBe(false)
  })
})

// ── sprint: 이동 페이즈 ──────────────────────────────────────

describe('useSprintInMovement', () => {
  it('봉인된 목적지 변경', () => {
    const state = createTestState()
    state.sealedDestinations['p1'] = {
      playerId: 'p1',
      targetZone: 'clothing',
      submittedAt: Date.now(),
    }

    const result = useSprintInMovement(state, 'p1', 'sprint_0', 'bathroom')
    expect(result.sealedDestinations['p1'].targetZone).toBe('bathroom')
  })

  it('봉인 전에는 사용 불가', () => {
    const state = createTestState()
    const result = useSprintInMovement(state, 'p1', 'sprint_0', 'bathroom')
    expect(result).toBe(state)
  })

  it('잘못된 아이템 ID는 무시', () => {
    const state = createTestState()
    state.sealedDestinations['p1'] = {
      playerId: 'p1',
      targetZone: 'clothing',
      submittedAt: Date.now(),
    }
    const result = useSprintInMovement(state, 'p1', 'axe_0', 'bathroom')
    expect(result).toBe(state)
  })
})

// ── sprint: before_vote ──────────────────────────────────────

describe('useSprintBeforeVote', () => {
  it('캐릭터 이동 + 후보에서 제외', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')

    const s = openBeforeVoteWindow(state, 'clothing', ['p1', 'p2'], 10)
    const result = useSprintBeforeVote(s, 'p1', 'sprint_0', 'p1_belle', 'bathroom')

    expect(result.characters['p1_belle'].zone).toBe('bathroom')
    expect(result.zones.bathroom.characterIds).toContain('p1_belle')
    expect(result.zones.clothing.characterIds).not.toContain('p1_belle')
    expect(result.cardReactionWindow!.escaped).toContain('p1')
    expect(result.cardReactionWindow!.usedCards['p1']).toBe('sprint')
  })

  it('before_vote 창 없으면 무시', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    const result = useSprintBeforeVote(state, 'p1', 'sprint_0', 'p1_belle', 'bathroom')
    expect(result).toBe(state)
  })

  it('후보가 아닌 플레이어는 사용 불가', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    const s = openBeforeVoteWindow(state, 'clothing', ['p2'], 10)  // p1은 후보 아님
    const result = useSprintBeforeVote(s, 'p1', 'sprint_0', 'p1_belle', 'bathroom')
    expect(result).toBe(s)
  })
})

// ── sprint: after_vote ───────────────────────────────────────

describe('useSprintAfterVote', () => {
  it('패배자가 카드 사용 → 이동 + reactionUsed true', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')

    const s = openAfterVoteWindow(state, 'clothing', 'p1', 10)
    const result = useSprintAfterVote(s, 'p1', 'sprint_0', 'p1_belle', 'bathroom')

    expect(result.characters['p1_belle'].zone).toBe('bathroom')
    expect(result.cardReactionWindow!.reactionUsed).toBe(true)
  })

  it('패배자가 아닌 플레이어는 사용 불가', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p2_belle', 'clothing')
    const s = openAfterVoteWindow(state, 'clothing', 'p1', 10)
    const result = useSprintAfterVote(s, 'p2', 'sprint_0', 'p2_belle', 'bathroom')
    expect(result).toBe(s)
  })
})

// ── hidden_card: 이동 페이즈 ────────────────────────────────

describe('useHiddenInMovement', () => {
  it('봉인된 목적지를 현재 위치로 덮어씀', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'security')
    state.characterDeclarations['p1'] = {
      playerId: 'p1',
      characterId: 'p1_belle',
      order: 0,
      declaredAt: Date.now(),
    }
    state.sealedDestinations['p1'] = {
      playerId: 'p1',
      targetZone: 'clothing',
      submittedAt: Date.now(),
    }

    const result = useHiddenInMovement(state, 'p1', 'hidden_card_0')
    expect(result.sealedDestinations['p1'].targetZone).toBe('security')  // 현재 위치 유지
  })
})

// ── hidden_card: before_vote ─────────────────────────────────

describe('useHiddenBeforeVote', () => {
  it('제자리 유지 + 후보에서 제외', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')

    const s = openBeforeVoteWindow(state, 'clothing', ['p1', 'p2'], 10)
    const result = useHiddenBeforeVote(s, 'p1', 'hidden_card_0')

    // 캐릭터 위치 변화 없음
    expect(result.characters['p1_belle'].zone).toBe('clothing')
    expect(result.cardReactionWindow!.escaped).toContain('p1')
    expect(result.cardReactionWindow!.usedCards['p1']).toBe('hidden_card')
  })
})

// ── hidden_card: after_vote ──────────────────────────────────

describe('useHiddenAfterVote', () => {
  it('제자리 유지 + reactionUsed true', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')

    const s = openAfterVoteWindow(state, 'clothing', 'p1', 10)
    const result = useHiddenAfterVote(s, 'p1', 'hidden_card_0')

    expect(result.characters['p1_belle'].zone).toBe('clothing')  // 이동 없음
    expect(result.cardReactionWindow!.reactionUsed).toBe(true)
  })
})

// ── 무기 사용 ─────────────────────────────────────────────────

describe('useWeapon', () => {
  it('도끼: 좀비 1마리 제거', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 3

    const result = useWeapon(state, 'clothing', 'axe_0', 'p1')
    expect(result.zones.clothing.zombies).toBe(2)
  })

  it('샷건: 좀비 2마리 제거', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 3

    const result = useWeapon(state, 'clothing', 'shotgun_0', 'p1')
    expect(result.zones.clothing.zombies).toBe(1)
  })

  it('좀비보다 많이 제거하면 0으로 고정', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 1

    const result = useWeapon(state, 'clothing', 'shotgun_0', 'p1')
    expect(result.zones.clothing.zombies).toBe(0)
  })

  it('무기가 아닌 아이템은 무시', () => {
    const state = createTestState()
    state.zones.clothing.zombies = 3

    const result = useWeapon(state, 'clothing', 'threat_0', 'p1')
    expect(result).toBe(state)
  })
})

// ── 협박카드 ─────────────────────────────────────────────────

describe('useThreatCard', () => {
  it('투표권 +1 적용', () => {
    const state = createTestState()
    addCharacterToZone(state, 'p1_belle', 'clothing')
    addCharacterToZone(state, 'p2_belle', 'clothing')

    const voteState = {
      zone: 'clothing' as const,
      type: 'zombie_attack' as const,
      round: 0,
      votes: {},
      status: { p1: false, p2: false },
      eligibleVoters: ['p1', 'p2'],
      candidates: ['p1', 'p2'],
      bonusVoteWeights: {},
    }

    const { voteState: updated } = useThreatCard(voteState, state, 'p1', 'threat_0')
    expect(updated.bonusVoteWeights['p1']).toBe(1)
  })

  it('잘못된 아이템은 무시', () => {
    const state = createTestState()
    const voteState = {
      zone: 'clothing' as const,
      type: 'zombie_attack' as const,
      round: 0,
      votes: {},
      status: {},
      eligibleVoters: [],
      candidates: [],
      bonusVoteWeights: {},
    }

    const { voteState: unchanged } = useThreatCard(voteState, state, 'p1', 'axe_0')
    expect(unchanged.bonusVoteWeights['p1']).toBeUndefined()
  })
})
