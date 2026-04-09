import { useEffect, useRef, useState } from 'react'
import { submitSheriffRollRequest, submitZombiePlayerZoneChoice } from '../../firebase/gameService'
import { ZONE_CONFIGS } from '../../engine/constants'
import type { GameState, Player, ZoneName } from '../../engine/types'

interface Props {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  roomCode: string
  actionLoading: boolean
  setActionLoading: (v: boolean) => void
  onShowMap: () => void
}

export default function DiceOverlay({
  game, players, uid, roomCode,
  actionLoading, setActionLoading, onShowMap,
}: Props) {
  const sheriffId = game.playerOrder[game.sheriffIndex]
  const isSheriff = uid === sheriffId
  const isRealSheriff = game.isRealSheriff
  const phase = game.phase

  // 주사위 애니메이션
  const [diceAnim, setDiceAnim] = useState<number[] | null>(null)
  const lastDiceKey = useRef('')

  useEffect(() => {
    if (phase !== 'dice_reveal' || !game.lastDiceRoll || !isSheriff || !isRealSheriff) return
    const key = game.lastDiceRoll.dice.join(',')
    if (lastDiceKey.current === key) return
    lastDiceKey.current = key
    const real = game.lastDiceRoll.dice
    setDiceAnim(real.map(() => Math.ceil(Math.random() * 6)))
    let count = 0
    const timer = setInterval(() => {
      count++
      if (count >= 8) { clearInterval(timer); setDiceAnim(null) }
      else setDiceAnim(real.map(() => Math.ceil(Math.random() * 6)))
    }, 120)
    return () => clearInterval(timer)
  }, [phase, game.lastDiceRoll, isSheriff, isRealSheriff])

  // 좀비 플레이어 여부
  const isZombiePlayer = uid
    ? Object.values(game.characters).filter(c => c.playerId === uid).length > 0
      && Object.values(game.characters).filter(c => c.playerId === uid).every(c => !c.isAlive)
    : false
  const myZombieChoice = uid ? (game.zombiePlayerZoneChoices ?? {})[uid] : undefined

  async function handleRollDice() {
    if (actionLoading) return
    setActionLoading(true)
    try { await submitSheriffRollRequest(roomCode) }
    finally { setActionLoading(false) }
  }

  async function handleZoneChoice(zone: ZoneName) {
    setActionLoading(true)
    try { await submitZombiePlayerZoneChoice(roomCode, zone) }
    finally { setActionLoading(false) }
  }

  const zombieZoneSelector = isZombiePlayer && (
    <div className="mt-4 border-t border-zinc-800 pt-4">
      <p className="text-red-400 text-sm font-bold mb-2 text-center">🧟 나타날 구역을 선택하세요</p>
      {myZombieChoice ? (
        <p className="text-green-400 text-sm text-center">✓ {ZONE_CONFIGS[myZombieChoice]?.displayName} 선택 완료</p>
      ) : (
        <div className="flex flex-wrap gap-2 justify-center">
          {(Object.keys(game.zones) as ZoneName[])
            .filter(z => !game.zones[z].isClosed)
            .map(z => (
              <button key={z} onClick={() => handleZoneChoice(z)} disabled={actionLoading}
                className="text-sm bg-zinc-700 hover:bg-red-800 text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {ZONE_CONFIGS[z].displayName}
              </button>
            ))}
        </div>
      )}
    </div>
  )

  // ── roll_dice 페이즈 ───────────────────────────────────────
  if (phase === 'roll_dice') {
    return (
      <Wrapper onShowMap={onShowMap} title="🎲 좀비 주사위">
        <div className="text-center">
          {isSheriff ? (
            <button onClick={handleRollDice} disabled={actionLoading}
              className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-bold px-10 py-3 rounded-xl text-base transition-colors">
              {actionLoading ? '굴리는 중...' : '🎲 굴리기'}
            </button>
          ) : (
            <p className="text-zinc-400 text-sm py-2">
              보안관 <span className="text-white font-bold">{players[sheriffId]?.nickname}</span>이 주사위를 굴리는 중...
            </p>
          )}
          {zombieZoneSelector}
        </div>
      </Wrapper>
    )
  }

  // ── dice_reveal 페이즈 ─────────────────────────────────────
  const roll = game.lastDiceRoll

  if (!isSheriff || !isRealSheriff) {
    return (
      <Wrapper onShowMap={onShowMap} title="🎲 주사위 결과 확인 중">
        <div className="text-center">
          <p className="text-zinc-400 text-sm py-2">
            보안관이 주사위 결과를 확인 중...
          </p>
          {/* 사망자는 좀비 배치 위치 미리 확인 */}
          {isZombiePlayer && roll && (
            <div className="mt-2 mb-2">
              <p className="text-red-400 text-xs font-bold mb-2">🧟 이번 라운드 좀비 배치</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {Object.entries(roll.zombiesByZone).map(([zone, count]) => (
                  <span key={zone} className="bg-zinc-800 px-2 py-1 rounded-lg text-xs">
                    <span className="text-yellow-400">{ZONE_CONFIGS[zone as ZoneName]?.displayName}</span>
                    <span className="text-red-400 ml-1">+{count}🧟</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="text-zinc-600 text-xs mt-2">잠시 후 이동 페이즈가 시작됩니다</p>
          {zombieZoneSelector}
        </div>
      </Wrapper>
    )
  }

  if (!roll) {
    return (
      <Wrapper onShowMap={onShowMap} title="🎲 주사위 결과">
        <p className="text-zinc-400 text-sm text-center animate-pulse">로딩 중...</p>
      </Wrapper>
    )
  }

  return (
    <Wrapper onShowMap={onShowMap} title="🎲 주사위 결과 (보안관만 확인 가능)">
      <div className="text-center">
        {/* 주사위 애니메이션 — 애니 전/중에는 랜덤값, 완료 후에는 실제 결과 */}
        <div className="flex justify-center gap-2 mb-4">
          {(() => {
            const isPreAnim = lastDiceKey.current !== roll.dice.join(',')
            const displayDice = diceAnim ?? (isPreAnim
              ? roll.dice.map(() => Math.ceil(Math.random() * 6))
              : roll.dice)
            return displayDice.map((d, i) => (
              <div key={`${i}-${d}`} className="dice-roll w-12 h-12 bg-zinc-700 rounded-xl flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                {d}
              </div>
            ))
          })()}
        </div>
        {/* 구역별 좀비 배치 — 애니메이션 완료 후에만 표시 */}
        {!diceAnim && lastDiceKey.current === roll.dice.join(',') && (
          <>
            <div className="flex flex-wrap justify-center gap-2 mb-3">
              {Object.entries(roll.zombiesByZone).map(([zone, count]) => (
                <span key={zone} className="bg-zinc-800 px-3 py-1.5 rounded-lg text-sm">
                  <span className="text-yellow-400">{ZONE_CONFIGS[zone as ZoneName]?.displayName}</span>
                  <span className="text-red-400 ml-1.5">+{count}🧟</span>
                </span>
              ))}
            </div>
            <p className="text-zinc-500 text-xs">보너스 좀비(사람/미녀 최다)는 이동 완료 후 결정됩니다</p>
            <p className="text-zinc-600 text-xs mt-2">잠시 후 이동 페이즈가 시작됩니다...</p>
          </>
        )}
        {zombieZoneSelector}
      </div>
    </Wrapper>
  )
}

function Wrapper({ children, onShowMap, title }: {
  children: React.ReactNode
  onShowMap: () => void
  title: string
}) {
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
      z-30 flex flex-col rounded-2xl overflow-hidden shadow-2xl
      w-[80%] max-h-[80%]
      bg-zinc-900/96 border border-zinc-700 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-white text-sm font-bold truncate">{title}</span>
        <button onClick={onShowMap}
          className="text-zinc-400 hover:text-white text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0 ml-2">
          🗺️ 맵 보기
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {children}
      </div>
    </div>
  )
}
