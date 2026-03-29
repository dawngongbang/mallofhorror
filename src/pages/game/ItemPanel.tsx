import type { GameState } from '../../engine/types'
import type { ZoneName } from '../../engine/types'
import { CHARACTER_CONFIGS, ITEM_CONFIGS, EVENT_ZONE_ORDER, ZONE_CONFIGS } from '../../engine/constants'
import { ITEM_CATEGORY, instanceIdToItemId } from './constants'

interface ItemPanelProps {
  game: GameState
  uid: string | null
  myItemIds: string[]
  stagedWeapons: Set<string>
  setStagedWeapons: React.Dispatch<React.SetStateAction<Set<string>>>
  stagedHideItemId: string | null
  setStagedHideItemId: (id: string | null) => void
  setStagedHideCharId: (id: string | null) => void
  stagedSprintItemId: string | null
  setStagedSprintItemId: (id: string | null) => void
  stagedSprintCharId: string | null
  setStagedSprintCharId: (id: string | null) => void
  stagedSprintTargetZone: ZoneName | null
  setStagedSprintTargetZone: (z: ZoneName | null) => void
  stagedHardwareItemId: string | null
  setStagedHardwareItemId: (id: string | null) => void
  confirmingItems: Set<string>
  setConfirmingItems: React.Dispatch<React.SetStateAction<Set<string>>>
  actionLoading: boolean
  onUseItem: (instanceId: string, itemId: string) => void
}

