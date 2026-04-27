import type { GameState, ZoneName, VoteState, VoteResult, VoteType } from './types'
import { ZONE_CONFIGS, CHARACTER_CONFIGS, MAX_REVOTE_COUNT } from './constants'

// ── 방어력 계산 ──────────────────────────────────────────────

// 구역의 실제 방어력 계산
// = min(구역 방어 한도, 구역 내 캐릭터 방어력 합산 + 하드웨어 보너스)
export function calcDefense(
  zone: ZoneName,
  state: GameState,
  hardwareBonus: number = 0
): number {
  const config = ZONE_CONFIGS[zone]
  const charDefenseSum = state.zones[zone].characterIds
    .filter(id => state.characters[id]?.isAlive && !state.hiddenCharacters?.[id])
    .reduce((sum, id) => {
      const char = state.characters[id]
      return sum + (CHARACTER_CONFIGS[char.characterId]?.defense ?? 1)
    }, 0)

  return Math.min(config.defenseLimit, charDefenseSum + hardwareBonus)
}

// 구역에 습격이 발생하는지 확인
export function isUnderAttack(zone: ZoneName, state: GameState, hardwareBonus: number = 0): boolean {
  const zombies = state.zones[zone].zombies
  if (zombies === 0) return false
  const defense = calcDefense(zone, state, hardwareBonus)
  return zombies > defense
}

// ── 투표 ────────────────────────────────────────────────────

// 투표 초기화 (새 투표 시작)
export function createVoteState(
  zone: ZoneName,
  type: VoteType,
  state: GameState,
  round: number = 0
): VoteState {
  // 숨은 캐릭터는 방어·투표에서 제외
  const aliveInZone = state.zones[zone].characterIds
    .filter(id => state.characters[id]?.isAlive && !state.hiddenCharacters?.[id])
    .map(id => state.characters[id].playerId)

  const eligibleVoterIds = [...new Set(aliveInZone)]

  // 전체 투표(2차 재투표 이후)면 전체 플레이어 참여
  const isGlobalVote = round >= MAX_REVOTE_COUNT
  const eligibleVoters = isGlobalVote
    ? getAlivePlayers(state)
    : eligibleVoterIds

  // 후보: 해당 구역에 캐릭터가 있는 플레이어
  const candidates = eligibleVoterIds

  return {
    zone,
    type,
    round,
    votes: {},
    status: Object.fromEntries(eligibleVoters.map(id => [id, false])),
    eligibleVoters,
    candidates,
    bonusVoteWeights: {},
  }
}

// 투표 집계 및 결과 계산
export function calculateVoteResult(
  voteState: VoteState,
  state: GameState
): VoteResult {
  const tally: Record<string, number> = {}
  for (const candidate of voteState.candidates) {
    tally[candidate] = 0
  }

  // 투표 집계 (투표권 가중치 반영)
  // 전체 투표(round >= MAX_REVOTE_COUNT) 시 구역 외 플레이어도 최소 1표 보장
  const isGlobalVote = voteState.round >= MAX_REVOTE_COUNT
  for (const [voterId, targetId] of Object.entries(voteState.votes)) {
    if (tally[targetId] === undefined) continue
    const base = getVoteWeight(voterId, voteState.zone, state)
    const effective = isGlobalVote ? Math.max(1, base) : base
    const bonus = voteState.bonusVoteWeights[voterId] ?? 0
    tally[targetId] += effective + bonus
  }

  const maxVotes = Math.max(...Object.values(tally))
  const topCandidates = Object.entries(tally)
    .filter(([, v]) => v === maxVotes)
    .map(([id]) => id)

  if (topCandidates.length === 1) {
    return {
      zone: voteState.zone,
      type: voteState.type,
      tally,
      winner: topCandidates[0],
      tieBreak: 'none',
    }
  }

  // 동률 처리
  const tieBreak = voteState.round >= MAX_REVOTE_COUNT ? 'global_vote' : 'revote'
  return {
    zone: voteState.zone,
    type: voteState.type,
    tally,
    winner: null,
    tieBreak,
  }
}

// 투표권 계산 (캐릭터당 1표 + 건맨 2표 + 협박카드 효과는 별도)
export function getVoteWeight(
  playerId: string,
  zone: ZoneName,
  state: GameState
): number {
  return state.zones[zone].characterIds
    .filter(id => {
      const char = state.characters[id]
      return char?.isAlive && char.playerId === playerId && !state.hiddenCharacters?.[id]
    })
    .reduce((sum, id) => {
      const char = state.characters[id]
      return sum + (CHARACTER_CONFIGS[char.characterId]?.voteWeight ?? 1)
    }, 0)
}

// ── 사망 처리 ────────────────────────────────────────────────

// 사망할 캐릭터 적용 (플레이어가 선택한 캐릭터 ID)
// 사망 후 해당 구역 좀비 전부 소멸
export function applyDeath(
  state: GameState,
  characterId: string
): GameState {
  const character = state.characters[characterId]
  if (!character || !character.isAlive) return state

  const zone = character.zone

  return {
    ...state,
    characters: {
      ...state.characters,
      [characterId]: { ...character, isAlive: false },
    },
    zones: {
      ...state.zones,
      [zone]: {
        ...state.zones[zone],
        zombies: 0,  // 사망 발생 → 해당 구역 좀비 전부 소멸
        characterIds: state.zones[zone].characterIds.filter(id => id !== characterId),
      },
    },
  }
}

// ── 유틸 ────────────────────────────────────────────────────

function getAlivePlayers(state: GameState): string[] {
  const playerIds = new Set<string>()
  for (const char of Object.values(state.characters)) {
    if (char.isAlive) playerIds.add(char.playerId)
  }
  return [...playerIds]
}

// 구역에서 특정 플레이어의 생존 캐릭터 목록
export function getAliveCharactersInZone(
  playerId: string,
  zone: ZoneName,
  state: GameState
): string[] {
  return state.zones[zone].characterIds.filter(id => {
    const char = state.characters[id]
    return char?.isAlive && char.playerId === playerId && !state.hiddenCharacters?.[id]
  })
}
