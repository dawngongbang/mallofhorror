// ============================================================
// 몰오브호러 온라인 — 게임 엔진 타입 정의
// ============================================================

// ── 구역 ────────────────────────────────────────────────────

export type ZoneName =
  | 'bathroom'     // 1. 화장실    수용3, 방어한도3
  | 'clothing'     // 2. 옷가게    수용4, 방어한도4
  | 'toy'          // 3. 장난감가게 수용4, 방어한도4
  | 'parking'      // 4. 주차장    수용무제한, 방어한도0 (항상 습격)
  | 'security'     // 5. 보안실    수용3, 방어한도3
  | 'supermarket'  // 6. 슈퍼마켓  수용6, 방어한도4

export interface ZoneConfig {
  name: ZoneName
  displayName: string
  zoneNumber: number    // 주사위 눈과 매핑 (1~6)
  maxCapacity: number   // 최대 수용 인원 (주차장은 Infinity)
  defenseLimit: number  // 방어 가능 최대 수치 (주차장은 0)
  canClose: boolean     // false = 주차장 (좀비 아무리 많아도 폐쇄 안 됨)
}

// ── 캐릭터 ──────────────────────────────────────────────────
// 3인: 미녀+터프가이+건맨+아이 / 4~6인: 미녀+터프가이+건맨

export type CharacterId = 'belle' | 'toughguy' | 'gunman' | 'kid'

export interface CharacterConfig {
  id: CharacterId
  name: string
  score: number         // 생존 시 점수 (미녀7, 터프가이5, 건맨3, 아이1)
  defense: number       // 방어력 (터프가이2, 나머지1)
  voteWeight: number    // 기본 투표권 (건맨2, 나머지1)
  isBelle: boolean      // 미녀 여부 (좀비 추가 배치 판정용)
}

// ── 캐릭터 인스턴스 (보드 위) ────────────────────────────────

export interface Character {
  id: string            // `${playerId}_${characterId}` (예: "p1_belle")
  playerId: string
  characterId: CharacterId
  zone: ZoneName
  isAlive: boolean
}

// ── 플레이어 ────────────────────────────────────────────────

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange'

export interface Player {
  id: string
  nickname: string
  color: PlayerColor
  isReady: boolean
  isConnected: boolean
  lastSeen: number
  characterIds: string[]  // 소유 캐릭터 인스턴스 ID
  itemIds: string[]       // 소유 아이템 ID
}

// ── 아이템 ──────────────────────────────────────────────────

export type ItemId =
  | 'hidden_card'    // 숨기 (x3) — weapon_use 페이즈에 캐릭터 1명 숨김
  | 'cctv'          // 보안카메라 (x3) — 주사위 결과 확인
  | 'sprint'        // 스프린트 (x3)
  | 'threat'        // 협박 (x3) — 투표권 +1 (1회성)
  | 'hardware'      // 하드웨어 (x3) — 방어력 +1
  | 'axe'           // 도끼 (x1) — 좀비 1마리 제거
  | 'pistol'        // 권총 (x1) — 좀비 1마리 제거
  | 'shotgun'       // 샷건 (x1) — 좀비 2마리 제거
  | 'bat'           // 야구배트 (x1) — 좀비 1마리 제거
  | 'grenade'       // 수류탄 (x1) — 좀비 2마리 제거
  | 'chainsaw'      // 전기톱 (x1) — 좀비 2마리 제거

export interface ItemConfig {
  id: ItemId
  name: string
  count: number         // 덱에 포함되는 장수
  zombieKill?: number   // 무기일 경우 제거 가능 좀비 수
  description: string
}

export interface Item {
  instanceId: string    // 고유 인스턴스 ID
  itemId: ItemId
}

// ── 이동 페이즈 ─────────────────────────────────────────────
// 1. character_select  — 보안관부터 순서대로 이동할 캐릭터 공개 선언
// 2. destination_seal  — 목적지 비공개 선택 (동시)
// 3. destination_reveal — 동시 공개
// 4. move_execute      — 선언 순서대로 이동 (가득 차면 주차장으로)

export interface CharacterDeclaration {
  playerId: string
  characterId: string   // 캐릭터 인스턴스 ID (모두에게 공개)
  order: number         // 선언 순서 (보안관=0)
  declaredAt: number
}

export interface SealedDestination {
  playerId: string
  targetZone: ZoneName  // 본인 + 호스트만 읽기
  submittedAt: number
}

export interface ResolvedMove {
  playerId: string
  characterId: string
  fromZone: ZoneName
  intendedZone: ZoneName    // 원래 목적지 (튕겨났을 때도 유지)
  targetZone: ZoneName      // 실제 도착지 (튕기면 parking)
  order: number
  executed: boolean
  bumpedToParking: boolean  // 목적지 가득 차서 주차장으로 튕겨남
}

