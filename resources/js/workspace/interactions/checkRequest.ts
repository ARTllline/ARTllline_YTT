import { commandId } from '../../api/workspace';

/** Retain ambiguous requests across reconnect/reload, scoped to the invoking user. */
export function checkRequest(
    key: string,
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = sessionStorage,
) {
    const slot = `ytt:check:${key}`;
    let id: string;
    try {
        id = storage.getItem(slot) ?? commandId();
        storage.setItem(slot, id);
    } catch {
        id = commandId();
    }
    return {
        id,
        complete: () => {
            try {
                storage.removeItem(slot);
            } catch {
                /* Private storage may be unavailable. */
            }
        },
    };
}
