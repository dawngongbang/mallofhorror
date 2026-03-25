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

// ── 플레이어 행동: 목적지 봉인 ───────────────────────────────
// Security Rules: 본인 + 호스트만 읽기 가능

export async function sealDestination(
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

  // 제출 여부는 공개 (모두가 볼 수 있음)
  await Promise.all([
    set(ref(db, `games/${roomCode}/game/sealedDestinations/${uid}`), destination),
    set(ref(db, `games/${roomCode}/game/destinationStatus/${uid}`), true),
  ])
}

// ── 플레이어 행동: 투표 ───────────────────────────────────────

export async function submitVote(
  roomCode: string,
  _zone: ZoneName,
  targetPlayerId: string
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  await Promise.all([
    set(ref(db, `games/${roomCode}/game/currentVote/votes/${uid}`), targetPlayerId),
    set(ref(db, `games/${roomCode}/game/currentVote/status/${uid}`), true),
  ])
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
