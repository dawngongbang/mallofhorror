import type { GameState, ZoneName } from '../types'
import { ZONE_CONFIGS } from '../constants'

// 테스트용 최소 게임 상태 생성
export function createTestState(): GameState {
  const zones = {} as GameState['zones']
  for (const zoneName of Object.keys(ZONE_CONFIGS) as ZoneName[]) {
    zones[zoneName] = { zombies: 0, characterIds: [], isClosed: false }
  }

  return {
    phase: 'character_select',
    round: 1,
    phaseDeadline: 0,
    phaseStartedAt: 0,
    playerOrder: ['p1', 'p2', 'p3'],
    sheriffIndex: 0,
    isRealSheriff: false,
    nextSheriffPlayerId: null,
    securityOccupantsAtRoundStart: [],
    characters: {
      p1_belle:    { id: 'p1_belle',    playerId: 'p1', characterId: 'belle',    zone: 'corridor' as ZoneName, isAlive: true },
      p1_toughguy: { id: 'p1_toughguy', playerId: 'p1', characterId: 'toughguy', zone: 'corridor' as ZoneName, isAlive: true },
      p1_gunman:   { id: 'p1_gunman',   playerId: 'p1', characterId: 'gunman',   zone: 'corridor' as ZoneName, isAlive: true },
      p2_belle:    { id: 'p2_belle',    playerId: 'p2', characterId: 'belle',    zone: 'corridor' as ZoneName, isAlive: true },
      p2_toughguy: { id: 'p2_toughguy', playerId: 'p2', characterId: 'toughguy', zone: 'corridor' as ZoneName, isAlive: true },
      p2_gunman:   { id: 'p2_gunman',   playerId: 'p2', characterId: 'gunman',   zone: 'corridor' as ZoneName, isAlive: true },
      p3_belle:    { id: 'p3_belle',    playerId: 'p3', characterId: 'belle',    zone: 'corridor' as ZoneName, isAlive: true },
      p3_toughguy: { id: 'p3_toughguy', playerId: 'p3', characterId: 'toughguy', zone: 'corridor' as ZoneName, isAlive: true },
      p3_gunman:   { id: 'p3_gunman',   playerId: 'p3', characterId: 'gunman',   zone: 'corridor' as ZoneName, isAlive: true },
    },
    zones,
    setupPlacementOrder: [],
    setupDiceRoll: null,
    characterDeclarations: {},
    declarationOrder: [],
    sealedDestinations: {},
    destinationStatus: {},
    resolvedMoves: [],
    currentMoveStep: 0,
    lastDiceRoll: null,
    currentEventZoneIndex: 0,
    currentVote: null,
    itemDeck: [],
    itemSearchPreview: null,
    itemSearchWinnerId: null,
    itemSearchChoice: null,
    playerItemCounts: { p1: 3, p2: 3, p3: 3 },
    cardReactionWindow: null,
    sheriffRollRequest: null,
    pendingVictimSelection: null,
    lastVoteAnnounce: null,
    lastZombieAttackResult: null,
    cctvViewers: [],
    weaponUseStatus: {},
    weaponKillChoices: {},
    pendingHideChoices: {},
    pendingSprintChoices: {},
    pendingHardwareChoices: {},
    hiddenCharacters: {},
    lastHideRevealAnnounce: null,
    lastSprintAnnounce: null,
    zombiePlayerZoneChoices: {},
    lastZombiePlayerAnnounce: null,
    lastWeaponUseAnnounce: null,
    lastItemSearchAnnounce: null,
    zombieSpawnBatches: null,
    zombieSpawnStep: 0,
    lastBonusZombieResult: null,

    winners: [],
    finalScores: {},
  }
}

// 캐릭터를 특정 구역에 추가 (테스트 헬퍼)
export function addCharacterToZone(
  state: GameState,
  characterId: string,
  zone: ZoneName
): void {
  const char = state.characters[characterId]
  if (!char) return

  // 기존 구역에서 제거
  const oldZone = char.zone as ZoneName
  if (oldZone && state.zones[oldZone]) {
    state.zones[oldZone].characterIds = state.zones[oldZone].characterIds.filter(
      id => id !== characterId
    )
  }

  // 새 구역에 추가
  state.characters[characterId] = { ...char, zone }
  state.zones[zone].characterIds = [...(state.zones[zone].characterIds ?? []), characterId]
}
