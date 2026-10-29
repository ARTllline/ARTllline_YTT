import type { AbilityCommand } from './model';

/** One immutable ambiguous command per character. Survives reload and scene changes. */
export function abilitySlot(user: string, campaign: string, character: string) {
    return `ytt:ability:${user}:${campaign}:${character}`;
}
export interface PendingAbility {
    sceneId: string;
    command: AbilityCommand;
    name: string;
}
export function readPendingAbility(slot: string): PendingAbility | null {
    try {
        return JSON.parse(sessionStorage.getItem(slot) ?? 'null');
    } catch {
        return null;
    }
}
export function retainAbility(slot: string, pending: PendingAbility) {
    try {
        sessionStorage.setItem(slot, JSON.stringify(pending));
    } catch {
        /* In-memory reference remains. */
    }
}
export function clearAbility(slot: string) {
    try {
        sessionStorage.removeItem(slot);
    } catch {
        /* Storage can be disabled. */
    }
}
