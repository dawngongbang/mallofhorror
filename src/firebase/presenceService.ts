import {
  ref,
  onValue,
  onDisconnect,
  set,
  update,
  serverTimestamp,
} from 'firebase/database'
import { db } from './config'
import { getCurrentUid } from './auth'

// ── 접속 상태 관리 ────────────────────────────────────────────
// Firebase의 .info/connected를 활용해 연결 끊김을 감지
// 연결 끊기면 isConnected: false를 자동으로 기록

export function initPresence(roomCode: string): () => void {
  const uid = getCurrentUid()
  if (!uid) return () => {}

  const playerRef = ref(db, `games/${roomCode}/players/${uid}`)
  const connectedRef = ref(db, '.info/connected')

  const unsubscribe = onValue(connectedRef, snap => {
    if (!snap.val()) return

    // 연결 끊기면 자동으로 실행될 onDisconnect 설정
    onDisconnect(playerRef).update({
      isConnected: false,
      lastSeen: serverTimestamp(),
    })

    // 현재는 연결 중
    update(playerRef, {
      isConnected: true,
      lastSeen: serverTimestamp(),
    })
  })

  return unsubscribe
}

// ── 하트비트 ─────────────────────────────────────────────────
// 주기적으로 lastSeen을 갱신해 타임아웃 감지 지원

export function startHeartbeat(roomCode: string, intervalMs = 30_000): () => void {
  const uid = getCurrentUid()
  if (!uid) return () => {}

  const playerRef = ref(db, `games/${roomCode}/players/${uid}`)

  const interval = setInterval(() => {
    update(playerRef, { lastSeen: serverTimestamp() })
  }, intervalMs)

  return () => clearInterval(interval)
}

// ── 호스트 마이그레이션 ───────────────────────────────────────
// 호스트가 오프라인 상태(lastSeen이 오래됨)면 다음 플레이어가 호스트 승계

const HOST_TIMEOUT_MS = 10_000  // 10초 응답 없으면 오프라인으로 판정

export async function tryClaimHost(
  roomCode: string,
  players: Record<string, { id: string; isConnected: boolean; lastSeen: number }>,
  currentHostId: string
): Promise<boolean> {
  const uid = getCurrentUid()
  if (!uid) return false

  const host = players[currentHostId]
  const isHostDead =
    !host ||
    !host.isConnected ||
    Date.now() - host.lastSeen > HOST_TIMEOUT_MS

  if (!isHostDead) return false

  // 연결된 플레이어 중 가장 먼저 입장한 플레이어가 승계
  // (Firebase는 순서 보장이 없으므로 uid 사전순으로 결정)
  const alivePlayers = Object.values(players)
    .filter(p => p.isConnected)
    .sort((a, b) => a.id.localeCompare(b.id))

  if (alivePlayers[0]?.id !== uid) return false  // 내가 승계 대상이 아님

  // 호스트 승계
  await set(ref(db, `games/${roomCode}/meta/hostId`), uid)
  return true
}
