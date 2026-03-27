import { useState } from 'react'

const TABS = ['구역', '캐릭터', '아이템', '게임 흐름', '투표', '승리 조건'] as const
type Tab = typeof TABS[number]

export default function RulesModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('게임 흐름')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-zinc-900 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-white font-bold text-sm">📖 게임 설명서</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none transition-colors">✕</button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 px-4 pt-3 pb-2 overflow-x-auto shrink-0">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                tab === t ? 'bg-red-700 text-white font-medium' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* 내용 */}
        <div className="overflow-y-auto px-5 py-3 text-sm space-y-3 text-zinc-300">
          {tab === '구역' && <ZoneTab />}
          {tab === '캐릭터' && <CharacterTab />}
          {tab === '아이템' && <ItemTab />}
          {tab === '게임 흐름' && <FlowTab />}
          {tab === '투표' && <VoteTab />}
          {tab === '승리 조건' && <WinTab />}
        </div>
      </div>
    </div>
  )
}

function ZoneTab() {
  return (
    <>
      <p className="text-zinc-500 text-xs">모든 구역 간 자유 이동 가능. 주차장이 중앙.</p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800">
            <th className="text-left py-1.5">구역</th>
            <th className="text-center py-1.5">수용</th>
            <th className="text-left py-1.5">특수</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {[
            { name: '🚽 화장실', cap: '3', special: '' },
            { name: '👗 옷가게', cap: '4', special: '3~4인 시작 시 폐쇄' },
            { name: '🧸 장난감가게', cap: '4', special: '' },
            { name: '🚗 주차장', cap: '∞', special: '좀비 1마리 = 항상 습격. 트럭 수색' },
            { name: '🔒 보안실', cap: '3', special: '보안관 투표. 정식보안관 유지 조건' },
            { name: '🛒 슈퍼마켓', cap: '6', special: '방어한도 4 (초과 인원은 방어에 기여 없음)' },
          ].map(r => (
            <tr key={r.name} className="text-zinc-300">
              <td className="py-1.5 font-medium">{r.name}</td>
              <td className="text-center py-1.5 text-zinc-400">{r.cap}</td>
              <td className="py-1.5 text-zinc-500 text-xs">{r.special}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bg-zinc-800 rounded-xl p-3 text-xs text-zinc-400 space-y-1">
        <p>• 목적지가 가득 찼으면 주차장으로 튕겨남</p>
        <p>• 좀비 8마리 이상 + 사람 없음 → 구역 폐쇄 (이후 이동 불가)</p>
      </div>
    </>
  )
}

function CharacterTab() {
  return (
    <>
      <p className="text-zinc-500 text-xs">각 플레이어가 동일한 캐릭터 세트를 소유. 인당 3개 (3인은 4개).</p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800">
            <th className="text-left py-1.5">캐릭터</th>
            <th className="text-center py-1.5">점수</th>
            <th className="text-center py-1.5">방어력</th>
            <th className="text-center py-1.5">투표권</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {[
            { name: '💃 미녀', score: '7', def: '1', vote: '1', note: '집결 구역 +1 좀비' },
            { name: '💪 터프가이', score: '5', def: '2', vote: '1', note: '' },
            { name: '🔫 건맨', score: '3', def: '1', vote: '2', note: '투표권 2개' },
            { name: '👦 아이', score: '1', def: '1', vote: '1', note: '3인 게임에만 등장' },
          ].map(r => (
            <tr key={r.name}>
              <td className="py-1.5 font-medium">
                {r.name}
                {r.note && <span className="text-zinc-500 ml-1">({r.note})</span>}
              </td>
              <td className="text-center py-1.5 text-yellow-400 font-bold">{r.score}pt</td>
              <td className="text-center py-1.5 text-blue-400">{r.def}</td>
              <td className="text-center py-1.5 text-green-400">{r.vote}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bg-zinc-800 rounded-xl p-3 text-xs text-zinc-400">
        <p className="font-medium text-zinc-300 mb-1">방어력 계산</p>
        <p>구역 방어력 = min(방어한도, 구역 내 캐릭터 방어력 합산)</p>
        <p className="mt-1 text-zinc-500">예) 슈퍼마켓(방어한도4)에 터프가이(2)+미녀(1)+건맨(1) = 합산4 → min(4,4) = 4</p>
      </div>
    </>
  )
}

function ItemTab() {
  return (
    <>
      <p className="text-zinc-500 text-xs">게임 시작 시 21장 중 인당 3장 랜덤 지급.</p>
      <div className="space-y-2">
        {[
          { icon: '📷', name: '보안카메라', count: '×3', effect: '아무때나 사용 가능. 이번 라운드 주사위 결과를 정식보안관과 동일하게 확인.' },
          { icon: '😤', name: '협박', count: '×3', effect: '투표 중 사용. 이번 투표에서 자신의 투표권 +1. 재투표 시 효과 소멸.' },
          { icon: '🫥', name: '숨기', count: '×3', effect: '습격 전, 내 캐릭터 1명을 이 구역 처리가 끝날 때까지 숨긴다. 숨은 캐릭터는 방어·투표에 참여하지 않는다.' },
          { icon: '🔧', name: '하드웨어', count: '×3', effect: '습격 판정 시 사용. 방어력 +1.' },
          { icon: '👟', name: '스프린트', count: '×3', effect: '습격 전, 내 캐릭터 1명을 다른 구역으로 이동시킨다.' },
          { icon: '🪓', name: '도끼', count: '×1', effect: '좀비 1마리 제거. 습격 직전 사용.' },
          { icon: '🔫', name: '권총 / 야구배트', count: '×1', effect: '좀비 1마리 제거. 습격 직전 사용.' },
          { icon: '💣', name: '샷건 / 수류탄 / 전기톱', count: '×1', effect: '좀비 2마리 제거. 습격 직전 사용.' },
        ].map(item => (
          <div key={item.name} className="flex gap-2 bg-zinc-800 rounded-xl p-2.5">
            <span className="text-lg shrink-0">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-white font-medium text-xs">{item.name}</span>
                <span className="text-zinc-600 text-xs">{item.count}</span>
              </div>
              <p className="text-zinc-400 text-xs">{item.effect}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function FlowTab() {
  return (
    <div className="space-y-4">
      {[
        {
          step: '1', title: '주사위 굴리기', content: [
            '보안관이 주사위 4개 굴림',
            '정식보안관(보안실 점유 중): 결과 혼자 확인 → 공개/거짓말/침묵 자유',
            '보안카메라 사용자도 동일하게 확인 가능',
            '임시보안관: 자동 공개',
          ]
        },
        {
          step: '2', title: '이동 페이즈', content: [
            '보안관부터 순서대로 이동할 캐릭터 공개 선언',
            '모든 플레이어가 목적지를 동시에 비공개 선택',
            '타이머 종료 또는 전원 확정 시 동시 공개',
            '보안관 순서대로 이동 처리',
            '반드시 현재 구역이 아닌 다른 곳으로만 이동 가능',
            '목적지가 가득 찼으면 주차장으로 튕겨남',
          ]
        },
        {
          step: '3', title: '이벤트 페이즈', content: [
            '좀비 배치: 주사위 결과 + 보너스(미녀 집결 +1, 인원 집결 +1)',
            '1번~6번 구역 순서대로 처리',
            '좀비 수 > 방어력 → 습격 발생 (투표)',
            '주차장에 사람 있으면 → 트럭 수색 투표',
            '보안실에 사람 있으면 → 보안관 투표',
          ]
        },
        {
          step: '4', title: '초기 배치', content: [
            '보안관부터 순서대로 주사위 2개 굴림',
            '나온 두 구역 중 하나에 자기 캐릭터 1개 배치',
            '해당 구역이 가득 찼으면 원하는 곳에 자유 배치',
            '모든 캐릭터 배치 완료 시 게임 시작',
          ]
        },
      ].map(s => (
        <div key={s.step}>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-red-700 text-white text-xs flex items-center justify-center font-bold shrink-0">{s.step}</span>
            <span className="font-medium text-white text-xs">{s.title}</span>
          </div>
          <ul className="space-y-1 pl-7">
            {s.content.map((c, i) => (
              <li key={i} className="text-zinc-400 text-xs">• {c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function VoteTab() {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-white mb-2 text-xs">습격 투표 (zombie_attack)</p>
        <ul className="space-y-1 text-zinc-400 text-xs pl-2">
          <li>• 해당 구역 플레이어들끼리 투표</li>
          <li>• 가장 많이 지목된 플레이어의 캐릭터 1개 사망</li>
          <li>• 캐릭터 여러 개면 패배자가 직접 선택</li>
          <li>• 사망 발생 → 해당 구역 좀비 전부 소멸</li>
        </ul>
      </div>
      <div>
        <p className="font-medium text-white mb-2 text-xs">트럭 수색 (truck_search)</p>
        <ul className="space-y-1 text-zinc-400 text-xs pl-2">
          <li>• 주차장에 사람이 있을 때 발생 (덱에 아이템 있을 때만)</li>
          <li>• 당선자: 덱에서 최대 3장 뽑아 혼자 확인</li>
          <li>• 3장: 1장 소유 / 1장 증정 / 1장 반납</li>
          <li>• 2장: 1장 소유 / 1장 증정</li>
          <li>• 1장: 자동 획득</li>
        </ul>
      </div>
      <div>
        <p className="font-medium text-white mb-2 text-xs">보안관 투표 (sheriff)</p>
        <ul className="space-y-1 text-zinc-400 text-xs pl-2">
          <li>• 보안실에 사람이 있을 때 발생</li>
          <li>• 당선자: 다음 라운드부터 정식보안관</li>
          <li>• 동률 2회까지는 기존 보안관 유지</li>
        </ul>
      </div>
      <div className="bg-zinc-800 rounded-xl p-3 text-xs text-zinc-400 space-y-1">
        <p className="text-zinc-300 font-medium mb-1">동률 처리</p>
        <p>1차 동률 → 재투표 (협박 보너스 초기화)</p>
        <p>2차 동률 → 해당 구역 밖 전체 플레이어도 참여</p>
        <p>이후 동률 → 동률 깨질 때까지 계속</p>
      </div>
      <div className="bg-zinc-800 rounded-xl p-3 text-xs text-zinc-400 space-y-1">
        <p className="text-zinc-300 font-medium mb-1">투표권</p>
        <p>건맨: 2표 / 나머지: 1표</p>
        <p>협박 카드 사용 시 +1표 (해당 투표 1회만)</p>
      </div>
    </div>
  )
}

function WinTab() {
  return (
    <div className="space-y-3">
      <div className="bg-zinc-800 rounded-xl p-3 text-xs space-y-1">
        <p className="text-white font-medium mb-2">종료 조건 (매 라운드 종료 시 체크)</p>
        <p className="text-zinc-400">• 전체 생존 캐릭터 수 ≤ 4</p>
        <p className="text-zinc-400">• AND 주차장을 제외한 한 구역에 모든 생존 캐릭터 집결</p>
      </div>
      <div className="bg-zinc-800 rounded-xl p-3 text-xs space-y-1">
        <p className="text-white font-medium mb-2">점수 계산</p>
        {[
          { name: '💃 미녀', pt: '7pt' },
          { name: '💪 터프가이', pt: '5pt' },
          { name: '🔫 건맨', pt: '3pt' },
          { name: '👦 아이', pt: '1pt' },
        ].map(c => (
          <div key={c.name} className="flex justify-between text-zinc-400">
            <span>{c.name}</span>
            <span className="text-yellow-400 font-bold">{c.pt}</span>
          </div>
        ))}
        <p className="text-zinc-500 mt-2 pt-2 border-t border-zinc-700">동점 시 공동 우승</p>
      </div>
    </div>
  )
}
