import type { GameState, GameSettings, Player, ZoneName, Character, CharacterId } from './types'
import { CHARACTERS_BY_PLAYER_COUNT, ZONE_CONFIGS, EVENT_ZONE_ORDER } from './constants'
import { createItemDeck, shuffle, dealItems } from './items'
import { rollZombieDice } from './dice'

// 게임 초기 상태 생성
export function createInitialGameState(
  players: Player[],
  settings: GameSettings
): GameState {
  const playerIds = players.map(p => p.id)
  const characterIds = CHARACTERS_BY_PLAYER_COUNT[settings.playerCount]

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
