import { useState } from 'react'
import { submitItemSearchChoice } from '../../firebase/gameService'
import { ITEM_CONFIGS } from '../../engine/constants'
import type { GameState, Player } from '../../engine/types'
import { instanceIdToItemId, ITEM_CATEGORY } from './constants'

interface Props {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  roomCode: string
  actionLoading: boolean
  setActionLoading: (v: boolean) => void
  onShowMap: () => void
}

export default function TruckSearchOverlay({
  game, players, uid, roomCode,
  actionLoading, setActionLoading, onShowMap,
}: Props) {
  const [truckKept, setTruckKept] = useState<string | null>(null)
  const [truckGiven, setTruckGiven] = useState<string | null>(null)
  const [truckGivenTo, setTruckGivenTo] = useState<string | null>(null)

  const preview = game.itemSearchPreview
  const winnerId = game.itemSearchWinnerId

  if (!preview || !winnerId) {
    return (
      <Wrapper onShowMap={onShowMap} title="🚚 트럭 수색">
        <p className="text-zinc-500 text-center text-sm animate-pulse">이벤트 처리 중...</p>
      </Wrapper>
    )
  }

  const isWinner = uid === winnerId
  const winnerName = players[winnerId]?.nickname ?? '?'

  if (!isWinner) {
    return (
      <Wrapper onShowMap={onShowMap} title="🚚 트럭 수색">
        <div className="text-center py-4">
          <p className="text-zinc-300 text-sm">
            <span className="font-bold text-white">{winnerName}</span>님이 트럭을 수색 중입니다...
          </p>
          <p className="text-zinc-600 text-xs mt-2 animate-pulse">아이템 선택 대기 중</p>
        </div>
      </Wrapper>
    )
  }

  const drawCount = preview.length
  const aliveOtherPlayers = game.playerOrder.filter(id =>
    id !== uid && Object.values(game.characters).some(c => c.playerId === id && c.isAlive)
  )
  const hasNoOtherPlayers = aliveOtherPlayers.length === 0
  const truckReturned = drawCount === 3
    ? preview.find(id => id !== truckKept && id !== truckGiven) ?? null
    : null
  const canSubmit = drawCount === 1
    ? true
    : hasNoOtherPlayers
      ? truckKept !== null
      : truckKept !== null && truckGiven !== null && truckGivenTo !== null && truckKept !== truckGiven

  const subtitle = drawCount === 1
    ? '트럭에 1장만 남았습니다 — 자동 획득'
    : hasNoOtherPlayers
      ? `1장 보관 · 나머지 ${drawCount - 1}장 반환 (증정할 플레이어 없음)`
      : drawCount === 2
        ? '1장 보관 · 1장 증정'
        : '1장 보관 · 1장 증정 · 1장 반환'

  async function handleSubmit() {
    if (!canSubmit || !preview) return
    const kept = drawCount === 1 ? preview[0] : truckKept
    if (!kept) return
    setActionLoading(true)
    try {
      if (drawCount === 1) {
        await submitItemSearchChoice(roomCode, kept)
      } else if (hasNoOtherPlayers) {
        const nonKept = preview.filter(id => id !== kept)
        await submitItemSearchChoice(roomCode, kept, undefined, nonKept[0], nonKept[1])
      } else if (drawCount === 2 && truckGiven && truckGivenTo) {
        await submitItemSearchChoice(roomCode, kept, truckGivenTo, truckGiven)
      } else if (drawCount === 3 && truckGiven && truckGivenTo && truckReturned) {
        await submitItemSearchChoice(roomCode, kept, truckGivenTo, truckGiven, truckReturned)
      }
      setTruckKept(null); setTruckGiven(null); setTruckGivenTo(null)
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <Wrapper onShowMap={onShowMap} title="🚚 트럭 수색 — 아이템 선택">
      <p className="text-zinc-400 text-xs mb-4 text-center">{subtitle}</p>

      {/* 아이템 1장: 자동 획득 표시 */}
      {drawCount === 1 && (() => {
        const instanceId = preview[0]
        const itemId = instanceIdToItemId(instanceId)
        const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
        return (
          <div className="bg-green-900/40 border border-green-600 rounded-xl p-4 mb-6 flex items-center gap-3">
            <span className="text-3xl">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
            <div>
              <p className="text-white text-sm font-bold">{cfg?.name ?? itemId}</p>
              <p className="text-zinc-400 text-xs mt-0.5">{cfg?.description ?? ''}</p>
            </div>
          </div>
        )
      })()}

      {/* 아이템 2~3장: 선택 UI */}
      {drawCount >= 2 && (
        <div className="flex flex-col gap-2 mb-4">
          {preview.map(instanceId => {
            const itemId = instanceIdToItemId(instanceId)
            const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
            const isKept = truckKept === instanceId
            const isGiven = truckGiven === instanceId
            const isReturned = drawCount === 3 && !isKept && !isGiven
            return (
              <div key={instanceId} className={`rounded-xl p-3 border transition-colors ${
                isKept ? 'bg-green-900/50 border-green-500' :
                isGiven ? 'bg-blue-900/50 border-blue-500' :
                'bg-zinc-800 border-zinc-700'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{cfg?.name ?? itemId}</p>
                    <p className="text-zinc-400 text-xs leading-snug">{cfg?.description ?? ''}</p>
                  </div>
                  {isReturned && <span className="text-xs text-zinc-500 shrink-0">반환 예정</span>}
                  {!isReturned && hasNoOtherPlayers && !isKept && (
                    <span className="text-xs text-zinc-500 shrink-0">반환 예정</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setTruckKept(instanceId); if (truckGiven === instanceId) setTruckGiven(null) }}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      isKept ? 'bg-green-600 text-white font-medium' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                    }`}>
                    보관
                  </button>
                  {!hasNoOtherPlayers && (
                    <button
                      onClick={() => { setTruckGiven(instanceId); if (truckKept === instanceId) setTruckKept(null) }}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        isGiven ? 'bg-blue-600 text-white font-medium' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                      }`}>
                      증정
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 증정 대상 선택 */}
      {drawCount >= 2 && truckGiven && !hasNoOtherPlayers && (
        <div className="mb-4">
          <p className="text-zinc-400 text-xs mb-2">증정할 플레이어 선택</p>
          <div className="flex flex-wrap gap-2">
            {aliveOtherPlayers.map(pid => (
              <button key={pid}
                onClick={() => setTruckGivenTo(pid)}
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  truckGivenTo === pid
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                }`}>
                {players[pid]?.nickname ?? pid}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || actionLoading}
        className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
        {actionLoading ? '처리 중...' : drawCount === 1 ? '획득' : '확정'}
      </button>
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
      bg-zinc-900/96 border border-yellow-700/70 backdrop-blur-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-white text-sm font-bold truncate">{title}</span>
        <button onClick={onShowMap}
          className="text-zinc-400 hover:text-white text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0 ml-2">
          🗺️ 맵 보기
        </button>
      </div>
      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {children}
      </div>
    </div>
  )
}
