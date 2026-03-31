import { useState } from 'react'
import { createRoom, joinRoom } from '../firebase/roomService'
import RulesModal from '../components/RulesModal'

interface Props {
  onEnterRoom: (roomCode: string) => void
}

export default function LobbyPage({ onEnterRoom }: Props) {
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [isTestMode, setIsTestMode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRules, setShowRules] = useState(false)

  async function handleCreate() {
    if (!nickname.trim()) { setError('닉네임을 입력해주세요.'); return }
    setLoading(true); setError('')
    try {
      const code = await createRoom(nickname.trim(), { isTestMode })
      onEnterRoom(code)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!nickname.trim()) { setError('닉네임을 입력해주세요.'); return }
    if (!joinCode.trim()) { setError('방 코드를 입력해주세요.'); return }
    setLoading(true); setError('')
    try {
      await joinRoom(joinCode.trim().toUpperCase(), nickname.trim())
      onEnterRoom(joinCode.trim().toUpperCase())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* 타이틀 */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-red-500 tracking-widest mb-1">MALL OF HORROR</h1>
        <p className="text-zinc-500 text-sm">온라인 멀티플레이어</p>
        <div className="flex items-center justify-center gap-3 mt-1">
          <p className="text-zinc-700 text-xs">v{__APP_VERSION__}</p>
          <button onClick={() => setShowRules(true)} className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors">📖 게임 설명서</button>
        </div>
      </div>

      <div className="w-full max-w-sm bg-zinc-900 rounded-2xl p-6 shadow-xl">
        {/* 탭 */}
        <div className="flex mb-6 bg-zinc-800 rounded-lg p-1">
          {(['create', 'join'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'create' ? '방 만들기' : '방 입장'}
            </button>
          ))}
        </div>

        {/* 닉네임 */}
        <label className="block text-xs text-zinc-400 mb-1">닉네임</label>
        <input
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (tab === 'create' ? handleCreate() : handleJoin())}
          placeholder="이름 입력"
          maxLength={10}
          className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm mb-4 outline-none focus:ring-2 focus:ring-red-500 placeholder:text-zinc-600"
        />

        {/* 방 코드 (입장 탭) */}
        {tab === 'join' && (
          <>
            <label className="block text-xs text-zinc-400 mb-1">방 코드</label>
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder="예) AB1234"
              maxLength={6}
              className="w-full bg-zinc-800 text-white rounded-lg px-4 py-2.5 text-sm mb-4 outline-none focus:ring-2 focus:ring-red-500 placeholder:text-zinc-600 tracking-widest font-mono"
            />
          </>
        )}

        {/* 테스트 모드 (방 만들기 탭만) */}
        {tab === 'create' && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isTestMode}
              onChange={e => setIsTestMode(e.target.checked)}
              className="w-4 h-4 rounded accent-yellow-500"
            />
            <span className="text-xs text-zinc-500">테스트 모드 <span className="text-zinc-600">(2인 시작 허용)</span></span>
          </label>
        )}

        {/* 에러 */}
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

        {/* 버튼 */}
        <button
          onClick={tab === 'create' ? handleCreate : handleJoin}
          disabled={loading}
          className="w-full bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold rounded-lg py-3 text-sm transition-colors"
        >
          {loading ? '처리 중...' : tab === 'create' ? '방 만들기' : '입장하기'}
        </button>
      </div>
    {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
