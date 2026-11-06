import type { Point } from '../types/scene';

export interface LosRay {
    target: Point;
    visible: boolean;
    reason: 'clear' | 'blocked' | 'out_of_range';
    distance: number;
    blocker?: { id: string; source: string; point: Point };
}
export interface LosDebug {
    polygon?: Point[];
    schemaVersion: 1;
    sceneId: string;
    revision: number;
    geometryKey: string;
    policy: string;
    observer: Point;
    range: number | null;
    results: (
        | ({ point: Point } & Omit<LosRay, 'target'>)
        | {
              tokenId: string;
              visible: boolean;
              visibility: 'none' | 'partial' | 'full';
              visibleSamples: number;
              sampleCount: number;
              rays: LosRay[];
          }
    )[];
}

/** Sparse diagnostic spokes, not a visibility polygon. All visibility comes from the server. */
export function probePoints(origin: Point, range: number, width: number, height: number): Point[] {
    return Array.from({ length: 32 }, (_, i) => {
        const angle = (i * Math.PI) / 16;
        return {
            x: Math.max(0, Math.min(width, origin.x + Math.cos(angle) * range)),
            y: Math.max(0, Math.min(height, origin.y + Math.sin(angle) * range)),
        };
    });
}

export function debugRays(debug: LosDebug): LosRay[] {
    return debug.results.flatMap((result) =>
        'rays' in result ? result.rays : [{ ...result, target: result.point }],
    );
}
