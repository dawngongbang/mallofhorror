import type { GameState, WinCheckResult, ZoneName } from './types'
import { CHARACTER_CONFIGS } from './constants'

const NON_PARKING_ZONES: ZoneName[] = ['bathroom', 'clothing', 'toy', 'security', 'supermarket']

// 승리 조건 체크
// 전체 생존 캐릭터 ≤ 4 AND 주차장 제외 한 구역에 모두 집결
export function checkWinCondition(state: GameState): WinCheckResult {
  const aliveCharacters = Object.values(state.characters).filter(c => c.isAlive)

  // 생존 캐릭터 없음 → 전원 탈락
  if (aliveCharacters.length === 0) {
    return { gameOver: true, winners: [], finalScores: {} }
  }

  // 주차장 외 모든 구역이 폐쇄 → 생존 가능한 구역 없음 → 전원 탈락
  const allNonParkingClosed = NON_PARKING_ZONES.every(z => state.zones[z]?.isClosed)
  if (allNonParkingClosed) {
    return { gameOver: true, winners: [], finalScores: {} }
  }

  // 생존 캐릭터가 4개 초과면 아직 게임 진행
  if (aliveCharacters.length > 4) return { gameOver: false }

  // 주차장 제외 구역 중 모든 생존 캐릭터가 한 구역에 있는지 확인
  for (const zone of NON_PARKING_ZONES) {
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
