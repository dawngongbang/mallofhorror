import { useEffect, useState } from 'react'
import type { ZoneName } from '../../engine/types'

// instanceId 예: "hidden_card_0", "sprint_2", "axe_0" → itemId 추출
export function instanceIdToItemId(instanceId: string): string {
  const parts = instanceId.split('_')
  parts.pop()
  return parts.join('_')
}

export const ITEM_CATEGORY: Record<string, string> = {
  axe: '🪓', pistol: '🔫', shotgun: '🔫', bat: '🏏', grenade: '💣', chainsaw: '⚙️',
  sprint: '👟', hidden_card: '🫥', threat: '😤', hardware: '🔧', cctv: '📷',
}

export const COLOR_BG: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

export const PHASE_LABEL: Record<string, string> = {
  setup_place: '초기 배치', roll_dice: '주사위', dice_reveal: '주사위 공개',
  character_select: '캐릭터 선언', destination_seal: '목적지 선택',
  destination_reveal: '공개', move_execute: '이동', zombie_spawn: '좀비 배치',
  event: '이벤트', zone_announce: '구역 공지', weapon_use: '아이템 사용', voting: '투표',
  check_win: '승리 체크', finished: '종료',
}

export const CHAR_ICON: Record<string, string> = {
  gunman:   '🔫',
  belle:    '👩',
  toughguy: '💪',
  kid:      '🍬',
}

// 맵 이미지 위 구역 오버레이 위치 (컨테이너 기준 %)
export const ZONE_MAP_POSITIONS: Record<ZoneName, { left: string; top: string; width?: string }> = {
  security:    { left: '33%', top:  '8%' },
  supermarket: { left: '67%', top: '31%' },
  bathroom:    { left: '65%', top: '73%' },
  clothing:    { left:  '5%', top: '72%' },
  toy:         { left:  '4%', top: '22%' },
  parking:     { left: '28%', top: '40%', width: '36%' },
}

// 구역 오버레이 중심 좌표 (컨테이너 기준 %)
export function getZoneCenter(zoneName: ZoneName): { x: number; y: number } {
  const pos = ZONE_MAP_POSITIONS[zoneName]
  const w = parseFloat(pos.width ?? '29')
  return {
    x: parseFloat(pos.left) + w / 2,
    y: parseFloat(pos.top) + 8,
  }
}

// 플레이어 스폰 위치 — 맵 오른쪽 가장자리
export function getPlayerSpawnPos(playerIndex: number, totalPlayers: number): { x: number; y: number } {
  const y = totalPlayers <= 1 ? 50 : 15 + (playerIndex / Math.max(1, totalPlayers - 1)) * 70
  return { x: 97, y }
}

// 손패 카드 위치 (맵 컨테이너 기준 %)
export function getHandCardPos(cardIndex: number, totalCards: number): { x: number; y: number } {
  const spacing = Math.min(22, 55 / Math.max(1, totalCards - 1))
  const x = 50 + (cardIndex - (totalCards - 1) / 2) * spacing
  return { x, y: 88 }
}

export interface MovingTokenState {
  uid: string
  playerId: string
  fromPos: { x: number; y: number }
  toZone: ZoneName
  bounceZone?: ZoneName
  label: string
}

interface MovingTokenProps {
  fromPos: { x: number; y: number }
  toZone: ZoneName
  bounceZone?: ZoneName
  color: string
  label: string
}

const COLOR_BG_TOKEN: Record<string, string> = {
  red: 'bg-red-500', blue: 'bg-blue-500', green: 'bg-green-500',
  yellow: 'bg-yellow-400', purple: 'bg-purple-500', orange: 'bg-orange-500',
}

export function MovingToken({ fromPos, toZone, bounceZone, color, label }: MovingTokenProps) {
  const [pos, setPos] = useState(fromPos)

  useEffect(() => {
    if (bounceZone) {
      const t1 = setTimeout(() => setPos(getZoneCenter(bounceZone)), 30)
      const t2 = setTimeout(() => setPos(getZoneCenter(toZone)), 900)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    } else {
      const t = setTimeout(() => setPos(getZoneCenter(toZone)), 30)
      return () => clearTimeout(t)
    }
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: 'translate(-50%, -50%)',
        transition: 'left 0.8s cubic-bezier(0.4, 0, 0.2, 1), top 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: 50,
        pointerEvents: 'none',
      }}
      className={`w-7 h-7 rounded-full border-2 border-yellow-400 shadow-xl flex items-center justify-center text-xs font-bold text-white ${COLOR_BG_TOKEN[color] ?? 'bg-zinc-600'}`}
    >
      {label}
    </div>
  )
}
