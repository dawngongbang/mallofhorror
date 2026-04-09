import { useEffect, useRef, useState } from 'react'
import { patchGameState } from '../../firebase/gameService'
import { rollAndGetPlacementOptions } from '../../engine/setup'
import { ZONE_CONFIGS, CHARACTER_CONFIGS, DICE_TO_ZONE } from '../../engine/constants'
import { isZoneFull } from '../../engine/dice'
import type { GameState, Player, ZoneName } from '../../engine/types'

interface Props {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  roomCode: string
  actionLoading: boolean
  setActionLoading: (v: boolean) => void
  selectedSetupCharId: string | null
  onShowMap: () => void
}

export default function SetupOverlay({
  game, players, uid, roomCode,
  actionLoading, setActionLoading,
  selectedSetupCharId, onShowMap,
}: Props) {
  const currentSetupPlayerId = game.setupPlacementOrder[0] ?? null
  const isMyTurn = currentSetupPlayerId === uid

  // 주사위 애니메이션
  // 마운트 시 현재 주사위값으로 초기화해 재오픈 시 애니메이션 재실행 방지
  const [diceAnim, setDiceAnim] = useState<[number, number] | null>(null)
  const lastDiceKey = useRef(
    isMyTurn && game.setupDiceRoll
      ? (game.setupDiceRoll as [number, number]).join(',')
      : ''
  )

  useEffect(() => {
    if (!game.setupDiceRoll || !isMyTurn) return
    const d = game.setupDiceRoll as [number, number]
    const key = d.join(',')
    if (lastDiceKey.current === key) return
    lastDiceKey.current = key
    let tick = 0
    setDiceAnim([Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)])
    const timer = setInterval(() => {
      tick++
      if (tick >= 12) { clearInterval(timer); setDiceAnim(null) }
      else setDiceAnim([Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)])
    }, 80)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.setupDiceRoll, isMyTurn])

  // 주사위 결과로 선택 가능한 구역 계산
  const setupZoneOptions: ZoneName[] = (() => {
    if (!game.setupDiceRoll) return []
    const d = game.setupDiceRoll as [number, number]
    const z1 = DICE_TO_ZONE[d[0]], z2 = DICE_TO_ZONE[d[1]]
    const candidates = z1 === z2 ? [z1] : [z1, z2]
    const available = candidates.filter(z => !isZoneFull(z, game) && !game.zones[z].isClosed)
    return available.length > 0 ? available : ['parking' as ZoneName]
  })()

  async function handleRollSetup() {
    if (actionLoading) return
    setActionLoading(true)
    try {
      const { state: next } = rollAndGetPlacementOptions(game)
      await patchGameState(roomCode, { setupDiceRoll: next.setupDiceRoll })
    } finally { setActionLoading(false) }
  }

  const currentOwner = currentSetupPlayerId ? players[currentSetupPlayerId] : null

  // ── 내 차례 아님 ──────────────────────────────────────────
  if (!isMyTurn) {
    const d = game.setupDiceRoll as [number, number] | null
    return (
      <Wrapper onShowMap={onShowMap} title="🎲 초기 캐릭터 배치">
        <div className="text-center">
          <p className="text-zinc-400 text-sm mb-3">
            <span className="text-white font-bold">{currentOwner?.nickname ?? '?'}</span>님이 캐릭터 배치 중...
          </p>
          {d && (
            <div className="mb-3">
              <div className="flex justify-center gap-2 mb-2">
                {d.map((v, i) => (
                  <div key={i} className="w-10 h-10 bg-zinc-700 rounded-xl flex items-center justify-center text-xl font-bold text-white">{v}</div>
                ))}
              </div>
              <p className="text-yellow-400 text-xs font-semibold">
                → {setupZoneOptions.map(z => ZONE_CONFIGS[z].displayName).join(' 또는 ')}
              </p>
            </div>
          )}
          <p className="text-zinc-600 text-xs">남은 배치: {game.setupPlacementOrder.length}번</p>
        </div>
      </Wrapper>
    )
  }

  // ── 내 차례, 주사위 아직 안 굴림 ─────────────────────────
  if (!game.setupDiceRoll) {
    return (
      <Wrapper onShowMap={onShowMap} title="🎲 초기 캐릭터 배치 — 내 차례">
        <div className="text-center">
          <p className="text-zinc-300 text-sm mb-4">주사위를 굴려 배치 구역을 결정하세요</p>
          <button onClick={handleRollSetup} disabled={actionLoading}
            className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-bold px-10 py-3 rounded-xl text-base transition-colors">
            {actionLoading ? '굴리는 중...' : '🎲 굴리기'}
          </button>
        </div>
      </Wrapper>
    )
  }

  // ── 내 차례, 주사위 결과 나옴 → 배치 안내 ─────────────────
  const d = game.setupDiceRoll as [number, number]
  const displayD = diceAnim ?? d
  const showResult = !diceAnim && lastDiceKey.current === d.join(',')

  const charName = selectedSetupCharId
    ? CHARACTER_CONFIGS[game.characters[selectedSetupCharId]?.characterId]?.name
    : null

  return (
    <Wrapper onShowMap={onShowMap} title="🎲 초기 캐릭터 배치 — 내 차례">
      <div className="text-center">
        {/* 주사위 표시 */}
        <div className="flex justify-center gap-3 mb-3">
          {(displayD as [number, number]).map((v, i) => (
            <div key={`${i}-${v}`} className="dice-roll w-12 h-12 bg-zinc-700 rounded-xl flex items-center justify-center text-2xl font-bold text-white shadow-lg">{v}</div>
          ))}
        </div>
        {showResult && (
          <>
            <p className="text-yellow-400 text-base font-bold mb-2">
              → {setupZoneOptions.map(z => ZONE_CONFIGS[z].displayName).join(' 또는 ')}
            </p>
            <p className="text-zinc-400 text-sm mb-5">
              {charName
                ? <><span className="text-white font-bold">{charName}</span> 선택됨 — 맵에서 구역을 클릭하세요</>
                : '맵 하단 카드에서 캐릭터를 선택 후 구역을 클릭하세요'}
            </p>
            <button
              onClick={onShowMap}
              className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
              확인
            </button>
          </>
        )}
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
