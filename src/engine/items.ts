import type { Item, ItemId } from './types'
import { ITEM_CONFIGS } from './constants'

// 전체 아이템 덱 생성 (설정의 count만큼 인스턴스 생성)
export function createItemDeck(): Item[] {
  const deck: Item[] = []
  for (const config of Object.values(ITEM_CONFIGS)) {
    for (let i = 0; i < config.count; i++) {
      deck.push({
        instanceId: `${config.id}_${i}`,
        itemId: config.id as ItemId,
      })
    }
  }
  return deck
}

// Fisher-Yates 셔플
export function shuffle<T>(deck: T[], seed?: number): T[] {
  const arr = [...deck]
  // seed가 있으면 재현 가능한 셔플 (테스트용)
  const random = seed !== undefined ? seededRandom(seed) : Math.random
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 시드 기반 난수 생성기 (테스트 재현성용)
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0x100000000
  }
}

// 플레이어들에게 아이템 배분
// 반환: { playerItems: playerId → instanceId[], remainingDeck }
export function dealItems(
  shuffledDeck: Item[],
  playerIds: string[],
  itemsPerPlayer: number = 3
): { playerItems: Record<string, string[]>; remainingDeck: Item[] } {
  const playerItems: Record<string, string[]> = {}
  let deckIndex = 0

  for (const playerId of playerIds) {
    playerItems[playerId] = []
    for (let i = 0; i < itemsPerPlayer; i++) {
      if (deckIndex < shuffledDeck.length) {
        playerItems[playerId].push(shuffledDeck[deckIndex].instanceId)
        deckIndex++
      }
    }
  }

  return {
    playerItems,
    remainingDeck: shuffledDeck.slice(deckIndex),
  }
}

// 아이템 탐색: 남은 덱에서 3개 랜덤으로 뽑아 보여줌
// 반환: 보여줄 아이템 3개 instanceId
export function drawItemsForSearch(
  deck: Item[],
  count: number = 3
): { preview: Item[]; remainingDeck: Item[] } {
  const shuffled = shuffle(deck)
  return {
    preview: shuffled.slice(0, count),
    remainingDeck: shuffled,  // 셔플된 상태 유지 (순서 추적 방지)
  }
}

// 탐색자가 선택 완료 후 덱 업데이트
// kept: 소유할 아이템 instanceId
// given: 타인에게 줄 아이템 instanceId
// returned: 덱에 반납할 아이템 instanceId
export function resolveItemSearch(
  deck: Item[],
  preview: Item[],
  kept: string,
  given: string,
  returned: string
): Item[] {
  // preview에 없던 나머지 아이템 + returned 아이템으로 새 덱 구성
  const returnedItem = preview.find(item => item.instanceId === returned)
  const previewIds = new Set([kept, given, returned])
  const remainingFromDeck = deck.filter(item => !previewIds.has(item.instanceId))

  if (!returnedItem) return remainingFromDeck
  return [...remainingFromDeck, returnedItem]
}
