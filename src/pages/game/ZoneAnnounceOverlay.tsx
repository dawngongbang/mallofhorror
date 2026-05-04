import { CHARACTER_CONFIGS, EVENT_ZONE_ORDER, ZONE_CONFIGS } from '../../engine/constants'
import { calcDefense, isUnderAttack } from '../../engine/combat'
import { determineSurvivorEvent } from '../../engine/event'
import type { GameState, Player } from '../../engine/types'

interface ZoneAnnounceOverlayProps {
  game: GameState
  players: Record<string, Player>
  onShowMap: () => void
}

export default function ZoneAnnounceOverlay({ game, players, onShowMap }: ZoneAnnounceOverlayProps) {
  const zoneIdx = game.currentEventZoneIndex
  const zone = EVENT_ZONE_ORDER[zoneIdx]
  const config = ZONE_CONFIGS[zone]
  const zoneState = game.zones[zone]
  const aliveCount = zoneState.characterIds.filter(id => game.characters[id]?.isAlive).length
  const defense = calcDefense(zone, game)
  const attacked = isUnderAttack(zone, game)
  const survivorEvent = !attacked ? determineSurvivorEvent(zone, game) : null
  const deathResult = game.lastZombieAttackResult?.zone === zone ? game.lastZombieAttackResult : null

  const isBad = attacked || !!deathResult
  const isGood = !isBad && (survivorEvent === 'sheriff' || survivorEvent === 'truck_search')
  const borderCls = isBad ? 'border-red-800/70' : isGood ? 'border-blue-700/60' : 'border-yellow-700/50'
  const headerCls = isBad ? 'bg-red-950/60 border-red-900/60' : isGood ? 'bg-blue-950/50 border-blue-900/50' : 'bg-yellow-950/40 border-yellow-900/40'
  const titleCls  = isBad ? 'text-red-200' : isGood ? 'text-blue-200' : 'text-yellow-200'

  return (
    <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
      z-30 flex flex-col rounded-2xl overflow-hidden shadow-2xl
      w-[80%] bg-zinc-900/96 border ${borderCls} backdrop-blur-sm`}>
      {/* 헤더 */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${headerCls} shrink-0`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-bold truncate ${titleCls}`}>
            #{config.zoneNumber} {config.displayName}
            {zoneState.isClosed && <span className="ml-1 text-red-400">🔒</span>}
          </span>
          <span className="text-zinc-500 text-xs shrink-0">{zoneIdx + 1} / {EVENT_ZONE_ORDER.length}</span>
        </div>
        <button onClick={onShowMap}
          className="text-zinc-400 hover:text-white text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0 ml-2">
          🗺️ 맵 보기
        </button>
      </div>

      {/* 본문 */}
      <div className="px-4 py-4 text-center">
        {/* 사망 공지 */}
        {deathResult && (() => {
          const deadChar = game.characters[deathResult.deadCharacterId]
          const deadCharConf = deadChar ? CHARACTER_CONFIGS[deadChar.characterId] : null
          const deadPlayerName = players[deathResult.deadPlayerId]?.nickname ?? deathResult.deadPlayerId
          return (
            <div className="bg-red-950 border border-red-700 rounded-xl px-3 py-2 mb-4">
              <p className="text-red-300 font-bold text-sm">
                💀 {deadPlayerName}의 {deadCharConf?.name ?? '캐릭터'}가 사망하였습니다
              </p>
              <p className="text-zinc-400 text-xs mt-0.5">좀비들이 새로운 목표를 찾아 떠납니다</p>
            </div>
          )
        })()}

        {/* 수치 */}
        <div className="flex justify-center gap-5 mb-4 text-sm">
          <span className="text-zinc-300">🧟 <strong className="text-white">{zoneState.zombies}</strong></span>
          <span className="text-zinc-300">👤 <strong className="text-white">{aliveCount}</strong></span>
          {config.defenseLimit > 0 && (
            <span className="text-zinc-300">🛡 <strong className="text-white">{defense}</strong></span>
          )}
        </div>

        {/* 결과 메시지 */}
        {zoneState.isClosed ? (
          <p className="text-red-500 font-bold text-sm">🔒 폐쇄된 구역 — 이벤트 없음</p>
        ) : aliveCount === 0 ? (
          zoneState.zombies >= 8
            ? <p className="text-red-400 font-bold">🔒 좀비가 가득 찼습니다! 구역이 폐쇄됩니다.</p>
            : <p className="text-zinc-500 text-sm">{zoneState.zombies === 0 ? '사람도 좀비도 없습니다.' : '사람이 없습니다.'}</p>
        ) : zoneState.zombies === 0 ? (
          survivorEvent === 'sheriff' ? (
            <p className="text-yellow-400 font-bold text-base">👮 보안관 선출 투표를 진행합니다</p>
          ) : survivorEvent === 'truck_search' ? (
            <p className="text-blue-400 font-bold text-base">🚚 트럭 수색 투표를 진행합니다</p>
          ) : (
            <p className="text-zinc-400 text-sm">좀비 없음 — 이상 없음</p>
          )
        ) : attacked ? (
          <p className="text-red-400 font-bold text-lg">💀 좀비의 공세를 이겨내지 못하였습니다!</p>
        ) : (
          <p className="text-green-400 font-bold text-lg">🛡 좀비 방어에 성공하였습니다!</p>
        )}

        <p className="text-zinc-600 text-xs mt-4 animate-pulse">잠시 후 다음 단계로 진행됩니다...</p>
      </div>
    </div>
  )
}
