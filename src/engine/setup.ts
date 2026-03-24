import type { GameState, GameSettings, Player, ZoneName, Character, CharacterId } from './types'
import { CHARACTERS_BY_PLAYER_COUNT, ZONE_CONFIGS, DICE_TO_ZONE } from './constants'
import { createItemDeck, shuffle, dealItems } from './items'
import { rollZombieDice, rollSetupDice, isZoneFull } from './dice'

// 게임 초기 상태 생성
export function createInitialGameState(
  players: Player[],
  _settings: GameSettings
): GameState {
  const playerIds = players.map(p => p.id)
  const actualCount = Math.max(3, Math.min(6, players.length))
  const characterIds = CHARACTERS_BY_PLAYER_COUNT[actualCount]

  // 캐릭터 인스턴스 생성
  const characters: Record<string, Character> = {}
  const updatedPlayers = players.map(player => {
    const playerCharIds: string[] = []
    for (const charId of characterIds) {
      const instanceId = `${player.id}_${charId}`
      characters[instanceId] = {
        id: instanceId,
        playerId: player.id,
        characterId: charId as CharacterId,
        zone: 'parking',  // 배치 전 임시 위치
        isAlive: true,
      }
      playerCharIds.push(instanceId)
    }
    return { ...player, characterIds: playerCharIds }
  })

  // 구역 초기화 (모든 캐릭터는 아직 배치 안 됨)
  const zones = initZones()

  // 아이템 덱 생성 및 배분
  const shuffledDeck = shuffle(createItemDeck())
  const { playerItems, remainingDeck } = dealItems(shuffledDeck, playerIds)

  // 플레이어 아이템 할당
  for (const player of updatedPlayers) {
    player.itemIds = playerItems[player.id] ?? []
  }

  // 배치 순서: 보안관부터, 캐릭터 수만큼 반복
  // 예) 플레이어 [A,B,C], 캐릭터 3개 → [A,B,C, A,B,C, A,B,C]
  const setupPlacementOrder = buildSetupOrder(playerIds, characterIds.length, characters)

  // 보안관 인덱스 랜덤 선정
  const sheriffIndex = Math.floor(Math.random() * playerIds.length)

  return {
    phase: 'setup_place',
    round: 0,
    phaseDeadline: 0,
    phaseStartedAt: Date.now(),

    playerOrder: playerIds,
    sheriffIndex,
    isRealSheriff: false,  // 초기에는 임시 보안관
    nextSheriffPlayerId: null,

    characters,
    zones,

    setupPlacementOrder,
    setupDiceRoll: null,

    characterDeclarations: {},
    declarationOrder: [],
    sealedDestinations: {},
    destinationStatus: {},
    resolvedMoves: [],

    lastDiceRoll: null,
    currentEventZoneIndex: 0,
    currentVote: null,

    itemDeck: remainingDeck,
    itemSearchPreview: null,

    cardReactionWindow: null,

    winners: [],
    finalScores: {},
  }
}

// 구역 초기 상태 (좀비 0, 캐릭터 없음)
function initZones(): Record<ZoneName, { zombies: number; characterIds: string[] }> {
  const zones = {} as Record<ZoneName, { zombies: number; characterIds: string[] }>
  for (const zoneName of Object.keys(ZONE_CONFIGS) as ZoneName[]) {
    zones[zoneName] = { zombies: 0, characterIds: [] }
  }
  return zones
}

// 초기 배치 순서 생성
// 보안관부터 시작해서 플레이어 순으로, 캐릭터 수만큼 반복
// 반환: 배치해야 할 캐릭터 인스턴스 ID 배열 (순서대로)
function buildSetupOrder(
  playerOrder: string[],
  charsPerPlayer: number,
  characters: Record<string, Character>
): string[] {
  const order: string[] = []

  for (let round = 0; round < charsPerPlayer; round++) {
    for (const playerId of playerOrder) {
      // 이 플레이어의 아직 배치 안 된 캐릭터 중 첫 번째
      const unplaced = Object.values(characters)
        .filter(c => c.playerId === playerId && c.zone === 'parking')
        .map(c => c.id)

      if (unplaced[round]) {
        order.push(unplaced[round])
      }
    }
  }

  return order
}

// 초기 배치: 특정 캐릭터를 구역에 놓기
export function placeCharacter(
  state: GameState,
  characterId: string,
  targetZone: ZoneName
): GameState {
  const character = state.characters[characterId]
  if (!character) return state

  const fromZone = character.zone

  const zones = { ...state.zones }
  // 기존 위치(parking 임시)에서 제거
  zones[fromZone] = {
    ...zones[fromZone],
    characterIds: zones[fromZone].characterIds.filter(id => id !== characterId),
  }
  // 목적지에 추가
  zones[targetZone] = {
    ...zones[targetZone],
    characterIds: [...zones[targetZone].characterIds, characterId],
  }

  return {
    ...state,
    characters: {
      ...state.characters,
      [characterId]: { ...character, zone: targetZone },
    },
    zones,
    setupPlacementOrder: state.setupPlacementOrder.slice(1),  // 다음 배치로
    setupDiceRoll: null,
  }
}

// 초기 배치: 주사위 2개 굴려 배치 옵션 계산
// 반환: 플레이어가 선택 가능한 구역 목록
//   - 두 주사위 구역 중 가득 차지 않은 구역 목록
//   - 둘 다 가득 찼으면 → 모든 구역 자유 선택
export function rollAndGetPlacementOptions(state: GameState): {
  state: GameState
  options: ZoneName[]
} {
  const roll = rollSetupDice()
  const zone1 = DICE_TO_ZONE[roll[0]]
  const zone2 = DICE_TO_ZONE[roll[1]]

  const candidates = zone1 === zone2 ? [zone1] : [zone1, zone2]
  const available = candidates.filter(z => !isZoneFull(z, state))

  // 둘 다 가득 찼으면 모든 구역 자유 선택
  const options: ZoneName[] = available.length > 0
    ? available
    : (Object.keys(state.zones) as ZoneName[]).filter(z => !isZoneFull(z, state))

  return {
    state: { ...state, setupDiceRoll: roll },
    options,
  }
}

// 첫 라운드 시작 전 주사위 굴리기 (좀비만 배치, 이동 없음)
export function startFirstRound(state: GameState): GameState {
  const roll = rollZombieDice()
  const zones = { ...state.zones }

  for (const [zoneName, count] of Object.entries(roll.zombiesByZone)) {
    const zone = zoneName as ZoneName
    zones[zone] = { ...zones[zone], zombies: zones[zone].zombies + (count ?? 0) }
  }

  return {
    ...state,
    phase: 'character_select',
    round: 1,
    zones,
    lastDiceRoll: roll,
    currentEventZoneIndex: 0,
  }
}
