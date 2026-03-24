import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from './config'

// 익명 로그인 — 앱 시작 시 1회 호출
export async function signInAsGuest(): Promise<User> {
  const existing = auth.currentUser
  if (existing) return existing

  const { user } = await signInAnonymously(auth)
  return user
}

// 현재 로그인된 유저 ID (uid)
export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null
}

// 인증 상태 변화 구독
export function onAuthReady(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback)
}
