import { applyObjectPatch } from '../tabletop/state/objectPatch';
import { applyRegionPatch } from '../automation/model';
import type { Scene, Token, Point } from '../tabletop/types/scene';
import type { Mutation } from '../api/workspace';
export interface SceneEvent {
    type: string;
    sceneId: string;
    revision: number;
    mutationId: string;
    dragSessionId?: string;
    payload: Pick<
        Mutation,
        | 'tokens'
        | 'props'
        | 'deletedIds'
        | 'deletedPropIds'
        | 'token'
        | 'grid'
        | 'map'
        | 'deletedId'
        | 'fog'
        | 'fogAction'
        | 'combat'
        | 'note'
        | 'deletedNoteId'
        | 'region'
        | 'deletedRegionId'
    > & {
        scene?: Partial<Scene>;
        gameplayFeedback?: import('../gameplay/model').GameplayFeedback;
    };
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
    // Older servers encode an empty PHP payload as []. Array.prototype.map must
    // never be mistaken for a scene map update by the property checks below.
    const payload = Array.isArray(event.payload) ? {} : event.payload;
    const patched = applyRegionPatch(applyObjectPatch(scene, payload), payload);
    let tokens = patched.tokens;
    if (payload.token) {
        const token: Token = payload.token;
        tokens = tokens.some((t) => t.id === token.id)
            ? tokens.map((t) => (t.id === token.id ? token : t))
            : [...tokens, token];
    }
    if (payload.deletedId) tokens = tokens.filter((t) => t.id !== payload.deletedId);
    return {
        ...patched,
        ...payload.scene,
        tokens,
        ...(payload.note
            ? {
                  notes: [
                      ...(scene.notes ?? []).filter((n) => n.id !== payload.note!.id),
                      payload.note,
                  ],
              }
            : {}),
        ...(payload.deletedNoteId
            ? { notes: scene.notes?.filter((n) => n.id !== payload.deletedNoteId) }
            : {}),
        ...('combat' in payload ? { combat: payload.combat } : {}),
        ...(payload.fog
            ? { fog: payload.fog }
            : payload.fogAction
              ? {
                    fog: {
                        base: scene.fog?.base ?? 'clear',
                        actions: [...(scene.fog?.actions ?? []), payload.fogAction],
                    },
                }
              : {}),
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