// ── 좀비 ────────────────────────────────────────────────────

export interface DiceRollResult {
  dice: [number, number, number, number]
  zombiesByZone: Partial<Record<ZoneName, number>>
  // 이동 페이즈 이후에 공개됨 (진짜 보안관은 혼자 미리 확인 가능)
}

// ── 투표 ────────────────────────────────────────────────────

export type VoteType = 'zombie_attack' | 'truck_search' | 'sheriff'

export interface VoteState {
  zone: ZoneName
  type: VoteType
  round: number           // 재투표 횟수 (0=첫 투표, 1=1차 재투표, 2=전체투표)
  votes: Record<string, string>        // voterId → targetPlayerId
  status: Record<string, boolean>      // playerId → 투표 완료 여부
  eligibleVoters: string[]             // 이번 투표 참여 가능 플레이어 ID
  candidates: string[]                 // 득표 대상 플레이어 ID
  bonusVoteWeights: Record<string, number>  // playerId → 협박카드 등으로 추가된 투표권
}

export interface VoteResult {
  zone: ZoneName
  type: VoteType
  tally: Record<string, number>        // playerId → 받은 표 수
  winner: string | null                // 가장 많이 지목된 플레이어
  tieBreak: 'none' | 'revote' | 'global_vote'
  // zombie_attack: winner의 캐릭터 사망 + 구역 좀비 소멸
  // truck_search: winner가 트럭 수색 (아이템 3장 중 1장 보관, 1장 증정, 1장 반환)
  // sheriff: winner가 다음 라운드 보안관
}

// ── 게임 페이즈 ─────────────────────────────────────────────

export type GamePhase =
  | 'waiting'             // 대기실
  | 'setup_place'         // 초기 캐릭터 배치 (주사위 2개씩)
  | 'roll_dice'           // 보안관이 주사위 4개 굴림
  | 'dice_reveal'         // 주사위 결과 공개 (3초 대기, 좀비 배치 전)
  | 'character_select'    // 이동①: 캐릭터 공개 선언 (보안관부터 순서대로)
  | 'destination_seal'    // 이동②: 목적지 봉인
  | 'destination_reveal'  // 이동③: 동시 공개
  | 'move_execute'        // 이동④: 순서대로 이동
  | 'zombie_spawn'        // 좀비 순차 배치 공지
  | 'event'               // 이벤트 진입 (다음 구역으로 이동)
  | 'zone_announce'       // 구역 상황 공지 (2초 대기 후 처리)
  | 'weapon_use'          // 습격 직전 무기 사용 기회 (타이머 후 좀비 재계산)
  | 'card_react'          // 투표 전 카드 반응 창 (스프린트/히든카드)
  | 'voting'              // 투표 진행 중 (zombie_attack / truck_search / sheriff)
  | 'check_win'           // 승리 조건 체크
  | 'finished'            // 게임 종료

// ── 구역 상태 ────────────────────────────────────────────────

export interface ZoneState {
  zombies: number
  characterIds: string[]  // 이 구역의 캐릭터 인스턴스 ID 목록
  isClosed: boolean       // 폐쇄 구역 여부
}

// ── 게임 상태 ────────────────────────────────────────────────

export interface GameState {
  phase: GamePhase
  round: number
  phaseDeadline: number
  phaseStartedAt: number

  // 플레이어 순서 (게임 내내 유지, 인덱스로 보안관 결정)
  playerOrder: string[]       // playerId 배열
  sheriffIndex: number        // playerOrder에서 현재 보안관 인덱스
  isRealSheriff: boolean      // true: 진짜 보안관(주사위 비공개 가능), false: 임시 보안관(항상 공개)
  nextSheriffPlayerId: string | null  // 보안실 투표로 결정된 다음 보안관

  // 보드
  characters: Record<string, Character>   // instanceId → Character
  zones: Record<ZoneName, ZoneState>

  // 초기 배치 페이즈
  setupPlacementOrder: string[]   // 아직 배치 안 된 캐릭터 ID 목록 (순서대로)
  setupDiceRoll: [number, number] | null

  // 이동 페이즈
  characterDeclarations: Record<string, CharacterDeclaration>  // playerId → 선언
  declarationOrder: string[]       // 선언 완료 순서
  sealedDestinations: Record<string, SealedDestination>
  destinationStatus: Record<string, boolean>
  resolvedMoves: ResolvedMove[]
  currentMoveStep: number          // move_execute 페이즈에서 현재 처리 중인 이동 인덱스

