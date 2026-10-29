import { commandId } from '../../api/workspace';
import type { RollMode } from './actingToken';

function browserStorage(): Storage | undefined {
    try {
        return globalThis.sessionStorage;
    } catch {
        return undefined;
    }
}

export interface CheckRequestContext {
    actorTokenId?: string;
    rollMode: RollMode;
}
export function readCheckRequest(
    key: string,
    storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
): { id: string; context?: CheckRequestContext } | null {
    try {
        const value = storage?.getItem(`ytt:check:${key}`);
        if (!value) return null;
        // Task 16B retained a plain UUID.
        return value.startsWith('{') ? JSON.parse(value) : { id: value };
    } catch {
        return null;
    }
}

/** Retain ambiguous requests across reconnect/reload, scoped to the invoking user. */
export function checkRequest(
    key: string,
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = browserStorage(),
    context?: CheckRequestContext,
) {
    const slot = `ytt:check:${key}`;
    const previous = readCheckRequest(key, storage);
    const id = previous?.id ?? commandId();
    const resolvedContext = previous?.context ?? context;
    try {
        storage?.setItem(
            slot,
            resolvedContext ? JSON.stringify({ id, context: resolvedContext }) : id,
        );
    } catch {
        /* Retain the identity in memory when storage is unavailable. */
    }
    return {
        id,
        context: resolvedContext,
        complete: () => {
            try {
                storage?.removeItem(slot);
            } catch {
                /* Private storage may be unavailable. */
            }
        },
    };
}
