import { useSyncExternalStore } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';

export function RouteControls({ store }: { store: SceneStore }) {
    const { routePreview: route, scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    if (!route) return null;
    return (
        <div
            className="route-controls"
            data-combat={scene.combat?.status === 'active'}
            role="status"
            aria-label="Маршрут перемещения"
        >
            <div>
                <span className="eyebrow">ПЕРЕМЕЩЕНИЕ</span>
                <p>{route.message}</p>
                {route.remaining !== undefined && (
                    <strong>
                        Стоимость: {Number(route.cost?.toFixed(2))} ft · Осталось:{' '}
                        {Number(route.remaining.toFixed(2))} ft
                    </strong>
                )}
            </div>
            {route.status === 'ready' && route.remaining !== undefined && (
                <button
                    className="primary-button"
                    disabled={!route.allowed}
                    onClick={() => store.confirmRoute?.()}
                >
                    Подтвердить движение
                </button>
            )}
            <button onClick={() => store.cancelRoute?.()}>
                {route.status === 'sending' ? 'Остановить · Esc' : 'Отмена'}
            </button>
        </div>
    );
}