  // 이벤트 페이즈
  lastDiceRoll: DiceRollResult | null
  currentEventZoneIndex: number    // 0~5, 현재 처리 중인 구역 인덱스
  currentVote: VoteState | null    // 진행 중인 투표

  // 아이템 덱
  itemDeck: Item[]                 // 남은 아이템 덱
  itemSearchPreview: string[] | null  // 트럭 수색 승자에게 보이는 아이템 3개 instanceId
  itemSearchWinnerId: string | null   // 트럭 수색 승자 (선택권 소유자)
  itemSearchChoice: {                 // 승자가 제출한 선택
    keptInstanceId: string
    givenToPlayerId?: string          // 2장 이하면 없을 수 있음
    givenInstanceId?: string
    returnedInstanceId?: string       // 3장일 때만 존재
  } | null
  playerItemCounts: Record<string, number>  // playerId → 보유 아이템 수 (공개)

  // 카드 반응 창 (voteReactionTiming 설정에 따라 활성화)
  cardReactionWindow: CardReactionWindow | null

  // 보안관 주사위 굴리기 요청 (보안관이 쓰면 호스트가 처리)
  sheriffRollRequest: number | null   // 요청 타임스탬프 (null = 요청 없음)

  // 좀비 공격 투표 패배자의 희생 캐릭터 선택 대기
  pendingVictimSelection: {
    zone: ZoneName
    loserPlayerId: string
    chosenCharacterId?: string   // 패배자가 선택 완료 시 기록
  } | null

  // 투표 결과 공지 (전원 확정 직후 N초간 표시 후 처리)
  lastVoteAnnounce: {
    votes: Record<string, string>              // voterId → targetPlayerId
    tally: Record<string, number>              // candidateId → 득표 수 (가중치 포함)
    bonusVoteWeights: Record<string, number>   // playerId → 협박카드 보너스 (>0이면 사용한 것)
  } | null

  // 가장 최근 좀비 공격 사망 결과 (zone_announce에서 공지용)
  lastZombieAttackResult: {
    zone: ZoneName
    deadCharacterId: string
    deadPlayerId: string
  } | null

  // 이번 라운드 CCTV 아이템을 사용한 플레이어 (라운드 시작 시 초기화)
  cctvViewers: string[]

  // weapon_use 페이즈: 해당 구역에서 확정 완료한 플레이어 (weapon_use 진입 시 초기화)
  weaponUseStatus: Record<string, boolean>

  // weapon_use 페이즈: 플레이어별 무기 kill 수 (확정 시 기록, 호스트가 전원 확정 후 일괄 적용)
  weaponKillChoices: Record<string, number>

  // weapon_use 페이즈: 숨기 아이템 대기 중 (playerId → charId, 전원 확정 후 호스트가 hiddenCharacters로 이동)
  // 플레이어만 + 호스트만 읽기 가능 (다른 플레이어에게 비공개)
  pendingHideChoices: Record<string, string>

  // weapon_use 종료 후 확정된 숨김 (charId → true, 해당 구역 처리 완료 시 초기화)
  // 숨은 캐릭터는 방어·투표 참여·투표 대상에서 제외되지만 구역 인원수에는 포함
  hiddenCharacters: Record<string, boolean>

  // 숨기/등장 공지 (hide: 숨은 직후, reveal: 구역 처리 완료 후 등장)
  lastHideRevealAnnounce: {
    type: 'hide' | 'reveal'
    entries: Array<{ playerId: string; charId: string; zone: ZoneName }>
  } | null

  // 보너스 좀비 결과 (이동 완료 후 결정, 다음 라운드까지 유지)
  lastBonusZombieResult: {
    belleZone: ZoneName | null         // 미녀 최다 구역 (동률이면 null)
    mostCrowdedZone: ZoneName | null   // 인원 최다 구역 (동률이면 null)
  } | null

  // 좀비 플레이어: 모든 캐릭터 사망 후 매 라운드 좀비 1마리를 원하는 구역에 배치
  // 선택은 roll_dice / dice_reveal 페이즈 중에 제출, 이동 완료 후 일반 좀비와 동시 배치
  zombiePlayerZoneChoices: Record<string, ZoneName>  // playerId → 선택 구역

  // 좀비 플레이어 배치 공지 (이동 완료 후 N초간 표시)
  lastZombiePlayerAnnounce: {
    entries: Array<{ playerId: string; zone: ZoneName }>
  } | null

  // weapon_use 페이즈: 스프린트 아이템 대기 중 (playerId → { charId, targetZone }, 전원 확정 후 호스트가 이동 적용)
  pendingSprintChoices: Record<string, { charId: string; targetZone: ZoneName }>

