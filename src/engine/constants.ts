import type { ZoneConfig, ZoneName, CharacterConfig, CharacterId, ItemConfig, ItemId } from './types'

// ── 구역 설정 ────────────────────────────────────────────────

export const ZONE_CONFIGS: Record<ZoneName, ZoneConfig> = {
  bathroom: {
    name: 'bathroom',
    displayName: '화장실',
    zoneNumber: 1,
    maxCapacity: 3,
    defenseLimit: 3,
    canClose: true,
  },
  clothing: {
    name: 'clothing',
    displayName: '옷가게',
    zoneNumber: 2,
    maxCapacity: 4,
    defenseLimit: 4,
    canClose: true,
  },
  toy: {
    name: 'toy',
    displayName: '장난감가게',
    zoneNumber: 3,
    maxCapacity: 4,
    defenseLimit: 4,
    canClose: true,
  },
  parking: {
    name: 'parking',
    displayName: '주차장',
    zoneNumber: 4,
    maxCapacity: Infinity,
    defenseLimit: 0,  // 항상 습격
    canClose: false,  // 좀비 아무리 많아도 폐쇄 안 됨
  },
  security: {
    name: 'security',
    displayName: '보안실',
    zoneNumber: 5,
    maxCapacity: 3,
    defenseLimit: 3,
    canClose: true,
  },
  supermarket: {
    name: 'supermarket',
    displayName: '슈퍼마켓',
    zoneNumber: 6,
    maxCapacity: 6,
    defenseLimit: 4,  // 6명이어도 방어는 4까지
    canClose: true,
  },
}

// 주사위 눈 → 구역 매핑
export const DICE_TO_ZONE: Record<number, ZoneName> = {
  1: 'bathroom',
  2: 'clothing',
  3: 'toy',
  4: 'parking',
  5: 'security',
  6: 'supermarket',
}

// 이벤트 처리 순서 (1번 구역부터)
export const EVENT_ZONE_ORDER: ZoneName[] = [
  'bathroom',
  'clothing',
  'toy',
  'parking',
  'security',
  'supermarket',
]

// ── 캐릭터 설정 ─────────────────────────────────────────────

export const CHARACTER_CONFIGS: Record<CharacterId, CharacterConfig> = {
  belle: {
    id: 'belle',
    name: '미녀',
    score: 7,
    defense: 1,
    voteWeight: 1,
    isBelle: true,
  },
  toughguy: {
    id: 'toughguy',
    name: '터프가이',
    score: 5,
    defense: 2,   // 좀비 2마리 방어
    voteWeight: 1,
    isBelle: false,
  },
  gunman: {
    id: 'gunman',
    name: '건맨',
    score: 3,
    defense: 1,
    voteWeight: 2,  // 투표권 2개
    isBelle: false,
  },
  kid: {
    id: 'kid',
    name: '아이',
    score: 1,
    defense: 1,
    voteWeight: 1,
    isBelle: false,
  },
}

// 플레이어 수별 사용 캐릭터
export const CHARACTERS_BY_PLAYER_COUNT: Record<number, CharacterId[]> = {
  2: ['belle', 'toughguy', 'gunman', 'kid'],  // 테스트용 2인
  3: ['belle', 'toughguy', 'gunman', 'kid'],
  4: ['belle', 'toughguy', 'gunman'],
  5: ['belle', 'toughguy', 'gunman'],
  6: ['belle', 'toughguy', 'gunman'],
}

// ── 아이템 설정 ─────────────────────────────────────────────

export const ITEM_CONFIGS: Record<ItemId, ItemConfig> = {
  hidden_card: {
    id: 'hidden_card',
    name: '숨기',
    count: 3,
    description: '좀비 습격 전, 내 캐릭터 1명을 이 구역 처리가 끝날 때까지 숨깁니다. 숨은 캐릭터는 방어·투표에 참여하지 않습니다.',
  },
  cctv: {
    id: 'cctv',
    name: '보안카메라',
    count: 3,
    description: '이번 라운드 주사위 결과를 보안관과 동일하게 확인할 수 있다.',
  },
  sprint: {
    id: 'sprint',
    name: '스프린트',
    count: 3,
    description: '좀비 습격 전, 내 캐릭터 1명을 다른 구역으로 이동시킨다.',
  },
  threat: {
    id: 'threat',
    name: '협박',
    count: 3,
    description: '투표 시 투표권을 1 추가한다 (1회성).',
  },
  hardware: {
    id: 'hardware',
    name: '하드웨어',
    count: 3,
    description: '좀비 습격 판정 시 사용하면 방어력을 1 증가시킨다.',
  },
  axe: {
    id: 'axe',
    name: '도끼',
    count: 1,
    zombieKill: 1,
    description: '좀비 1마리를 제거한다.',
  },
  pistol: {
    id: 'pistol',
    name: '권총',
    count: 1,
    zombieKill: 1,
    description: '좀비 1마리를 제거한다.',
  },
  shotgun: {
    id: 'shotgun',
    name: '샷건',
    count: 1,
    zombieKill: 2,
    description: '좀비 2마리를 제거한다.',
  },
  bat: {
    id: 'bat',
    name: '야구배트',
    count: 1,
    zombieKill: 1,
    description: '좀비 1마리를 제거한다.',
  },
  grenade: {
    id: 'grenade',
    name: '수류탄',
    count: 1,
    zombieKill: 2,
    description: '좀비 2마리를 제거한다.',
  },
  chainsaw: {
    id: 'chainsaw',
    name: '전기톱',
    count: 1,
    zombieKill: 2,
    description: '좀비 2마리를 제거한다.',
  },
}

// 전체 아이템 덱 크기: 5×3 + 6×1 = 21장
export const TOTAL_ITEM_COUNT = Object.values(ITEM_CONFIGS)
  .reduce((sum, cfg) => sum + cfg.count, 0)

// ── 게임 기본값 ─────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  sealTime: 60,
  votingTime: 60,
  reactionTime: 10,
  voteReactionTiming: 'before_vote' as const,
}

// 투표 재투표 최대 횟수 (2회 동률 후 전체 투표로 전환)
export const MAX_REVOTE_COUNT = 2

// 승리 조건: 전체 생존 캐릭터가 이 수 이하일 때 체크
export const WIN_CHARACTER_THRESHOLD = 4
