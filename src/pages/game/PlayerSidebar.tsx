import type { GameState, Player } from '../../engine/types'
import { COLOR_BG } from './constants'
import { CHARACTER_CONFIGS, ZONE_CONFIGS } from '../../engine/constants'

interface PlayerSidebarProps {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  sheriffId: string
}

export default function PlayerSidebar({ game, players, uid, sheriffId }: PlayerSidebarProps) {
  return (
    <div className="hidden md:block w-44 bg-zinc-900 border-l border-zinc-800 p-3 overflow-y-auto shrink-0">
      <p className="text-xs text-zinc-500 mb-3">플레이어</p>
      <div className="space-y-2">
        {[...game.playerOrder.slice(game.sheriffIndex), ...game.playerOrder.slice(0, game.sheriffIndex)].map(playerId => {
          const player = players[playerId]
          const isSheriff = playerId === sheriffId
          const aliveChars = Object.values(game.characters)
            .filter(c => c.playerId === playerId && c.isAlive)
          const aliveCount = aliveChars.length
          const isDeclared = !!game.characterDeclarations[playerId]
          const isDestConfirmed = !!game.destinationStatus[playerId]
          const hasTempDest = !!game.sealedDestinations[playerId]
          const hasVoteConfirmed = !!game.currentVote?.status[playerId]
          const hasTempVote = !!game.currentVote?.votes[playerId]

          const currentDeclarer = game.declarationOrder.find(pid => !game.characterDeclarations[pid])
          const isCurrentTurn =
            (game.phase === 'character_select' && playerId === currentDeclarer) ||
            (game.phase === 'setup_place' && playerId === game.setupPlacementOrder[0])

          let statusDot = ''
          if (game.phase === 'character_select') statusDot = isDeclared ? '✓' : '...'
          else if (game.phase === 'destination_seal') statusDot = isDestConfirmed ? '✓' : hasTempDest ? '●' : '...'
          else if (game.phase === 'voting') statusDot = hasVoteConfirmed ? '✓' : hasTempVote ? '●' : '...'

          return (
            <div key={playerId} className={`rounded-xl p-2 transition-all ${
              isCurrentTurn
                ? 'bg-yellow-950/60 ring-2 ring-yellow-500'
                : 'bg-zinc-800'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-3 h-3 rounded-full shrink-0 ${COLOR_BG[player?.color ?? ''] ?? 'bg-zinc-600'}`} />
                <span className={`text-xs font-medium truncate flex-1 ${isCurrentTurn ? 'text-yellow-300' : 'text-white'}`}>
                  {isCurrentTurn && <span className="mr-0.5">▶</span>}
                  {player?.nickname ?? '?'}
                </span>
                {isSheriff && <span className="text-yellow-400 text-xs">👮</span>}
                {playerId === uid && <span className="text-blue-400 text-xs">나</span>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1 mb-1">
                {aliveChars.map(c => {
                  const cfg = CHARACTER_CONFIGS[c.characterId]
                  const zoneCfg = ZONE_CONFIGS[c.zone]
                  return (
                    <span
                      key={c.id}
                      title={`${cfg?.name} — ${zoneCfg?.displayName}`}
                      className="text-xs px-1.5 py-0.5 rounded font-medium bg-zinc-700 text-zinc-200"
                    >
                      {cfg?.name ?? c.characterId}
                    </span>
                  )
                })}
                {aliveCount === 0 && (
                  <span className="text-xs text-zinc-600">전멸</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-600">{aliveCount}명 생존</span>
                <div className="flex items-center gap-1">
                  {game.playerItemCounts[playerId] > 0 && (
                    <span className="text-xs text-zinc-500">
                      🎒{game.playerItemCounts[playerId]}
                    </span>
                  )}
                  {statusDot && (
                    <span className={`text-xs ${statusDot === '✓' ? 'text-green-400' : statusDot === '●' ? 'text-yellow-400' : 'text-zinc-600'}`}>
                      {statusDot}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface MobilePlayerListProps {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  sheriffId: string
}

export function MobilePlayerList({ game, players, uid, sheriffId }: MobilePlayerListProps) {
  return (
    <div className="md:hidden mt-3 -mx-3 px-3 pb-1">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[...game.playerOrder.slice(game.sheriffIndex), ...game.playerOrder.slice(0, game.sheriffIndex)].map(playerId => {
          const player = players[playerId]
          const isSheriff = playerId === sheriffId
          const aliveChars = Object.values(game.characters).filter(c => c.playerId === playerId && c.isAlive)
          const isDeclared = !!game.characterDeclarations[playerId]
          const isDestConfirmed = !!game.destinationStatus[playerId]
          const hasTempDest = !!game.sealedDestinations[playerId]
          const hasVoteConfirmed = !!game.currentVote?.status[playerId]
          const hasTempVote = !!game.currentVote?.votes[playerId]
          const currentDeclarer = game.declarationOrder.find(pid => !game.characterDeclarations[pid])
          const isCurrentTurn =
            (game.phase === 'character_select' && playerId === currentDeclarer) ||
            (game.phase === 'setup_place' && playerId === game.setupPlacementOrder[0])
          let statusDot = ''
          if (game.phase === 'character_select') statusDot = isDeclared ? '✓' : '...'
          else if (game.phase === 'destination_seal') statusDot = isDestConfirmed ? '✓' : hasTempDest ? '●' : '...'
          else if (game.phase === 'voting') statusDot = hasVoteConfirmed ? '✓' : hasTempVote ? '●' : '...'
          return (
            <div key={playerId} className={`shrink-0 rounded-xl px-2.5 py-2 min-w-[72px] ${
              isCurrentTurn ? 'bg-yellow-950/60 ring-2 ring-yellow-500' : 'bg-zinc-800'
            }`}>
              <div className="flex items-center gap-1 mb-1">
                <div className={`w-2 h-2 rounded-full shrink-0 ${COLOR_BG[player?.color ?? ''] ?? 'bg-zinc-600'}`} />
                <span className={`text-xs font-medium truncate max-w-[56px] ${isCurrentTurn ? 'text-yellow-300' : 'text-white'}`}>
                  {isCurrentTurn && '▶'}{player?.nickname ?? '?'}
                </span>
              </div>
              <div className="flex items-center gap-1 justify-between">
                <div className="flex items-center gap-0.5">
                  {isSheriff && <span className="text-xs">👮</span>}
                  {playerId === uid && <span className="text-blue-400 text-xs">나</span>}
                  <span className="text-xs text-zinc-500">{aliveChars.length}명</span>
                </div>
                {statusDot && (
                  <span className={`text-xs ${statusDot === '✓' ? 'text-green-400' : statusDot === '●' ? 'text-yellow-400' : 'text-zinc-600'}`}>
                    {statusDot}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
