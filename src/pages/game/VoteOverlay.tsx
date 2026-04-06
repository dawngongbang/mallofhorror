import {
  selectVote, confirmVote, submitVictimChoice,
} from '../../firebase/gameService'
import { CHARACTER_CONFIGS, ZONE_CONFIGS } from '../../engine/constants'
import type { GameState, Player } from '../../engine/types'
import { COLOR_BG, CHAR_ICON } from './constants'

interface VoteOverlayProps {
  game: GameState
  players: Record<string, Player>
  uid: string | null
  roomCode: string
  actionLoading: boolean
  setActionLoading: (v: boolean) => void
  onShowMap: () => void
}

export default function VoteOverlay({
  game, players, uid, roomCode,
  actionLoading, setActionLoading, onShowMap,
}: VoteOverlayProps) {
  const pvs = game.pendingVictimSelection
  const vote = game.currentVote
  const announce = game.lastVoteAnnounce

  const myVote = uid && vote ? vote.votes[uid] : undefined
  const myVoteConfirmed = !!(uid && vote?.status[uid])

  async function handleSelectVote(targetId: string) {
    if (!uid || myVoteConfirmed || actionLoading) return
    setActionLoading(true)
    try { await selectVote(roomCode, targetId) }
    finally { setActionLoading(false) }
  }
  async function handleConfirmVote() {
    if (!uid || !myVote || myVoteConfirmed || actionLoading) return
    setActionLoading(true)
    try { await confirmVote(roomCode) }
    finally { setActionLoading(false) }
  }
  async function handleVictimChoice(charId: string) {
    setActionLoading(true)
    try { await submitVictimChoice(roomCode, charId) }
    finally { setActionLoading(false) }
  }

  // ── 희생 캐릭터 선택 ──────────────────────────────────────
  if (pvs && !pvs.chosenCharacterId) {
    const isLoser = uid === pvs.loserPlayerId
    const myCharsInZone = Object.values(game.characters).filter(
      c => c.playerId === uid && c.isAlive
        && game.zones[pvs.zone].characterIds.includes(c.id)
        && !game.hiddenCharacters?.[c.id]
    )
    return (
      <Wrapper onShowMap={onShowMap} title={`💀 ${ZONE_CONFIGS[pvs.zone].displayName} — 희생자 선택`} type="zombie_attack">
        {isLoser ? (
          <div className="text-center">
            <p className="text-red-300 text-sm mb-4 animate-pulse">잃을 캐릭터를 선택하세요...</p>
            <div className="flex gap-3 justify-center flex-wrap">
              {myCharsInZone.map(c => (
                <button key={c.id}
                  onClick={() => handleVictimChoice(c.id)}
                  disabled={actionLoading}
                  className="flex flex-col items-center gap-1 bg-zinc-800/90 hover:bg-red-900/80 border border-red-800 hover:border-red-400 rounded-2xl px-4 py-3 transition-all disabled:opacity-50">
                  <span className="text-3xl">{CHAR_ICON[c.characterId] ?? '?'}</span>
                  <span className="text-sm text-white font-bold">{CHARACTER_CONFIGS[c.characterId]?.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-zinc-400 text-center text-sm animate-pulse">
            <span className="text-white font-bold">{players[pvs.loserPlayerId]?.nickname}</span>님이 희생할 캐릭터를 선택 중...
          </p>
        )}
      </Wrapper>
    )
  }

  if (!vote) {
    return (
      <Wrapper onShowMap={onShowMap} title="🗳️ 투표 준비 중..." type="zombie_attack">
        <p className="text-zinc-500 text-center animate-pulse">잠시 후 시작됩니다</p>
      </Wrapper>
    )
  }

  const voteZone = ZONE_CONFIGS[vote.zone]
  const voteTypeLabel = vote.type === 'zombie_attack' ? '좀비 공격' :
    vote.type === 'truck_search' ? '트럭 수색' : '보안관 선출'
  const voteIcon = vote.type === 'zombie_attack' ? '🧟' :
    vote.type === 'truck_search' ? '🚚' : '👮'
  const candidates = (vote.candidates ?? []).map(id => ({
    id, nickname: players[id]?.nickname ?? '?', color: players[id]?.color ?? 'red',
  }))
  const eligibleVoters = vote.eligibleVoters ?? []
  const confirmedCount = eligibleVoters.filter(id => vote.status[id]).length
  const canVote = eligibleVoters.includes(uid ?? '')

  // ── 투표 결과 ──────────────────────────────────────────────
  if (announce) {
    const sortedTally = Object.entries(announce.tally).sort(([, a], [, b]) => b - a)
    const maxVotes = sortedTally[0]?.[1] ?? 0
    const winnerId = sortedTally[0]?.[0]
    const winnerIcon = vote.type === 'zombie_attack' ? '💀' :
      vote.type === 'truck_search' ? '🚚' : '👮'

    return (
      <Wrapper onShowMap={onShowMap}
        title={`${voteIcon} ${voteZone.displayName} — ${voteTypeLabel} 결과`}
        type={vote.type}>
        {/* 투표 내용 */}
        <div className="space-y-2 mb-4">
          {eligibleVoters.map(voterId => {
            const targetId = announce.votes[voterId]
            const bonus = announce.bonusVoteWeights?.[voterId] ?? 0
            return (
              <div key={voterId} className="flex items-center gap-2 text-sm bg-zinc-800/60 rounded-lg px-3 py-1.5">
                <span className={`font-medium ${voterId === uid ? 'text-blue-300' : 'text-zinc-300'}`}>
                  {players[voterId]?.nickname ?? '?'}
                </span>
                {bonus > 0 && <span className="text-xs text-orange-400 font-bold">😤+{bonus}</span>}
                <span className="text-zinc-600 mx-1">→</span>
                <span className={targetId ? 'text-red-300 font-medium' : 'text-zinc-500'}>
                  {targetId ? (players[targetId]?.nickname ?? '?') : '기권'}
                </span>
              </div>
            )
          })}
        </div>

        {/* 득표 집계 */}
        <div className="border-t border-zinc-700 pt-3 space-y-2">
          {sortedTally.map(([candidateId, votes]) => {
            const isWinner = votes === maxVotes
            return (
              <div key={candidateId}
                className={`flex items-center justify-between rounded-xl px-3 py-2 transition-all
                  ${isWinner ? 'bg-red-950/80 border border-red-700' : 'bg-zinc-900/60'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${COLOR_BG[players[candidateId]?.color ?? ''] ?? 'bg-zinc-500'}`} />
                  <span className={`text-sm font-bold ${isWinner ? 'text-white' : 'text-zinc-400'}`}>
                    {players[candidateId]?.nickname ?? '?'}
                  </span>
                </div>
                <span className={`text-sm font-bold ${isWinner ? 'text-red-400' : 'text-zinc-500'}`}>
                  {votes}표 {isWinner ? winnerIcon : ''}
                </span>
              </div>
            )
          })}
        </div>

        {/* 보안관 선출 공지 */}
        {vote.type === 'sheriff' && winnerId && (
          <div className="mt-3 bg-yellow-900/60 border border-yellow-600/50 rounded-xl px-3 py-2 text-center">
            <p className="text-yellow-300 text-sm font-bold">
              🏅 {players[winnerId]?.nickname ?? winnerId}님이 다음 라운드 보안관으로 선출되었습니다!
            </p>
          </div>
        )}

        <p className="text-zinc-600 text-xs mt-4 text-center animate-pulse">잠시 후 다음 단계로 진행됩니다...</p>
      </Wrapper>
    )
  }

  // ── 투표 진행 중 ───────────────────────────────────────────
  return (
    <Wrapper onShowMap={onShowMap}
      title={`${voteIcon} ${voteZone.displayName} — ${voteTypeLabel}${vote.round > 0 ? ` (재투표 ${vote.round}회차)` : ''}`}
      type={vote.type}>

      {/* 투표 대상 */}
      <p className="text-zinc-500 text-xs mb-2 text-center">투표 대상</p>
      <div className="flex gap-2 justify-center flex-wrap mb-4">
        {candidates.map(c => (
          <button key={c.id}
            onClick={() => handleSelectVote(c.id)}
            disabled={!canVote || myVoteConfirmed || actionLoading}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all
              ${myVote === c.id
                ? 'bg-red-700 ring-2 ring-red-400 text-white scale-105'
                : canVote && !myVoteConfirmed
                ? 'bg-zinc-800 hover:bg-red-900/80 border border-zinc-600 hover:border-red-500 text-white'
                : 'bg-zinc-800/50 border border-zinc-700 text-zinc-500'
              } disabled:cursor-not-allowed`}>
            <div className={`w-3 h-3 rounded-full shrink-0 ${COLOR_BG[c.color]}`} />
            {c.nickname}
          </button>
        ))}
      </div>

      {/* 내 투표 상태 */}
      <div className="flex justify-center mb-4">
        {!canVote ? (
          <p className="text-zinc-500 text-sm">이번 투표에 참여하지 않습니다.</p>
        ) : myVoteConfirmed ? (
          <p className="text-green-400 text-sm font-medium">
            ✓ <span className="text-white">{players[myVote ?? '']?.nickname}</span>에게 투표 완료
          </p>
        ) : myVote ? (
          <button onClick={handleConfirmVote} disabled={actionLoading}
            className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-bold px-8 py-2.5 rounded-xl text-sm transition-colors animate-pulse">
            {actionLoading ? '처리 중...' : `✔ ${players[myVote]?.nickname} 확정`}
          </button>
        ) : (
          <p className="text-zinc-500 text-sm animate-pulse">투표할 대상을 선택하세요</p>
        )}
      </div>

      {/* 투표 현황 */}
      <div className="border-t border-zinc-800 pt-3">
        <p className="text-zinc-500 text-xs mb-2 text-center">{confirmedCount} / {eligibleVoters.length}명 투표 완료</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {eligibleVoters.map(voterId => {
            const confirmed = vote.status[voterId]
            return (
              <div key={voterId}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
                  ${confirmed ? 'bg-red-950/60 border border-red-800/60 text-red-300' : 'bg-zinc-800/60 border border-zinc-700 text-zinc-500'}`}>
                <div className={`w-2 h-2 rounded-full ${COLOR_BG[players[voterId]?.color ?? ''] ?? 'bg-zinc-500'}`} />
                <span>{players[voterId]?.nickname ?? '?'}</span>
                <span>{confirmed ? '✓' : '…'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </Wrapper>
  )
}

// ── 공통 래퍼 ───────────────────────────────────────────────
function Wrapper({
  children, onShowMap, title, type,
}: {
  children: React.ReactNode
  onShowMap: () => void
  title: string
  type: string
}) {
  const accentCls = type === 'zombie_attack' ? 'border-red-800/70' :
    type === 'truck_search' ? 'border-yellow-700/70' : 'border-yellow-600/70'

  return (
    <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
      z-30 flex flex-col rounded-2xl overflow-hidden shadow-2xl
      w-[62%] max-h-[88%]
      bg-zinc-900/96 border ${accentCls} backdrop-blur-sm`}>
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
