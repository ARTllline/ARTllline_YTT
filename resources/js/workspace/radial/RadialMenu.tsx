import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { buildRadialActions, type RadialTarget } from './radialActions';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import type { RightPanel } from '../workspaceState';
import { radialPosition, radialSlot, radialFocus } from './radialLayout';
export function RadialMenu({
    store,
    queue,
    renderer,
    onPanel,
}: {
    store: SceneStore;
    queue: SaveQueue;
    renderer: RefObject<TabletopRenderer | null>;
    onPanel: (panel: RightPanel) => Promise<void>;
}) {
    const mount = useRef<HTMLSpanElement>(null),
        menu = useRef<HTMLDivElement>(null);
    const [target, setTarget] = useState<RadialTarget | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const close = () => {
        setTarget(null);
        mount.current?.parentElement?.querySelector('canvas')?.focus({ preventScroll: true });
    };
    useEffect(() => {
        const host = mount.current?.parentElement;
        if (!host) return;
        let timer: ReturnType<typeof setTimeout> | undefined,
            origin: { x: number; y: number } | undefined;
        const clear = () => {
            clearTimeout(timer);
            origin = undefined;
        };
        const open = (x: number, y: number) => {
            const hit = renderer.current?.contextTarget(x, y);
            if (!hit) return;
            renderer.current?.cancelGesture();
            setError('');
            setTarget({ ...hit, x, y });
        };
        const context = (e: MouseEvent) => {
            if (!(e.target instanceof HTMLCanvasElement)) return;
            e.preventDefault();
            e.stopPropagation();
            clear();
            open(e.clientX, e.clientY);
        };
        const down = (e: PointerEvent) => {
            clear();
            if (
                !e.isPrimary ||
                e.pointerType !== 'touch' ||
                !(e.target instanceof HTMLCanvasElement)
            )
                return;
            const before = store.getSnapshot();
            origin = { x: e.clientX, y: e.clientY };
            timer = setTimeout(() => {
                // A hold opens context without committing the tap selection. Restore it
                // before releasing pointer capture so the workspace does not resize.
                if (before.scene.id !== store.getSnapshot().scene.id) return;
                if (before.selectedNoteId) store.selectNote(before.selectedNoteId);
                else if (before.selectedRegionId) store.selectRegion(before.selectedRegionId);
                else
                    store.selectObjects({
                        tokenIds: [...before.selectedIds],
                        propIds: [...(before.selectedPropIds ?? [])],
                    });
                open(e.clientX, e.clientY);
                origin = undefined;
            }, 520);
        };
        const move = (e: PointerEvent) => {
            if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 8) clear();
        };
        const key = (e: KeyboardEvent) => {
            if (
                !(e.target instanceof HTMLCanvasElement) ||
                !(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
            )
                return;
            const point = renderer.current?.selectedContextPoint();
            if (point) {
                e.preventDefault();
                e.stopPropagation();
                open(point.x, point.y);
            }
        };
        const dismiss = () => setTarget(null);
        host.addEventListener('contextmenu', context, true);
        host.addEventListener('pointerdown', down, true);
        host.addEventListener('keydown', key, true);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', clear);
        window.addEventListener('pointercancel', clear);
        window.addEventListener('resize', dismiss);
        window.addEventListener('blur', dismiss);
        return () => {
            clear();
            host.removeEventListener('contextmenu', context, true);
            host.removeEventListener('pointerdown', down, true);
            host.removeEventListener('keydown', key, true);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', clear);
            window.removeEventListener('pointercancel', clear);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('blur', dismiss);
        };
    }, [renderer, store]);
    useEffect(() => {
        if (target) menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    }, [target]);
    const { entity, actions } = buildRadialActions(target, store, queue, onPanel);
    const position = target
        ? radialPosition(target.x, target.y, window.innerWidth, window.innerHeight)
        : null;
    return (
        <>
            <span ref={mount} className="radial-mount" />
            {target &&
                entity &&
                position &&
                createPortal(
                    <div
                        className="radial-scrim"
                        onPointerDown={(e) => {
                            if (e.target === e.currentTarget && !busy) close();
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                    >
                        <div
                            ref={menu}
                            className="radial-menu"
                            role="menu"
                            aria-label={`Действия: ${entity.name || 'Объект'}`}
                            style={{
                                left: position.left,
                                top: position.top,
                                width: position.size,
                                height: position.size,
                            }}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Escape' && !busy) {
                                    e.preventDefault();
                                    close();
                                }
                                const items = [
                                    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                                        '[role=menuitem]:not(:disabled)',
                                    ),
                                ];
                                if (
                                    [
                                        'ArrowUp',
                                        'ArrowDown',
                                        'ArrowLeft',
                                        'ArrowRight',
                                        'Home',
                                        'End',
                                    ].includes(e.key) &&
                                    items.length
                                ) {
                                    e.preventDefault();
                                    items[
                                        radialFocus(
                                            items.indexOf(
                                                document.activeElement as HTMLButtonElement,
                                            ),
                                            e.key,
                                            items.length,
                                        )
                                    ]?.focus();
                                }
                                if (e.key === 'Tab' && !busy) {
                                    e.preventDefault();
                                    close();
                                }
                            }}
                        >
                            <div className="radial-center">
                                <span>
                                    {busy
                                        ? 'ПРИМЕНЯЕМ…'
                                        : target.kind === 'region'
                                          ? 'ОБЛАСТЬ'
                                          : target.kind === 'prop'
                                            ? 'ОБЪЕКТ'
                                            : 'ТОКЕН'}
                                </span>
                                <strong>{entity.name || 'Объект'}</strong>
                                <button
                                    title="Закрыть · Esc"
                                    aria-label="Закрыть меню действий"
                                    disabled={busy}
                                    onClick={close}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            {actions.map(({ label, Icon, run, tone }, index) => (
                                <button
                                    role="menuitem"
                                    key={label}
                                    className={`radial-action ${tone ?? ''}`}
                                    style={radialSlot(index, actions.length)}
                                    disabled={busy || save.status !== 'saved'}
                                    onClick={() => {
                                        setBusy(true);
                                        setError('');
                                        void Promise.resolve()
                                            .then(run)
                                            .then(() => queue.flush())
                                            .then(close)
                                            .catch((e) => setError((e as Error).message))
                                            .finally(() => setBusy(false));
                                    }}
                                >
                                    <Icon size={20} strokeWidth={1.6} />
                                    <span>{label}</span>
                                </button>
                            ))}
                            {error && (
                                <p className="radial-error" role="alert">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
