import {
  ref,
  set,
  get,
  update,
  onValue,
  off,
  serverTimestamp,
} from 'firebase/database'
import { db } from './config'
import { getCurrentUid } from './auth'
import type { RoomMeta, Player, GameSettings, PlayerColor } from '../engine/types'
import { DEFAULT_SETTINGS } from '../engine/constants'

// ── 방 코드 생성 ──────────────────────────────────────────────

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // 헷갈리는 문자 제외
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// ── 방 생성 ───────────────────────────────────────────────────

export async function createRoom(
  nickname: string,
  color: PlayerColor,
  settings: Partial<GameSettings> = {}
): Promise<string> {
  const uid = getCurrentUid()
  if (!uid) throw new Error('로그인이 필요합니다.')

  const roomCode = generateRoomCode()
  const now = Date.now()

  const mergedSettings: GameSettings = {
    playerCount: settings.playerCount ?? 4,
    sealTime: settings.sealTime ?? DEFAULT_SETTINGS.sealTime,
    votingTime: settings.votingTime ?? DEFAULT_SETTINGS.votingTime,
    reactionTime: settings.reactionTime ?? DEFAULT_SETTINGS.reactionTime,
    parkingMode: settings.parkingMode ?? DEFAULT_SETTINGS.parkingMode,
    voteReactionTiming: settings.voteReactionTiming ?? DEFAULT_SETTINGS.voteReactionTiming,
  }

  const meta: RoomMeta = {
    id: roomCode,
    hostId: uid,
    status: 'waiting',
    createdAt: now,
    updatedAt: now,
    settings: mergedSettings,
  }

  const player: Player = {
    id: uid,
    nickname,
    color,
    isReady: false,
    isConnected: true,
    lastSeen: now,
    characterIds: [],
    itemIds: [],
  }

  // 각 경로에 개별 쓰기 (Security Rules가 meta/players 각각에 적용됨)
  await Promise.all([
    set(ref(db, `games/${roomCode}/meta`), meta),
    set(ref(db, `games/${roomCode}/players/${uid}`), player),
  ])

  return roomCode
}

// ── 방 입장 ───────────────────────────────────────────────────

export async function joinRoom(
  roomCode: string,
  nickname: string,
  color: PlayerColor
): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) throw new Error('로그인이 필요합니다.')

  const metaSnap = await get(ref(db, `games/${roomCode}/meta`))
  if (!metaSnap.exists()) throw new Error('존재하지 않는 방입니다.')

  const meta = metaSnap.val() as RoomMeta
  if (meta.status !== 'waiting') throw new Error('이미 시작된 게임입니다.')

  const playersSnap = await get(ref(db, `games/${roomCode}/players`))
  const players = playersSnap.val() as Record<string, Player> | null
  const playerCount = players ? Object.keys(players).length : 0

  if (playerCount >= meta.settings.playerCount) throw new Error('방이 가득 찼습니다.')

  // 색상 중복 체크
  if (players) {
    const usedColors = Object.values(players).map(p => p.color)
    if (usedColors.includes(color)) throw new Error('이미 사용 중인 색상입니다.')
  }

  const player: Player = {
    id: uid,
    nickname,
    color,
    isReady: false,
    isConnected: true,
    lastSeen: Date.now(),
    characterIds: [],
    itemIds: [],
  }

  await set(ref(db, `games/${roomCode}/players/${uid}`), player)
}

// ── 준비 상태 토글 ────────────────────────────────────────────

export async function setReady(roomCode: string, isReady: boolean): Promise<void> {
  const uid = getCurrentUid()
  if (!uid) return

  await update(ref(db, `games/${roomCode}/players/${uid}`), { isReady })
}

// ── 방 구독 ───────────────────────────────────────────────────

export function subscribeToMeta(
  roomCode: string,
  callback: (meta: RoomMeta | null) => void
): () => void {
  const metaRef = ref(db, `games/${roomCode}/meta`)
  onValue(metaRef, snap => callback(snap.exists() ? snap.val() : null))
  return () => off(metaRef)
}

export function subscribeToPlayers(
  roomCode: string,
  callback: (players: Record<string, Player>) => void
): () => void {
  const playersRef = ref(db, `games/${roomCode}/players`)
  onValue(playersRef, snap => callback(snap.val() ?? {}))
  return () => off(playersRef)
}

// ── 호스트 전용: 게임 시작 ────────────────────────────────────

export async function updateRoomStatus(
  roomCode: string,
  status: RoomMeta['status']
): Promise<void> {
  await update(ref(db, `games/${roomCode}/meta`), {
    status,
    updatedAt: serverTimestamp(),
  })
}
