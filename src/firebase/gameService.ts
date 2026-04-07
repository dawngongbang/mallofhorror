import {
  ref,
  set,
  update,
  get,
  onValue,
  off,
} from 'firebase/database'
import { db } from './config'
import { getCurrentUid } from './auth'
import type {
  GameState,
  Player,
  ZoneName,
  SealedDestination,
  CharacterDeclaration,
} from '../engine/types'

// ── 게임 상태 전체 쓰기 (호스트 전용) ────────────────────────

export async function writeGameState(
  roomCode: string,
  state: GameState
): Promise<void> {
  await set(ref(db, `games/${roomCode}/game`), state)
}

// ── 게임 상태 구독 ────────────────────────────────────────────

export function subscribeToGame(
  roomCode: string,
  callback: (state: GameState | null) => void
): () => void {
  const gameRef = ref(db, `games/${roomCode}/game`)
  onValue(gameRef, snap => callback(snap.exists() ? snap.val() : null))
  return () => off(gameRef)
}

// ── 플레이어 행동: 이동 캐릭터 선언 ──────────────────────────

export async function declareCharacter(
  roomCode: string,
  declaration: CharacterDeclaration
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  await set(
    ref(db, `games/${roomCode}/game/characterDeclarations/${uid}`),
    declaration
  )
}

// ── 플레이어 행동: 목적지 선택 / 확정 ──────────────────────────
// Security Rules: sealedDestinations는 본인 + 호스트만 읽기 가능

// 임시 선택 — 확정 전까지 변경 가능
export async function selectDestination(
  roomCode: string,
  targetZone: ZoneName
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return
  const destination: SealedDestination = {
    playerId: uid,
    targetZone,
    submittedAt: Date.now(),
  }
  await set(ref(db, `games/${roomCode}/game/sealedDestinations/${uid}`), destination)
}

// 확정 — 이후 변경 불가
export async function confirmDestination(roomCode: string): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return
  await set(ref(db, `games/${roomCode}/game/destinationStatus/${uid}`), true)
}

// ── 플레이어 행동: 투표 선택 / 확정 ──────────────────────────

// 임시 투표 — 확정 전까지 변경 가능
export async function selectVote(
  roomCode: string,
  targetPlayerId: string
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return
  await set(ref(db, `games/${roomCode}/game/currentVote/votes/${uid}`), targetPlayerId)
}

// 투표 확정 — 이후 변경 불가
export async function confirmVote(roomCode: string): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return
  await set(ref(db, `games/${roomCode}/game/currentVote/status/${uid}`), true)
}

// ── 플레이어 행동: 아이템 사용 ───────────────────────────────

export async function useItemAction(
  roomCode: string,
  action: ItemAction
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  // 아이템 사용 액션을 Firebase에 기록 → 호스트가 감지 후 처리
  await set(ref(db, `games/${roomCode}/game/pendingItemActions/${uid}`), {
    ...action,
    playerId: uid,
    timestamp: Date.now(),
  })
}

export type ItemAction =
  | { type: 'weapon';         zone: ZoneName; itemInstanceId: string }
  | { type: 'threat';         itemInstanceId: string }
  | { type: 'hardware';       itemInstanceId: string }
  | { type: 'sprint_move';    itemInstanceId: string; newTargetZone: ZoneName }
  | { type: 'hidden_move';    itemInstanceId: string }
  | { type: 'sprint_react';   itemInstanceId: string; characterId: string; newZone: ZoneName }
  | { type: 'hidden_react';   itemInstanceId: string }

// ── 플레이어 아이템 인벤토리 ──────────────────────────────────
// /private/{playerId}/items — 본인 + 호스트만 읽기 가능

export async function writePrivateItems(
  roomCode: string,
  playerId: string,
  itemIds: string[]
): Promise<void> {
  await set(ref(db, `games/${roomCode}/private/${playerId}/items`), itemIds)
}

export async function getPrivateItems(
  roomCode: string,
  playerId: string
): Promise<string[]> {
  const snap = await get(ref(db, `games/${roomCode}/private/${playerId}/items`))
  const val = snap.val()
  if (!val) return []
  return Array.isArray(val) ? val : Object.values(val) as string[]
}

