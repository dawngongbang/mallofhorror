import type { GameState } from '../../engine/types'

// Firebase는 빈 배열/객체를 null로 저장하므로 정규화 필요
export function normalizeGame(g: GameState): GameState {
  const zones = g.zones ?? {} as GameState['zones']
  const normalizedZones = Object.fromEntries(
    Object.entries(zones).map(([k, z]) => {
      const raw = (z as any).characterIds
      const characterIds: string[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
          ? Object.values(raw) as string[]
          : []
      return [k, { ...z, characterIds, isClosed: (z as any).isClosed ?? false }]
    })
  ) as GameState['zones']

  const cv = g.currentVote
  const toArray = (v: unknown): string[] =>
    Array.isArray(v) ? v as string[]
    : v && typeof v === 'object' ? Object.values(v) as string[]
    : []
  const normalizedVote = cv ? {
    ...cv,
    eligibleVoters: toArray(cv.eligibleVoters),
    candidates:     toArray(cv.candidates),
    votes:          cv.votes          ?? {},
    status:         cv.status         ?? {},
    bonusVoteWeights: cv.bonusVoteWeights ?? {},
  } : null

  return {
    ...g,
    playerOrder:            g.playerOrder            ?? [],
    setupPlacementOrder:    g.setupPlacementOrder    ?? [],
    declarationOrder:       g.declarationOrder       ?? [],
    resolvedMoves:          Array.isArray(g.resolvedMoves)
                              ? g.resolvedMoves
                              : g.resolvedMoves && typeof g.resolvedMoves === 'object'
                                ? Object.values(g.resolvedMoves) as import('../../engine/types').ResolvedMove[]
                                : [],
    currentMoveStep:        g.currentMoveStep        ?? 0,
    winners:                g.winners                ?? [],
    characterDeclarations:  g.characterDeclarations  ?? {},
    destinationStatus:      g.destinationStatus      ?? {},
    sealedDestinations:     g.sealedDestinations     ?? {},
    characters:             g.characters             ?? {},
    zones:                  normalizedZones,
    finalScores:            g.finalScores            ?? {},
    playerItemCounts:       g.playerItemCounts       ?? {},
    currentVote:            normalizedVote,
    itemSearchPreview:      g.itemSearchPreview ? toArray(g.itemSearchPreview) : null,
    pendingVictimSelection: g.pendingVictimSelection ?? null,
    lastVoteAnnounce:       g.lastVoteAnnounce
                              ? { ...g.lastVoteAnnounce, votes: g.lastVoteAnnounce.votes ?? {}, bonusVoteWeights: g.lastVoteAnnounce.bonusVoteWeights ?? {} }
                              : null,
    lastZombieAttackResult: g.lastZombieAttackResult ?? null,
    cctvViewers:            Array.isArray(g.cctvViewers) ? g.cctvViewers : [],
    weaponUseStatus:        (g.weaponUseStatus && typeof g.weaponUseStatus === 'object') ? g.weaponUseStatus : {},
    weaponKillChoices:      (g.weaponKillChoices && typeof g.weaponKillChoices === 'object') ? g.weaponKillChoices : {},
    pendingHideChoices:     (g.pendingHideChoices && typeof g.pendingHideChoices === 'object') ? g.pendingHideChoices : {},
    pendingSprintChoices:   (g.pendingSprintChoices && typeof g.pendingSprintChoices === 'object') ? g.pendingSprintChoices : {},
    pendingHardwareChoices: (g.pendingHardwareChoices && typeof g.pendingHardwareChoices === 'object') ? g.pendingHardwareChoices : {},
    hiddenCharacters:       (g.hiddenCharacters && typeof g.hiddenCharacters === 'object') ? g.hiddenCharacters : {},
    lastSprintAnnounce:     g.lastSprintAnnounce ?? null,
    lastHideRevealAnnounce: g.lastHideRevealAnnounce ?? null,
    lastWeaponUseAnnounce:  g.lastWeaponUseAnnounce
                              ? { ...g.lastWeaponUseAnnounce, killsByPlayer: g.lastWeaponUseAnnounce.killsByPlayer ?? {} }
                              : null,
    zombiePlayerZoneChoices: (g.zombiePlayerZoneChoices && typeof g.zombiePlayerZoneChoices === 'object') ? g.zombiePlayerZoneChoices : {},
    lastZombiePlayerAnnounce: g.lastZombiePlayerAnnounce
                              ? { entries: Array.isArray(g.lastZombiePlayerAnnounce.entries) ? g.lastZombiePlayerAnnounce.entries : Object.values(g.lastZombiePlayerAnnounce.entries ?? {}) }
                              : null,
    lastItemSearchAnnounce:   g.lastItemSearchAnnounce ?? null,
    zombieSpawnBatches:       Array.isArray(g.zombieSpawnBatches) ? g.zombieSpawnBatches : null,
    zombieSpawnStep:          g.zombieSpawnStep ?? 0,
  }
}
