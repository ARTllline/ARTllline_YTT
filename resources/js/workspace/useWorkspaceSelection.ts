import { useEffect, useState } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';

function selectionKey(store: SceneStore): string {
    const state = store.getSnapshot();
    return [
        ...state.selectedIds,
        ...(state.selectedPropIds ?? []).map((id) => `p${id}`),
        ...(state.selectedNoteId ? [`n${state.selectedNoteId}`] : []),
        ...(state.selectedRegionId ? [`r${state.selectedRegionId}`] : []),
    ].join('|');
}

/** Keep canvas geometry stable until the renderer has committed or cancelled its gesture. */
export function watchWorkspaceSelection(
    store: SceneStore,
    onChange: (key: string) => void,
    events: Window = window,
) {
    let pointer: number | null = null;
    let disposed = false;
    const publish = () => {
        if (!disposed && pointer === null) onChange(selectionKey(store));
    };
    const down = (event: PointerEvent) => {
        if (event.target instanceof HTMLCanvasElement) pointer = event.pointerId;
    };
    const release = (event: PointerEvent) => {
        if (pointer !== event.pointerId) return;
        pointer = null;
        queueMicrotask(publish);
    };
    const unsubscribe = store.subscribe(publish);
    events.addEventListener('pointerdown', down, true);
    events.addEventListener('pointerup', release);
    events.addEventListener('pointercancel', release);
    events.addEventListener('lostpointercapture', release);
    return () => {
        disposed = true;
        unsubscribe();
        events.removeEventListener('pointerdown', down, true);
        events.removeEventListener('pointerup', release);
        events.removeEventListener('pointercancel', release);
        events.removeEventListener('lostpointercapture', release);
    };
}

export function useWorkspaceSelection(store: SceneStore): string {
    const [key, setKey] = useState(() => selectionKey(store));
    useEffect(() => watchWorkspaceSelection(store, setKey), [store]);
    return key;
}
