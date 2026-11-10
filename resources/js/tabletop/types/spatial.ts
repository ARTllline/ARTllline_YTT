import type { Point } from './scene';
export type FogBase = 'clear' | 'covered';
export interface FogStroke {
    /** Legacy reveal erases manual fog. Explore opens public background only. */
    operation: 'reveal' | 'cover' | 'explore';
    shape: 'brush' | 'rectangle';
    geometry: { points: Point[]; radius?: number };
}
export interface FogAction extends FogStroke {
    id: string;
    sequence: number;
}
export interface FogState {
    base: FogBase;
    actions: FogAction[];
}
export interface FogPatch {
    fog?: FogState;
    fogAction?: FogAction;
    fogRemovedSequence?: number;
}
export function applyFogPatch(state: FogState | undefined, patch: FogPatch): FogState | undefined {
    if (patch.fog) return patch.fog;
    if (patch.fogAction) {
        if (state?.actions.some((action) => action.sequence === patch.fogAction!.sequence))
            return state;
        return {
            base: state?.base ?? 'clear',
            actions: [...(state?.actions ?? []), patch.fogAction],
        };
    }
    if (state && patch.fogRemovedSequence)
        return {
            ...state,
            actions: state.actions.filter((a) => a.sequence !== patch.fogRemovedSequence),
        };
    return state;
}
export type SpatialKind = 'ruler' | 'circle' | 'cone' | 'rectangle' | 'ping';
export interface SpatialEvent {
    type: 'spatial';
    sceneId: string;
    epoch: number;
    participant: { id: string; name: string };
    kind: SpatialKind;
    sessionId: string;
    startedAt: number;
    sequence: number;
    phase: 'update' | 'end' | 'cancel';
    start: Point;
    end: Point;
}