  // weapon_use 페이즈: 하드웨어 아이템 대기 중 (playerId → 사용 장 수)
  pendingHardwareChoices: Record<string, number>

  // 스프린트 공지 (weapon_use 종료 직후)
  lastSprintAnnounce: {
    entries: Array<{ playerId: string; charId: string; fromZone: ZoneName; toZone: ZoneName }>
  } | null

  // weapon_use 결과 공지 (아이템 사용 타임 종료 후 N초간 표시)
  lastWeaponUseAnnounce: {
    zone: ZoneName
    killsByPlayer: Record<string, number>  // playerId → kill 수 (0 제외)
    totalKill: number
    remainingZombies: number
  } | null

  // 좀비 순차 배치 공지
  zombieSpawnBatches: (
    | { type: 'dice'; zones: Partial<Record<ZoneName, number>> }
    | { type: 'crowded'; zone: ZoneName }
    | { type: 'belle'; zone: ZoneName }
    | { type: 'zombie_player'; zone: ZoneName; playerId: string }
  )[] | null
  zombieSpawnStep: number   // 현재까지 공지 완료된 배치 단계

  // 트럭 수색 완료 공지
  lastItemSearchAnnounce: {
    winnerId: string
    givenToPlayerId?: string
  } | null

  // 결과
  winners: string[]
  finalScores: Record<string, number>
}

// ── 카드 반응 창 ──────────────────────────────────────────────
// sprint / hidden_card를 사용할 수 있는 대기 창
//
// [before_vote] 투표 시작 직전 — 모든 후보 플레이어가 동시에 대기
//   카드 사용 시: 해당 플레이어가 후보에서 제외된 채 투표 진행
//   (sprint → 다른 구역으로 이동, hidden → 제자리 유지)
//
// [after_vote]  투표 결과 확정 후 — 패배자 1인만 대기
//   카드 사용 시: 사망 취소 + 재투표

export interface CardReactionWindow {
  zone: ZoneName
  timing: 'before_vote' | 'after_vote'
  deadline: number          // 타임아웃 타임스탬프

  // before_vote: 후보 플레이어 전원 대기, 사용 여부 개별 기록
  candidatePlayers: string[]              // 후보 플레이어 ID 목록
  usedCards: Record<string, 'sprint' | 'hidden_card'>  // playerId → 사용한 카드
  sprintTargets: Record<string, { characterId: string; newZone: ZoneName }>  // 스프린트 목적지
  escaped: string[]                       // 카드로 후보에서 빠진 플레이어 ID

  // after_vote: 패배자 1인만 대기
  loserPlayerId: string | null
  reactionUsed: boolean                   // 패배자가 카드 사용했는지
}

// ── 게임 설정 ────────────────────────────────────────────────

export interface GameSettings {
  playerCount: number       // 3~6
  sealTime: number          // 목적지 봉인 제한 시간 (초, 기본 60)
  votingTime: number        // 투표 제한 시간 (초, 기본 60)
  reactionTime: number      // 카드 반응 창 대기 시간 (초, 기본 10)
  parkingMode: 'normal' | 'hardcore'
  // normal:   주차장도 투표로 1명 사망
  // hardcore: 주차장에서 좀비 수만큼 사망
  voteReactionTiming: 'before_vote' | 'after_vote' | 'disabled'
  // before_vote: 투표 시작 전 도망/숨기 가능 → 후보에서 제외
  // after_vote:  투표 결과 후 카드 사용 가능 → 사망 취소 + 재투표
  // disabled:    sprint/hidden은 이동 페이즈 전용으로만 사용
}

// ── 방 메타 ──────────────────────────────────────────────────

export interface RoomMeta {
  id: string
  hostId: string
  status: 'waiting' | 'playing' | 'finished'
  createdAt: number
  updatedAt: number
  settings: GameSettings
}

// ── 채팅 ────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  playerId: string
  nickname: string
  message: string
  type: 'public' | 'system'
  timestamp: number
}

// ── 게임 방 (Firebase 루트) ───────────────────────────────────

export interface GameRoom {
  meta: RoomMeta
  players: Record<string, Player>
  game: GameState
  chat: Record<string, ChatMessage>
}

// ── 승리 조건 ────────────────────────────────────────────────
// 전체 캐릭터 4개 이하 + 주차장 제외 한 구역에 전원 집결

export type WinCheckResult =
  | { gameOver: false }
  | {
      gameOver: true
      winners: string[]                    // 최고 점수 플레이어
      finalScores: Record<string, number>  // 플레이어별 점수
    }