export default function ItemPanel({
  game,
  uid,
  myItemIds,
  stagedWeapons,
  setStagedWeapons,
  stagedHideItemId,
  setStagedHideItemId,
  setStagedHideCharId,
  stagedSprintItemId,
  setStagedSprintItemId,
  stagedSprintCharId,
  setStagedSprintCharId,
  stagedSprintTargetZone,
  setStagedSprintTargetZone,
  stagedHardwareItemId,
  setStagedHardwareItemId,
  confirmingItems,
  setConfirmingItems,
  actionLoading,
  onUseItem,
}: ItemPanelProps) {
  if (myItemIds.length === 0) return null

  return (
    <div className="mt-3 bg-zinc-900 rounded-2xl p-3">
      <p className="text-xs text-zinc-500 mb-2">내 아이템</p>
      <div className="flex flex-wrap gap-2">
        {myItemIds.map(instanceId => {
          const itemId = instanceIdToItemId(instanceId)
          const cfg = ITEM_CONFIGS[itemId as keyof typeof ITEM_CONFIGS]
          if (!cfg) return null

          const canUseCctv = itemId === 'cctv' && !!game.lastDiceRoll && !game.cctvViewers.includes(uid ?? '')
          const canUseThreat = itemId === 'threat' && game.phase === 'voting' && !!game.currentVote
            && !!uid && game.currentVote.eligibleVoters.includes(uid)
          const weaponItemIds = ['axe', 'pistol', 'shotgun', 'bat', 'grenade', 'chainsaw']
          const amInWeaponZone = game.phase === 'weapon_use' && (() => {
            const zone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
            return game.zones[zone]?.characterIds.some(
              id => game.characters[id]?.playerId === uid && game.characters[id]?.isAlive
            ) ?? false
          })()
          const isStaged = stagedWeapons.has(instanceId)
          const isHideStaged = stagedHideItemId === instanceId
          const isSprintStaged = stagedSprintItemId === instanceId
          const isHardwareStaged = stagedHardwareItemId === instanceId
          const notConfirmed = !game.weaponUseStatus[uid ?? '']
          const canUseWeapon = weaponItemIds.includes(itemId) && amInWeaponZone && notConfirmed && !isStaged
          const canUseHide = itemId === 'hidden_card' && amInWeaponZone && notConfirmed && !stagedHideItemId
          const canUseSprint = itemId === 'sprint' && amInWeaponZone && notConfirmed && !stagedSprintItemId
          const canUseHardware = itemId === 'hardware' && amInWeaponZone && notConfirmed && !stagedHardwareItemId
          const isUsable = canUseCctv || canUseThreat || canUseWeapon || canUseHide || canUseSprint || canUseHardware

          const isConfirming = confirmingItems.has(instanceId)

          if (isHideStaged) {
            return (
              <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-800 border border-purple-600 rounded-lg px-2.5 py-1.5">
                <span className="text-sm">🫥</span>
                <span className="text-xs text-purple-300 font-bold">숨기 ✓</span>
                <button onClick={() => { setStagedHideItemId(null); setStagedHideCharId(null) }}
                  className="text-xs text-zinc-400 hover:text-red-400 px-1 transition-colors">
                  해제
                </button>
              </div>
            )
          }

          if (isSprintStaged) {
            const weaponZone = EVENT_ZONE_ORDER[game.currentEventZoneIndex]
            const myCharsInZone = Object.values(game.characters).filter(c =>
              c.playerId === uid && c.isAlive && c.zone === weaponZone && !game.hiddenCharacters?.[c.id]
            )
            const availableZones = (Object.keys(ZONE_CONFIGS) as ZoneName[]).filter(z => {
              if (z === weaponZone) return false
              const cfg = ZONE_CONFIGS[z]
              if (cfg.maxCapacity === Infinity) return true
              return game.zones[z].characterIds.filter(id => game.characters[id]?.isAlive).length < cfg.maxCapacity
            })
            return (
              <div key={instanceId} className="flex flex-col gap-1.5 bg-zinc-800 border border-cyan-600 rounded-lg px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-cyan-300 font-bold">👟 스프린트</span>
                  <button onClick={() => { setStagedSprintItemId(null); setStagedSprintCharId(null); setStagedSprintTargetZone(null) }}
                    className="text-xs text-zinc-400 hover:text-red-400 transition-colors">해제</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {myCharsInZone.map(c => {
                    const cc = CHARACTER_CONFIGS[c.characterId]
                    return (
                      <button key={c.id} onClick={() => setStagedSprintCharId(c.id)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${stagedSprintCharId === c.id ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}>
                        {cc?.name}
                      </button>
                    )
                  })}
                </div>
                {stagedSprintCharId && (
                  <div className="flex flex-wrap gap-1">
                    {availableZones.map(z => (
                      <button key={z} onClick={() => setStagedSprintTargetZone(z)}
                        className={`text-xs px-1.5 py-0.5 rounded transition-colors ${stagedSprintTargetZone === z ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}>
                        {ZONE_CONFIGS[z].displayName}
                      </button>
                    ))}
                  </div>
                )}
                {stagedSprintCharId && stagedSprintTargetZone && (
                  <span className="text-xs text-cyan-400">
                    {CHARACTER_CONFIGS[game.characters[stagedSprintCharId]?.characterId]?.name} → {ZONE_CONFIGS[stagedSprintTargetZone].displayName} ✓
                  </span>
                )}
              </div>
            )
          }

          if (isHardwareStaged) {
            return (
              <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-800 border border-orange-600 rounded-lg px-2.5 py-1.5">
                <span className="text-sm">🔧</span>
                <span className="text-xs text-orange-300 font-bold">하드웨어 ✓ (+1 방어)</span>
                <button onClick={() => setStagedHardwareItemId(null)}
                  className="text-xs text-zinc-400 hover:text-red-400 px-1 transition-colors">
                  해제
                </button>
              </div>
            )
          }

          if (isStaged) {
            return (
              <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-800 border border-green-600 rounded-lg px-2.5 py-1.5">
                <span className="text-sm">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
                <span className="text-xs text-green-400 font-bold">{cfg.name} ✓</span>
                <button onClick={() => setStagedWeapons(prev => { const next = new Set(prev); next.delete(instanceId); return next })}
                  className="text-xs text-zinc-400 hover:text-red-400 px-1 transition-colors">
                  해제
                </button>
              </div>
            )
          }

          if (isConfirming) {
            return (
              <div key={instanceId} className="flex items-center gap-1.5 bg-zinc-700 border border-yellow-600 rounded-lg px-2.5 py-1.5">
                <span className="text-xs text-yellow-300">{cfg.name} 사용?</span>
                <button onClick={() => onUseItem(instanceId, itemId)} disabled={actionLoading}
                  className="text-xs bg-yellow-600 hover:bg-yellow-500 text-black font-bold px-2 py-0.5 rounded transition-colors">
                  확인
                </button>
                <button onClick={() => setConfirmingItems(prev => { const next = new Set(prev); next.delete(instanceId); return next })}
                  className="text-xs text-zinc-400 hover:text-white px-1 transition-colors">
                  취소
                </button>
              </div>
            )
          }

          return (
            <button key={instanceId}
              title={cfg.description}
              onClick={() => isUsable && setConfirmingItems(prev => new Set(prev).add(instanceId))}
              disabled={!isUsable}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                isUsable
                  ? 'bg-zinc-700 hover:bg-zinc-600 text-white cursor-pointer ring-1 ring-zinc-500'
                  : 'bg-zinc-800 text-zinc-500 cursor-default'
              }`}>
              <span className="text-sm">{ITEM_CATEGORY[itemId] ?? '📦'}</span>
              <span className="text-xs font-medium">{cfg.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
