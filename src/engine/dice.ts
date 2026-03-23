import type { DiceRollResult, ZoneName, GameState } from './types'
import { DICE_TO_ZONE, ZONE_CONFIGS } from './constants'

// 주사위 1개 굴리기 (1~6)
export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1
}

// 주사위 N개 굴리기
export function rollDice(count: number): number[] {
  return Array.from({ length: count }, rollDie)
}

// 주사위 4개 굴려서 좀비 배치 결과 계산
export function rollZombieDice(): DiceRollResult {
  const dice = rollDice(4) as [number, number, number, number]
  const zombiesByZone: Partial<Record<ZoneName, number>> = {}

  for (const die of dice) {
    const zone = DICE_TO_ZONE[die]
    zombiesByZone[zone] = (zombiesByZone[zone] ?? 0) + 1
  }

  return { dice, zombiesByZone }
}

// 초기 배치용 주사위 2개 굴리기
export function rollSetupDice(): [number, number] {
  return [rollDie(), rollDie()]
}

// 주사위 결과를 게임 상태에 적용 (좀비 배치)
export function applyZombiePlacement(
  state: GameState,
  roll: DiceRollResult
): GameState {
  const zones = { ...state.zones }

  for (const [zoneName, count] of Object.entries(roll.zombiesByZone)) {
    const zone = zoneName as ZoneName
    zones[zone] = {
      ...zones[zone],
      zombies: zones[zone].zombies + (count ?? 0),
    }
  }

  return { ...state, zones, lastDiceRoll: roll }
}

// 추가 좀비 배치 계산
// 규칙: 미녀가 가장 많은 구역 +1, 캐릭터가 가장 많은 구역 +1 (동률 스킵)
export function calcBonusZombies(
  state: GameState
): { belleZone: ZoneName | null; mostCrowdedZone: ZoneName | null } {
  const allZones = Object.keys(state.zones) as ZoneName[]

  // 미녀 수 카운트
  const belleCounts: Partial<Record<ZoneName, number>> = {}
  for (const zone of allZones) {
    const belleCount = state.zones[zone].characterIds.filter(id => {
      const char = state.characters[id]
      return char?.isAlive && state.characters[id]?.characterId === 'belle'
    }).length
    if (belleCount > 0) belleCounts[zone] = belleCount
  }

  // 전체 캐릭터 수 카운트
  const crowdCounts: Partial<Record<ZoneName, number>> = {}
  for (const zone of allZones) {
    const count = state.zones[zone].characterIds.filter(
      id => state.characters[id]?.isAlive
    ).length
    if (count > 0) crowdCounts[zone] = count
  }

  return {
    belleZone: findUniqueMax(belleCounts),
    mostCrowdedZone: findUniqueMax(crowdCounts),
  }
}

// 최댓값이 유일한 구역 반환 (동률이면 null)
function findUniqueMax(counts: Partial<Record<ZoneName, number>>): ZoneName | null {
  const entries = Object.entries(counts) as [ZoneName, number][]
  if (entries.length === 0) return null

  const maxVal = Math.max(...entries.map(([, v]) => v))
  const maxZones = entries.filter(([, v]) => v === maxVal)

  return maxZones.length === 1 ? maxZones[0][0] : null
}

// 보너스 좀비를 게임 상태에 적용
export function applyBonusZombies(state: GameState): GameState {
  const { belleZone, mostCrowdedZone } = calcBonusZombies(state)
  let zones = { ...state.zones }

  if (belleZone) {
    zones = {
      ...zones,
      [belleZone]: { ...zones[belleZone], zombies: zones[belleZone].zombies + 1 },
    }
  }

  // 미녀 보너스와 같은 구역이어도 별도로 추가
  if (mostCrowdedZone) {
    zones = {
      ...zones,
      [mostCrowdedZone]: {
        ...zones[mostCrowdedZone],
        zombies: zones[mostCrowdedZone].zombies + 1,
      },
    }
  }

  return { ...state, zones }
}

// 구역이 가득 찼는지 확인 (이동 가능 여부 판단용)
export function isZoneFull(zoneName: ZoneName, state: GameState): boolean {
  const config = ZONE_CONFIGS[zoneName]
  if (config.maxCapacity === Infinity) return false
  const aliveCount = state.zones[zoneName].characterIds.filter(
    id => state.characters[id]?.isAlive
  ).length
  return aliveCount >= config.maxCapacity
}
