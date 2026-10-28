import type { Scene, Token, Point } from '../tabletop/types/scene';
import type { Mutation } from '../api/workspace';
export interface SceneEvent {
    type: string;
    sceneId: string;
    revision: number;
    mutationId: string;
    dragSessionId?: string;
    payload: Pick<Mutation, 'token' | 'grid' | 'map' | 'deletedId'> & { scene?: Partial<Scene> };
}
export interface MovePreview extends Point {
    type: 'token.move-preview';
    sceneId: string;
    tokenId: string;
    baseRevision: number;
    dragSessionId: string;
    sequence: number;
    cancelled?: boolean;
}
export function reduceEvent(scene: Scene, event: SceneEvent): Scene | 'gap' {
    if (event.sceneId !== scene.id || event.revision <= (scene.revision ?? 0)) return scene;
    if (event.revision !== (scene.revision ?? 0) + 1) return 'gap';
    const payload = event.payload;
    let tokens = scene.tokens;
    if (payload.token) {
        const token: Token = payload.token;
        tokens = tokens.some((t) => t.id === token.id)
            ? tokens.map((t) => (t.id === token.id ? token : t))
            : [...tokens, token];
    }
    if (payload.deletedId) tokens = tokens.filter((t) => t.id !== payload.deletedId);
    return {
        ...scene,
        ...payload.scene,
        tokens,
        revision: event.revision,
        ...(payload.grid ? { grid: payload.grid } : {}),
        ...('map' in payload ? { map: payload.map } : {}),
    };
}
/** Transient order tracking is separate from persisted revisions. */
export class PreviewOrder {
    private sequences = new Map<string, number>();
    accept(scene: Scene, event: MovePreview) {
        if (
            event.sceneId !== scene.id ||
            event.baseRevision !== scene.revision ||
            !scene.tokens.some((t) => t.id === event.tokenId)
        )
            return false;
        const last = this.sequences.get(event.dragSessionId) ?? 0;
        if (event.sequence <= last) return false;
        this.sequences.set(event.dragSessionId, event.cancelled ? Infinity : event.sequence);
        if (this.sequences.size > 500) this.sequences.delete(this.sequences.keys().next().value!);
        return true;
    }
    finish(id?: string) {
        if (id) this.sequences.set(id, Infinity);
    }
}