export function subscribeToMyItems(
  roomCode: string,
  playerId: string,
  callback: (itemIds: string[]) => void
): () => void {
  const itemsRef = ref(db, `games/${roomCode}/private/${playerId}/items`)
  onValue(itemsRef, snap => callback(snap.val() ?? []))
  return () => off(itemsRef)
}

// ── 플레이어 행동: 트럭 수색 아이템 선택 제출 ────────────────

export async function submitItemSearchChoice(
  roomCode: string,
  keptInstanceId: string,
  givenToPlayerId?: string,
  givenInstanceId?: string,
  returnedInstanceId?: string
): Promise<void> {
  await set(ref(db, `games/${roomCode}/game/itemSearchChoice`), {
    keptInstanceId,
    ...(givenToPlayerId && { givenToPlayerId }),
    ...(givenInstanceId && { givenInstanceId }),
    ...(returnedInstanceId && { returnedInstanceId }),
  })
}

// ── 패배자 행동: 희생 캐릭터 선택 ───────────────────────────
// pendingVictimSelection.loserPlayerId 만 쓸 수 있음 (Firebase 규칙)

export async function submitVictimChoice(
  roomCode: string,
  characterId: string
): Promise<void> {
  await set(ref(db, `games/${roomCode}/game/pendingVictimSelection/chosenCharacterId`), characterId)
}

// ── 플레이어 행동: 무기 아이템 사용 (weapon_use 페이즈) ───────
// 해당 구역 좀비 수 감소, private items에서 제거, weaponUseStatus 확정

// ── 플레이어 행동: weapon_use 확정 ───────────────────────────
// 선택한 무기 목록과 총 kill 수를 기록 + 확정 상태 세팅
// 좀비 실제 감소는 호스트가 전원 확정 후 일괄 적용

export async function submitWeaponConfirm(
  roomCode: string,
  stagedInstanceIds: string[],  // 사용하기로 선택한 무기 instanceId 목록
  totalKill: number,            // 총 좀비 kill 수
  currentItemIds: string[],
  hideCharId?: string | null,
  sprintChoice?: { charId: string; targetZone: ZoneName } | null,
  hardwareCount?: number
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  // 사용한 아이템을 인벤토리에서 제거 (무기 + 숨기 + 스프린트 + 하드웨어 포함)
  const allUsed = [...stagedInstanceIds]
  const newItems = currentItemIds.filter(id => !allUsed.includes(id))

  const gameSnap = await get(ref(db, `games/${roomCode}/game/playerItemCounts/${uid}`))
  const prevCount: number = gameSnap.val() ?? allUsed.length
  const newCount = Math.max(0, prevCount - allUsed.length)

  const gamePatch: Record<string, unknown> = {
    [`weaponKillChoices/${uid}`]: totalKill,
    [`playerItemCounts/${uid}`]: newCount,
    [`weaponUseStatus/${uid}`]: true,
  }
  if (hideCharId) gamePatch[`pendingHideChoices/${uid}`] = hideCharId
  if (sprintChoice) gamePatch[`pendingSprintChoices/${uid}`] = sprintChoice
  if (hardwareCount) gamePatch[`pendingHardwareChoices/${uid}`] = hardwareCount

  await Promise.all([
    set(ref(db, `games/${roomCode}/private/${uid}/items`), newItems),
    update(ref(db, `games/${roomCode}/game`), gamePatch),
  ])
}

// ── 플레이어 행동: weapon_use 패스 (무기 없이 확정) ─────────────

export async function submitWeaponUsePass(
  roomCode: string,
  hideCharId?: string | null  // 숨기 아이템 선택 시
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return
  const patch: Record<string, unknown> = {
    [`weaponKillChoices/${uid}`]: 0,
    [`weaponUseStatus/${uid}`]: true,
  }
  // hiddenCharacters는 $other(호스트 전용) 규칙에 걸리므로 pendingHideChoices에 기록 후 호스트가 처리
  if (hideCharId) patch[`pendingHideChoices/${uid}`] = hideCharId
  await update(ref(db, `games/${roomCode}/game`), patch)
}

// ── 플레이어 행동: 협박 아이템 사용 (투표 중) ────────────────
// 현재 투표의 bonusVoteWeights에 +1, private items에서 제거

