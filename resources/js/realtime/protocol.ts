import { encounterPatch } from '../workspace/encounters/model';
import { applyObjectPatch } from '../tabletop/state/objectPatch';
import { applyStructurePatch, emptyHash, type StructurePatch } from '../tabletop/structure/model';
import { terrainPatch } from '../tabletop/terrain/model';
import { applyRegionPatch } from '../automation/model';
import type { Scene, Token, Point } from '../tabletop/types/scene';
import type { Mutation } from '../api/workspace';
import { applyFogPatch } from '../tabletop/types/spatial';
export interface SceneEvent {
    type: string;
    sceneId: string;
    revision: number;
    mutationId: string;
    dragSessionId?: string;
    payload: Pick<
        Mutation,
        | 'encounters'
        | 'encounterRuns'
        | 'deletedEncounterId'
        | 'movementGeometryChanged'
        | 'vision'
        | 'lighting'
        | 'tokenMovements'
        | 'tokens'
        | 'props'
        | 'deletedIds'
        | 'deletedPropIds'
        | 'token'
        | 'grid'
        | 'map'
        | 'mapWorld'
        | 'terrain'
        | 'deletedId'
        | 'fog'
        | 'fogAction'
        | 'fogRemovedSequence'
        | 'combat'
        | 'note'
        | 'deletedNoteId'
        | 'region'
        | 'deletedRegionId'
    > & {
        scene?: Partial<Scene>;
        structurePatch?: StructurePatch;
        structureRefresh?: boolean;
        fogRefresh?: boolean;
        gameplayFeedbacks?: import('../gameplay/model').GameplayFeedback[];
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
    if (
        payload.structureRefresh ||
        payload.fogRefresh ||
        (payload.structurePatch &&
            payload.structurePatch.base !== (scene.structure?.hash ?? emptyHash))
    )
        return 'gap';
    const patched = terrainPatch(
        applyRegionPatch(applyObjectPatch(scene, payload), payload),
        payload.terrain,
    );
    let tokens = patched.tokens;
    if (payload.token) {
        const token: Token = payload.token;
        tokens = tokens.some((t) => t.id === token.id)
            ? tokens.map((t) => (t.id === token.id ? token : t))
            : [...tokens, token];
    }
    if (payload.deletedId) tokens = tokens.filter((t) => t.id !== payload.deletedId);
    return {
        ...encounterPatch(patched, payload),
        ...payload.scene,
        ...(payload.vision ? { vision: payload.vision } : {}),
        ...(payload.lighting ? { lighting: payload.lighting } : {}),
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
        ...(payload.fog || payload.fogAction || payload.fogRemovedSequence
            ? { fog: applyFogPatch(scene.fog, payload) }
            : {}),
        revision: event.revision,
        ...(payload.grid ? { grid: payload.grid } : {}),
        ...('map' in payload ? { map: payload.map } : {}),
        ...('mapWorld' in payload ? { mapWorld: payload.mapWorld } : {}),
        ...(payload.structurePatch
            ? { structure: applyStructurePatch(scene.structure, payload.structurePatch) }
            : payload.mapWorld === null
              ? { structure: null }
              : {}),
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
