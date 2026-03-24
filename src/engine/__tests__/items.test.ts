import { describe, it, expect } from 'vitest'
import { createItemDeck, shuffle, dealItems } from '../items'

describe('createItemDeck', () => {
  it('전체 21장 생성', () => {
    const deck = createItemDeck()
    expect(deck.length).toBe(21)
  })

  it('협박카드 3장', () => {
    const deck = createItemDeck()
    expect(deck.filter(i => i.itemId === 'threat').length).toBe(3)
  })

  it('샷건 1장', () => {
    const deck = createItemDeck()
    expect(deck.filter(i => i.itemId === 'shotgun').length).toBe(1)
  })

  it('모든 instanceId가 고유', () => {
    const deck = createItemDeck()
    const ids = deck.map(i => i.instanceId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('shuffle', () => {
  it('길이가 유지됨', () => {
    const deck = createItemDeck()
    const shuffled = shuffle(deck)
    expect(shuffled.length).toBe(deck.length)
  })

  it('동일한 시드는 동일한 결과', () => {
    const deck = createItemDeck()
    const s1 = shuffle(deck, 42)
    const s2 = shuffle(deck, 42)
    expect(s1.map(i => i.instanceId)).toEqual(s2.map(i => i.instanceId))
  })
})

describe('dealItems', () => {
  it('3명에게 3장씩 배분 후 12장 남음', () => {
    const deck = shuffle(createItemDeck())
    const { playerItems, remainingDeck } = dealItems(deck, ['p1', 'p2', 'p3'])
    expect(playerItems['p1'].length).toBe(3)
    expect(playerItems['p2'].length).toBe(3)
    expect(playerItems['p3'].length).toBe(3)
    expect(remainingDeck.length).toBe(12)
  })

  it('6명에게 3장씩 배분 후 3장 남음', () => {
    const deck = shuffle(createItemDeck())
    const { remainingDeck } = dealItems(deck, ['p1','p2','p3','p4','p5','p6'])
    expect(remainingDeck.length).toBe(3)
  })
})