export async function useThreatItem(
  roomCode: string,
  itemInstanceId: string,
  currentItemIds: string[]
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  const newItems = [...currentItemIds]
  const idx = newItems.indexOf(itemInstanceId)
  if (idx === -1) return
  newItems.splice(idx, 1)

  const gameRef = ref(db, `games/${roomCode}/game`)
  const snap = await get(gameRef)
  const g = snap.val() as GameState | null
  if (!g) return

  const prev = g.currentVote?.bonusVoteWeights?.[uid] ?? 0
  const newCount = Math.max(0, (g.playerItemCounts?.[uid] ?? 1) - 1)

  await Promise.all([
    set(ref(db, `games/${roomCode}/private/${uid}/items`), newItems),
    update(ref(db, `games/${roomCode}/game`), {
      [`currentVote/bonusVoteWeights/${uid}`]: prev + 1,
      [`playerItemCounts/${uid}`]: newCount,
    }),
  ])
}

// ── 플레이어 행동: CCTV 아이템 사용 ─────────────────────────
// 아무때나 사용 가능. 사용 시 이번 라운드 동안 보안관과 동일한 주사위 정보 공개

export async function useCctvItem(
  roomCode: string,
  itemInstanceId: string,
  currentItemIds: string[]
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  // private items에서 해당 아이템 제거
  const newItems = [...currentItemIds]
  const idx = newItems.indexOf(itemInstanceId)
  if (idx === -1) return
  newItems.splice(idx, 1)

  // 병렬: private items 갱신 + game state에 uid 추가 + 아이템 카운트 감소
  const gameRef = ref(db, `games/${roomCode}/game`)
  const snap = await get(gameRef)
  const g = snap.val() as GameState | null
  if (!g) return

  const newViewers = Array.isArray(g.cctvViewers) ? [...g.cctvViewers, uid] : [uid]
  const newCount = Math.max(0, (g.playerItemCounts?.[uid] ?? 1) - 1)

  await Promise.all([
    set(ref(db, `games/${roomCode}/private/${uid}/items`), newItems),
    update(ref(db, `games/${roomCode}/game`), {
      cctvViewers: newViewers,
      [`playerItemCounts/${uid}`]: newCount,
    }),
  ])
}

// ── 보안관 행동: 주사위 굴리기 요청 ──────────────────────────
// 보안관(임시/정식)이 roll_dice 단계에서 호출 → 호스트가 감지 후 실제 굴리기 처리

export async function submitSheriffRollRequest(roomCode: string): Promise<void> {
  await set(ref(db, `games/${roomCode}/game/sheriffRollRequest`), Date.now())
}

// ── 좀비 플레이어: 구역 선택 제출 (roll_dice / dice_reveal 중) ──
export async function submitZombiePlayerZoneChoice(roomCode: string, zone: ZoneName): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return
  await update(ref(db, `games/${roomCode}/game`), { [`zombiePlayerZoneChoices/${uid}`]: zone })
}

// ── 호스트 전용: 게임 상태 부분 업데이트 ─────────────────────

export async function patchGameState(
  roomCode: string,
  patch: Partial<GameState>
): Promise<void> {
  await update(ref(db, `games/${roomCode}/game`), patch)
}

// ── 호스트 전용: pendingItemActions 초기화 ────────────────────

export async function clearPendingItemActions(roomCode: string): Promise<void> {
  await set(ref(db, `games/${roomCode}/game/pendingItemActions`), null)
}

// ── 채팅 ─────────────────────────────────────────────────────

export async function sendChatMessage(
  roomCode: string,
  message: string,
  type: 'public' | 'system' = 'public'
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  const playerSnap = await get(ref(db, `games/${roomCode}/players/${uid}`))
  const player = playerSnap.val() as Player | null

  const msgId = `${Date.now()}_${uid}`
  await set(ref(db, `games/${roomCode}/chat/${msgId}`), {
    id: msgId,
    playerId: uid,
    nickname: player?.nickname ?? '?',
    message,
    type,
    timestamp: Date.now(),
  })
}

export function subscribeToChat(
  roomCode: string,
  callback: (messages: Record<string, unknown>) => void
): () => void {
  const chatRef = ref(db, `games/${roomCode}/chat`)
  onValue(chatRef, snap => callback(snap.val() ?? {}))
  return () => off(chatRef)
}
