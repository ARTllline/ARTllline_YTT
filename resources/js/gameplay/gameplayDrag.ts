import { isBinding, type SlotBinding } from './hotbarModel';

/** Shared browser-window → deck contract. A future source plugs in here, not in pointer handlers. */
export const GAMEPLAY_ENTRY_MIME = 'application/x-ytt-gameplay-entry+json';
export function writeGameplayEntry(
    data: Pick<DataTransfer, 'setData' | 'effectAllowed'>,
    binding: SlotBinding,
) {
    data.setData(GAMEPLAY_ENTRY_MIME, JSON.stringify({ version: 1, binding }));
    data.effectAllowed = 'copyMove';
}
export function readGameplayEntry(data: Pick<DataTransfer, 'getData'>): SlotBinding | null {
    try {
        const raw = data.getData(GAMEPLAY_ENTRY_MIME);
        if (raw.length > 1024) return null;
        const value = JSON.parse(raw);
        return value?.version === 1 && isBinding(value.binding) ? value.binding : null;
    } catch {
        return null;
    }
}
