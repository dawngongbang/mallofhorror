import type { GameState, WinCheckResult, ZoneName } from './types'
import { CHARACTER_CONFIGS } from './constants'

// 승리 조건 체크
// 전체 생존 캐릭터 ≤ 4 AND 주차장 제외 한 구역에 모두 집결
export function checkWinCondition(state: GameState): WinCheckResult {
  const aliveCharacters = Object.values(state.characters).filter(c => c.isAlive)

  // 생존 캐릭터가 4개 초과면 아직 게임 진행
  if (aliveCharacters.length > 4) return { gameOver: false }

  // 주차장 제외 구역 중 모든 생존 캐릭터가 한 구역에 있는지 확인
  const nonParkingZones: ZoneName[] = [
    'bathroom', 'clothing', 'toy', 'security', 'supermarket',
  ]

  for (const zone of nonParkingZones) {
    const zoneCharIds = state.zones[zone].characterIds.filter(
      id => state.characters[id]?.isAlive
    )
    if (zoneCharIds.length === aliveCharacters.length && aliveCharacters.length > 0) {
      // 모두 이 구역에 집결 → 게임 종료
      const finalScores = calcFinalScores(state)
      const winners = findWinners(finalScores)
      return { gameOver: true, winners, finalScores }
    }
  }

  return { gameOver: false }
}

// 플레이어별 생존 캐릭터 점수 합산
export function calcFinalScores(state: GameState): Record<string, number> {
  const scores: Record<string, number> = {}

  for (const char of Object.values(state.characters)) {
    if (!char.isAlive) continue
    const score = CHARACTER_CONFIGS[char.characterId]?.score ?? 0
    scores[char.playerId] = (scores[char.playerId] ?? 0) + score
  }

  return scores
}

// 최고 점수 플레이어 (동점 시 공동 우승)
function findWinners(scores: Record<string, number>): string[] {
  if (Object.keys(scores).length === 0) return []
  const maxScore = Math.max(...Object.values(scores))
  return Object.entries(scores)
    .filter(([, score]) => score === maxScore)
    .map(([id]) => id)
}
