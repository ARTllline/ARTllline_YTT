import { useEffect, useRef, type RefObject } from 'react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';

/** Only this tiny affordance follows the token. Never intercept the token's hit area. */
export function TokenQuickActions({
    store,
    renderer,
    onMore,
    disabled,
}: {
    store: SceneStore;
    renderer: RefObject<TabletopRenderer | null>;
    onMore: () => void;
    disabled: boolean;
}) {
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let frame = 0;
        const sync = () => {
            const state = store.getSnapshot(),
                node = host.current;
            const token = state.scene.tokens.find((t) => t.id === state.selectedIds[0]);
            if (node && renderer.current && token) {
                const point = renderer.current.screenPoint(token);
                const canvas = document
                    .querySelector('.map-first-session .canvas-host')
                    ?.getBoundingClientRect();
                node.hidden =
                    !!state.preview ||
                    store.abilityTargeting ||
                    state.selectedIds.length !== 1 ||
                    !canvas ||
                    point.x < canvas.left + 64 ||
                    point.x > canvas.right - 64 ||
                    point.y < canvas.top + 64 ||
                    point.y > canvas.bottom - 64;
                node.style.left = `${point.x}px`;
                node.style.top = `${renderer.current.screenPoint({ x: token.x, y: token.y - (token.size * token.scale) / 2 }).y - 18}px`;
            } else if (node) node.hidden = true;
            frame = requestAnimationFrame(sync);
        };
        sync();
        return () => cancelAnimationFrame(frame);
    }, [store, renderer]);
    return (
        <div
            ref={host}
            hidden
            className="token-local-actions"
            aria-label="Быстрые действия выбранного токена"
        >
            <span aria-hidden="true">◆</span>
            <button
                title="Показать runtime-контекст"
                aria-label="Показать runtime-контекст"
                onClick={onMore}
            >
                •••
            </button>
            <button
                disabled={disabled}
                title="Скрыть / показать игрокам"
                aria-label="Скрыть / показать игрокам"
                onClick={() => {
                    const s = store.getSnapshot();
                    const t = s.scene.tokens.find((t) => t.id === s.selectedIds[0]);
                    if (t) store.updateToken(t.id, { isHidden: !t.isHidden });
                }}
            >
                ◉
            </button>
        </div>
    );
}
