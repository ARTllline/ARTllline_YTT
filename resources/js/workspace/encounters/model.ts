import type { Scene } from '../../tabletop/types/scene';

export interface EncounterGroup {
    id: string;
    name: string;
    tokenIds: string[];
}
export interface PreparedEncounter {
    id: string;
    name: string;
    status: 'draft' | 'ready';
    groups: EncounterGroup[];
}
export interface EncounterCommand {
    id: string;
    expected: PreparedEncounter | null;
    value: Omit<PreparedEncounter, 'id'> | null;
}
export interface EncounterRun {
    encounterId: string;
    combatId: string;
    status: 'preparing' | 'active' | 'ended';
    activatedTokenIds: string[];
}
export interface EncounterCombatCommand {
    id: string;
    action: 'start' | 'reinforce';
    expected: PreparedEncounter;
    expectedCombatId: string | null;
    playerTokenIds?: string[];
    tokenIds?: string[];
}
export function encounterPatch(
    scene: Scene,
    patch: {
        encounters?: PreparedEncounter[];
        deletedEncounterId?: string;
        encounterRuns?: EncounterRun[];
    },
): Scene {
    if (!patch.encounters && !patch.deletedEncounterId && !patch.encounterRuns) return scene;
    const changed = new Set(patch.encounters?.map((e) => e.id));
    return {
        ...scene,
        ...(patch.encounterRuns || scene.encounterRuns
            ? {
                  encounterRuns: (patch.encounterRuns ?? scene.encounterRuns ?? []).filter(
                      (r) => r.encounterId !== patch.deletedEncounterId,
                  ),
              }
            : {}),
        encounters: [
            ...(scene.encounters ?? []).filter(
                (e) => e.id !== patch.deletedEncounterId && !changed.has(e.id),
            ),
            ...(patch.encounters ?? []),
        ].sort((a, b) => a.id.localeCompare(b.id)),
    };
}
export function assignMembers(
    encounter: PreparedEncounter,
    tokenIds: string[],
    groupId: string,
): PreparedEncounter {
    const ids = new Set(tokenIds);
    return {
        ...encounter,
        groups: encounter.groups.map((g) => ({
            ...g,
            tokenIds: [
                ...g.tokenIds.filter((id) => !ids.has(id)),
                ...(g.id === groupId ? tokenIds : []),
            ].sort((a, b) => Number(a) - Number(b)),
        })),
    };
}
export function newEncounter(tokenIds: string[] = []): PreparedEncounter {
    return {
        id: crypto.randomUUID(),
        name: 'Новое столкновение',
        status: 'draft',
        groups: [{ id: 'main', name: 'Основная группа', tokenIds }],
    };
}
