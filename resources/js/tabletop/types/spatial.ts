import type { Point } from './scene';
export type FogBase = 'clear' | 'covered';
export interface FogStroke {
    operation: 'reveal' | 'cover';
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
