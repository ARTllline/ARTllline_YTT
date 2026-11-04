import { useSyncExternalStore } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';

export function DirectControlControls({ store }: { store: SceneStore }) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const id = state.selectedIds[0];
    const token = state.scene.tokens.find((t) => t.id === id);
    const control = state.directControl;
    if (
        state.mapEditor ||
        state.mapDraft ||
        state.routePreview ||
        store.abilityTargeting ||
        state.scene.combat?.status === 'active' ||
        state.selectedIds.length !== 1 ||
        !token ||
        token.kind !== 'player_character' ||
        !store.canMove(id)
    )
        return null;
    return (
        <div className="direct-control-controls" aria-label="Управление персонажем">
            <button
                className={control ? 'primary-button' : ''}
                aria-pressed={!!control}
                disabled={!store.spatial.connected || store.spatial.tool !== 'select'}
                onClick={() => store.toggleDirectControl?.()}
            >
                {control ? 'Выйти · Esc' : 'Управлять · WASD'}
            </button>
            {state.directNotice && <span role="status">{state.directNotice}</span>}
            {control && (
                <>
                    <span>W A S D · {token.name}</span>
                    <label>
                        <input
                            type="checkbox"
                            checked={control.follow}
                            onChange={(e) =>
                                store.setDirectControl({ ...control, follow: e.target.checked })
                            }
                        />{' '}
                        Следовать камерой
                    </label>
                </>
            )}
        </div>
    );
}
