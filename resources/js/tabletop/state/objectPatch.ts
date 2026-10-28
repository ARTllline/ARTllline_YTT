import type { Scene, Token, SceneProp } from '../types/scene';
export interface ObjectPatch {
    tokens?: Token[];
    props?: SceneProp[];
    deletedIds?: string[];
    deletedPropIds?: string[];
}
function merge<T extends { id: string }>(
    current: readonly T[],
    changed: T[] = [],
    removed: string[] = [],
) {
    const changes = new Map(changed.map((item) => [item.id, item]));
    const deleted = new Set(removed);
    return [
        ...current.filter((item) => !changes.has(item.id) && !deleted.has(item.id)),
        ...changed.filter((item) => !deleted.has(item.id)),
    ];
}
export function applyObjectPatch(scene: Scene, patch: ObjectPatch): Scene {
    return {
        ...scene,
        ...(patch.tokens || patch.deletedIds
            ? { tokens: merge(scene.tokens, patch.tokens, patch.deletedIds) }
            : {}),
        ...(patch.props || patch.deletedPropIds
            ? { props: merge(scene.props ?? [], patch.props, patch.deletedPropIds) }
            : {}),
    };
}
